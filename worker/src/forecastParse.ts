// 予報の履歴 (#250, R1-7 / R4): the kept forecast telegrams (forecast_telegrams, forecastArchive.ts) read
// into the values the history is built from — one row per issue (forecast_issues) and one per value
// (forecast_entries), by shared/forecastXml.ts.
//
// Reading is apart from keeping: a telegram is kept as it comes, and read after, by the scheduled run,
// a few at a time. A telegram that does not read keeps its XML; its read values are left empty and the
// reason is written on it (forecast_telegrams.parsed = {"error": …}), with the parser's version, so a
// later parser reads it again. When FORECAST_XML_PARSER goes up, every telegram is read again from its
// kept XML, newest first (N-5): the read values are derived, never the record.
//
// Values from another source (shiromatz, R2) go in the same two tables with their own `source`, so
// a value always says where it came from. Which copy of an issue is shown (`preferred`) is decided in
// one place, choosePreferred, again after every write: of the copies of one issue (the same office,
// kind and time issued) none when JMA cancelled it (取消); else, of those with values, our own telegram
// read without problems, then ours, then the record's — and of ours a 訂正 over the 発表 it corrects.
// A telegram that cannot be read, or reads empty, so never hides the record's copy (R2-6, R5-1).

import { FORECAST_XML_PARSER, parseForecastXml, type ForecastIssue } from "../../shared/forecastXml";
import type { Db } from "./accounts";
import { ensureForecastSchema } from "./forecastArchive";
import { doneOnce } from "./once";

export const FORECAST_PARSE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS forecast_issues (
    issue_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    office TEXT NOT NULL,
    kind TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    target_at TEXT,
    info_type TEXT,
    title TEXT,
    headline TEXT,
    revision_of TEXT,
    preferred INTEGER NOT NULL DEFAULT 1,
    parser INTEGER NOT NULL,
    entries INTEGER NOT NULL,
    problems TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS forecast_issues_office ON forecast_issues (office, kind, issued_at)",
  `CREATE TABLE IF NOT EXISTS forecast_entries (
    issue_id TEXT NOT NULL,
    place TEXT NOT NULL,
    place_name TEXT NOT NULL,
    place_type TEXT NOT NULL,
    element TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT NOT NULL,
    period TEXT NOT NULL,
    label TEXT,
    value TEXT,
    unit TEXT,
    lower REAL,
    upper REAL,
    jma_type TEXT NOT NULL,
    condition TEXT,
    PRIMARY KEY (issue_id, place, element, jma_type, valid_from, period)
  )`,
  "CREATE INDEX IF NOT EXISTS forecast_entries_place ON forecast_entries (place, element, valid_from)",
];

/**
 * Telegrams read in one scheduled run: a backlog (a new parser) is read over runs, newest first. Small,
 * so the run stays within D1's queries for one invocation beside the collector (about 7 a telegram).
 */
export const PARSE_PER_RUN = 5;

const done = new WeakSet<Db>(); // 済んだ印だけを共有する（once.ts）
export function ensureForecastParseSchema(db: Db): Promise<void> {
  return doneOnce(done, db, async () => {
    await ensureForecastSchema(db);
    for (const q of FORECAST_PARSE_SCHEMA) await db.prepare(q).run();
  });
}

/** The statements that put one read issue in place of what was read of it before (one batch, one transaction). */
export function issueStatements(db: Db, issueId: string, source: string, t: ForecastIssue, revisionOf: string | null) {
  return [
    db.prepare("DELETE FROM forecast_entries WHERE issue_id = ?").bind(issueId),
    db
      .prepare(
        "INSERT OR REPLACE INTO forecast_issues (issue_id, source, office, kind, issued_at, target_at, info_type, title, headline, revision_of, preferred, parser, entries, problems) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        issueId,
        source,
        t.office,
        t.kind,
        t.issuedAt,
        t.targetAt,
        t.infoType,
        t.title,
        t.headline,
        revisionOf,
        0, // decided by choosePreferred
        FORECAST_XML_PARSER,
        t.entries.length,
        t.problems.length ? t.problems.join("／") : null,
      ),
    // All the values in one statement (D1 allows few bound values a statement, not few rows).
    db
      .prepare(
        `INSERT OR REPLACE INTO forecast_entries (issue_id, place, place_name, place_type, element, valid_from, valid_to, period, label, value, unit, lower, upper, jma_type, condition)
         SELECT ?, json_extract(j.value, '$.place'), json_extract(j.value, '$.placeName'), json_extract(j.value, '$.placeType'),
                json_extract(j.value, '$.element'), json_extract(j.value, '$.validFrom'), json_extract(j.value, '$.validTo'),
                json_extract(j.value, '$.period'), json_extract(j.value, '$.label'), json_extract(j.value, '$.value'),
                json_extract(j.value, '$.unit'), json_extract(j.value, '$.lower'), json_extract(j.value, '$.upper'),
                json_extract(j.value, '$.jmaType'), json_extract(j.value, '$.condition')
         FROM json_each(?) j`,
      )
      .bind(issueId, JSON.stringify(t.entries)),
  ];
}

/**
 * Decides again which copy of each issue of `office` issued from `from` to `to` (ISO, JST) is shown:
 * one statement, put in the same batch as the write it follows, so two writers never leave two shown.
 */
export function choosePreferred(db: Db, office: string, from: string, to = from) {
  return db
    .prepare(
      `UPDATE forecast_issues AS f SET preferred = CASE
         WHEN EXISTS (SELECT 1 FROM forecast_issues c WHERE c.office = f.office AND c.kind = f.kind AND c.issued_at = f.issued_at AND c.info_type = '取消') THEN 0
         WHEN f.issue_id = (
           SELECT g.issue_id FROM forecast_issues g
           WHERE g.office = f.office AND g.kind = f.kind AND g.issued_at = f.issued_at AND g.entries > 0
           ORDER BY (g.source = 'jma-xml' AND g.problems IS NULL) DESC, g.source = 'jma-xml' DESC, g.info_type = '訂正' DESC, g.issue_id DESC
           LIMIT 1) THEN 1
         ELSE 0 END
       WHERE f.office = ? AND f.issued_at BETWEEN ? AND ?`,
    )
    .bind(office, from, to);
}

/**
 * A 訂正 stands beside the issue it corrects (the same office, kind and ReportDateTime, issued as 発表):
 * both are kept, and the correction names the one it corrects.
 */
async function correctedIssue(db: Db, issueId: string, t: ForecastIssue): Promise<string | null> {
  if (t.infoType !== "訂正") return null;
  const r = await db
    .prepare(
      "SELECT issue_id FROM forecast_issues WHERE source = 'jma-xml' AND office = ? AND kind = ? AND issued_at = ? AND issue_id <> ? AND info_type = '発表' ORDER BY issue_id DESC LIMIT 1",
    )
    .bind(t.office, t.kind, t.issuedAt, issueId)
    .first<{ issue_id: string }>();
  return r?.issue_id ?? null;
}

/** A telegram that could not be read or written: its XML stays, its read values go, the reason is kept, and the shown copy is decided again. */
async function failedRead(db: Db, r: { id: string; office: string; xml: string }, e: unknown) {
  const issued = /<ReportDateTime>([^<]+)<\/ReportDateTime>/.exec(r.xml)?.[1] ?? null;
  await db.batch([
    db.prepare("DELETE FROM forecast_entries WHERE issue_id = ?").bind(r.id),
    db.prepare("DELETE FROM forecast_issues WHERE issue_id = ?").bind(r.id),
    ...(issued ? [choosePreferred(db, r.office, issued)] : []),
    db
      .prepare("UPDATE forecast_telegrams SET parser = ?, parsed = ? WHERE id = ?")
      .bind(FORECAST_XML_PARSER, JSON.stringify({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }), r.id),
  ]);
}

/** One scheduled run's reading: the telegrams not read yet by this parser, newest first. Returns how many read and how many did not. */
export async function parseForecasts(db: Db, limit = PARSE_PER_RUN): Promise<{ read: number; failed: number }> {
  await ensureForecastParseSchema(db);
  const rows = (
    await db
      .prepare("SELECT id, kind, office, xml FROM forecast_telegrams WHERE parser < ? ORDER BY issued_at DESC, id DESC LIMIT ?")
      .bind(FORECAST_XML_PARSER, limit)
      .all<{ id: string; kind: string; office: string; xml: string }>()
  ).results;
  let read = 0;
  let failed = 0;
  for (const r of rows) {
    let t: ForecastIssue;
    try {
      t = parseForecastXml(r.xml, r.kind, r.office);
    } catch (e) {
      // The XML stays; what was read of it before goes (it was read by an older parser), and the reason is kept.
      await failedRead(db, r, e);
      failed++;
      continue;
    }
    try {
      const revisionOf = await correctedIssue(db, r.id, t);
      await db.batch([
        ...issueStatements(db, r.id, "jma-xml", t, revisionOf),
        // A 訂正 read before the issue it corrects (newest first) is tied to it now.
        ...(t.infoType === "発表"
          ? [
              db
                .prepare(
                  "UPDATE forecast_issues SET revision_of = ? WHERE source = 'jma-xml' AND office = ? AND kind = ? AND issued_at = ? AND info_type = '訂正' AND revision_of IS NULL",
                )
                .bind(r.id, t.office, t.kind, t.issuedAt),
            ]
          : []),
        choosePreferred(db, t.office, t.issuedAt),
        db
          .prepare("UPDATE forecast_telegrams SET parser = ?, parsed = ? WHERE id = ?")
          .bind(FORECAST_XML_PARSER, JSON.stringify({ entries: t.entries.length, problems: t.problems }), r.id),
      ]);
      read++;
    } catch (e) {
      // A write that fails (D1's limits …) is kept as a failure too, so the telegrams behind it are still read.
      await failedRead(db, r, e);
      failed++;
    }
  }
  return { read, failed };
}
