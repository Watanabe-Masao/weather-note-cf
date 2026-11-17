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
// a value always says where it came from; `preferred` marks which of two copies of one issue is shown
// (R2-6).

import { FORECAST_XML_PARSER, parseForecastXml, type ForecastIssue } from "../../shared/forecastXml";
import type { Db } from "./accounts";
import { ensureForecastSchema } from "./forecastArchive";

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

/** Telegrams read in one scheduled run: a backlog (a new parser) is read over runs, newest first. */
export const PARSE_PER_RUN = 20;

const ready = new WeakMap<Db, Promise<void>>();
export function ensureForecastParseSchema(db: Db): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      await ensureForecastSchema(db);
      for (const q of FORECAST_PARSE_SCHEMA) await db.prepare(q).run();
    })().catch((e) => {
      ready.delete(db);
      throw e;
    });
    ready.set(db, p);
  }
  return p;
}

/** The statements that put one read issue in place of what was read of it before (one batch, one transaction). */
export function issueStatements(db: Db, issueId: string, source: string, t: ForecastIssue, revisionOf: string | null, preferred = true) {
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
        preferred ? 1 : 0,
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
      await db.batch([
        db.prepare("DELETE FROM forecast_entries WHERE issue_id = ?").bind(r.id),
        db.prepare("DELETE FROM forecast_issues WHERE issue_id = ?").bind(r.id),
        db
          .prepare("UPDATE forecast_telegrams SET parser = ?, parsed = ? WHERE id = ?")
          .bind(FORECAST_XML_PARSER, JSON.stringify({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }), r.id),
      ]);
      failed++;
      continue;
    }
    const revisionOf = await correctedIssue(db, r.id, t);
    await db.batch([
      ...issueStatements(db, r.id, "jma-xml", t, revisionOf),
      // The same issue taken from the record (R2) stays, but ours is shown (R2-6).
      db
        .prepare("UPDATE forecast_issues SET preferred = 0 WHERE source = 'shiromatz' AND office = ? AND kind = ? AND issued_at = ? AND preferred = 1")
        .bind(t.office, t.kind, t.issuedAt),
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
      db
        .prepare("UPDATE forecast_telegrams SET parser = ?, parsed = ? WHERE id = ?")
        .bind(FORECAST_XML_PARSER, JSON.stringify({ entries: t.entries.length, problems: t.problems }), r.id),
    ]);
    read++;
  }
  return { read, failed };
}
