// 予報の履歴 (#250, R2): JMA's forecasts of 2025-01 … 2026-11-09, taken once from the record
// shiromatz/Japan-Meteorological-Agency-Weather-Forecast (CC BY-SA 4.0), a month at a time, by an
// administrator's hand (not the scheduled run). The month's zip is read at a fixed commit of the
// record, only the CSV of each office in use is read (shared/forecastShiromatz.ts), and its issues
// and values go into the same forecast_issues / forecast_entries as the telegrams, with
// source = 'shiromatz' — so each value says where it came from.
//
// What is kept of each month (forecast_imports, R2-7 / R2-9): the commit and URL, the CSV's hash, when
// it was taken, its rows, its issues, the days with no 府県天気予報 (the record read JMA's JSON a few
// times a day, so a missing issue is 「未取得」, never 「発表がない」, R2-10), and how it stands against
// our own telegrams where both have the issue. Taking a month again changes nothing that is the same.
//
// Where our own telegram has the same issue (the same office, kind and time issued), ours is shown:
// the record's copy stays, marked not preferred, and its values are compared with ours (R2-6, R5-2);
// a difference is kept, nothing is deleted.

import { FORECAST_XML_PARSER, type ForecastIssue } from "../../shared/forecastXml";
import { compareWithTelegram, parseShiromatzCsv, SHIROMATZ_PARSER, SHIROMATZ_REPO, SHIROMATZ_SOURCE, shiromatzIssueId } from "../../shared/forecastShiromatz";
import type { Db } from "./accounts";
import { officesInUse } from "./forecastArchive";
import { ensureForecastParseSchema } from "./forecastParse";

export const FORECAST_IMPORT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS forecast_imports (
    source TEXT NOT NULL,
    office TEXT NOT NULL,
    month TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    url TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    rows INTEGER NOT NULL,
    issues INTEGER NOT NULL,
    empty_days TEXT NOT NULL,
    overlaps INTEGER NOT NULL,
    differ INTEGER NOT NULL,
    detail TEXT NOT NULL,
    license TEXT NOT NULL,
    parser INTEGER NOT NULL,
    PRIMARY KEY (source, office, month)
  )`,
];

/** The months the record is taken for (R2-2, R2-3): 高知 is in it from 2025-01. */
export const IMPORT_FIRST = "2025-01";
export const IMPORT_LAST = "2026-11";
const LICENSE = "CC BY-SA 4.0";
/** Values put in one statement (a bound value of D1 is at most 2 MB; a value here is about 300 bytes). */
const ENTRIES_PER_STATEMENT = 400;

type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
const defaultFetch: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });

const ready = new WeakMap<Db, Promise<void>>();
export function ensureForecastImportSchema(db: Db): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      await ensureForecastParseSchema(db);
      for (const q of FORECAST_IMPORT_SCHEMA) await db.prepare(q).run();
    })().catch((e) => {
      ready.delete(db);
      throw e;
    });
    ready.set(db, p);
  }
  return p;
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The named files of a zip (stored or deflated), read from its central directory. */
export async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("zip：終わりの記録がない");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("zip：目次が読めない");
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = new Uint8Array(buf, start, size);
    if (method === 0) out.set(name, dec.decode(data));
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out.set(name, await new Response(stream).text());
    } else throw new Error(`zip：読めない圧縮 ${method}`);
  }
  return out;
}

/** The days of `month` (YYYY-MM, JST) with no 府県天気予報 among `issues`, and how many each day had. */
function daysOf(month: string, issues: ForecastIssue[]) {
  const per = new Map<string, number>();
  for (const t of issues) if (t.kind === "VPFD51" && t.issuedAt.startsWith(month)) per.set(t.issuedAt.slice(0, 10), (per.get(t.issuedAt.slice(0, 10)) ?? 0) + 1);
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const empty: string[] = [];
  for (let d = 1; d <= days; d++) {
    const k = `${month}-${String(d).padStart(2, "0")}`;
    if (!per.has(k)) empty.push(k);
  }
  return { empty, perDay: Object.fromEntries(per) };
}

export interface ImportResult {
  month: string;
  commit: string;
  offices: { office: string; issues: number; emptyDays: string[]; overlaps: number; differ: number; missing?: true }[];
}

/**
 * Take one month (YYYY-MM) of the record for the offices in use. What our own telegrams already hold
 * (2026-11 from the 10th, R2-3) is taken too, as not preferred, so the two can be compared.
 */
export async function importShiromatzMonth(db: Db, month: string, now = Date.now(), get: Fetcher = defaultFetch): Promise<ImportResult> {
  if (!/^\d{4}-\d{2}$/.test(month) || month < IMPORT_FIRST || month > IMPORT_LAST) throw new Error(`取り込める月は ${IMPORT_FIRST} から ${IMPORT_LAST} までです。`);
  await ensureForecastImportSchema(db);
  const ym = month.replace("-", "");
  const path = `forecast/forecast_${ym}.zip`;
  // The commit the month is taken at, so the same file can be taken again (R2-9).
  const c = await get(`https://api.github.com/repos/${SHIROMATZ_REPO}/commits?path=${path}&per_page=1`, {
    headers: { "User-Agent": "weather-note (#250)", Accept: "application/vnd.github+json" },
  });
  if (!c.ok) throw new Error(`記録のコミットが分かりません（HTTP ${c.status}）。`);
  const commits = JSON.parse(await c.text()) as { sha: string }[];
  if (!commits.length) throw new Error(`${month} の記録はまだありません。`);
  const commit = commits[0].sha;
  const url = `https://raw.githubusercontent.com/${SHIROMATZ_REPO}/${commit}/${path}`;
  const z = await get(url);
  if (!z.ok) throw new Error(`記録を取れませんでした（HTTP ${z.status}）。`);
  const offices = [...(await officesInUse(db, now))].sort();
  const files = await unzip(await z.arrayBuffer(), (n) => offices.some((o) => n.endsWith(`_${ym}_${o}.csv`) || n.endsWith(`forecast_${ym}_${o}.csv`)));
  const fetchedAt = new Date(now).toISOString();
  const result: ImportResult = { month, commit, offices: [] };
  for (const office of offices) {
    const name = [...files.keys()].find((n) => n.endsWith(`forecast_${ym}_${office}.csv`));
    if (!name) {
      result.offices.push({ office, issues: 0, emptyDays: [], overlaps: 0, differ: 0, missing: true });
      continue;
    }
    const csv = files.get(name)!;
    const issues = parseShiromatzCsv(csv, office);
    // Our own telegram of the same issue, read: the record's copy is kept beside it, not preferred, and compared.
    // Two queries for the whole month (a request may ask D1 only so many times).
    const span = issues.map((t) => t.issuedAt).sort();
    const ours = (
      await db
        .prepare("SELECT issue_id, kind, issued_at FROM forecast_issues WHERE source = 'jma-xml' AND office = ? AND info_type = '発表' AND issued_at BETWEEN ? AND ?")
        .bind(office, span[0] ?? "", span[span.length - 1] ?? "")
        .all<{ issue_id: string; kind: string; issued_at: string }>()
    ).results;
    const ourIssue = new Map(ours.map((o) => [`${o.kind}|${o.issued_at}`, o.issue_id]));
    const theirs = issues.filter((t) => ourIssue.has(`${t.kind}|${t.issuedAt}`));
    const telegramValues = new Map<string, Parameters<typeof compareWithTelegram>[1]>();
    if (theirs.length) {
      const all = (
        await db
          .prepare(
            "SELECT issue_id AS issueId, place, element, valid_from AS validFrom, valid_to AS validTo, period, value, lower, upper, jma_type AS jmaType, condition FROM forecast_entries WHERE issue_id IN (SELECT value FROM json_each(?))",
          )
          .bind(JSON.stringify(theirs.map((t) => ourIssue.get(`${t.kind}|${t.issuedAt}`))))
          .all<Parameters<typeof compareWithTelegram>[1][number] & { issueId: string }>()
      ).results;
      for (const e of all) telegramValues.set(e.issueId, [...(telegramValues.get(e.issueId) ?? []), e]);
    }
    const differences: string[] = [];
    for (const t of theirs) {
      const cmp = compareWithTelegram(t.entries, telegramValues.get(ourIssue.get(`${t.kind}|${t.issuedAt}`)!) ?? []);
      for (const d of [...cmp.differ, ...cmp.missing.map((m) => `${m}: 電文にない`)]) differences.push(`${t.kind} ${t.issuedAt} ${d}`);
    }
    const overlaps = theirs.length;
    const preferred = new Map(issues.map((t) => [shiromatzIssueId(t), !ourIssue.has(`${t.kind}|${t.issuedAt}`)]));
    const ids = issues.map(shiromatzIssueId);
    const rows = issues.map((t) => ({
      issue_id: shiromatzIssueId(t),
      kind: t.kind,
      issued_at: t.issuedAt,
      info_type: t.infoType,
      preferred: preferred.get(shiromatzIssueId(t)) ? 1 : 0,
      entries: t.entries.length,
      problems: t.problems.length ? t.problems.join("／") : null,
    }));
    const values = issues.flatMap((t) => t.entries.map((e) => ({ ...e, issueId: shiromatzIssueId(t) })));
    const { empty, perDay } = daysOf(month, issues);
    // One batch, one transaction: the month is in whole, or not at all.
    const statements = [
      db.prepare("DELETE FROM forecast_entries WHERE issue_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)),
      db
        .prepare(
          `INSERT OR REPLACE INTO forecast_issues (issue_id, source, office, kind, issued_at, target_at, info_type, title, headline, revision_of, preferred, parser, entries, problems)
           SELECT json_extract(j.value, '$.issue_id'), ?, ?, json_extract(j.value, '$.kind'), json_extract(j.value, '$.issued_at'), NULL,
                  json_extract(j.value, '$.info_type'), NULL, NULL, NULL, json_extract(j.value, '$.preferred'), ?, json_extract(j.value, '$.entries'), json_extract(j.value, '$.problems')
           FROM json_each(?) j`,
        )
        .bind(SHIROMATZ_SOURCE, office, SHIROMATZ_PARSER, JSON.stringify(rows)),
    ];
    for (let i = 0; i < values.length; i += ENTRIES_PER_STATEMENT)
      statements.push(
        db
          .prepare(
            `INSERT OR REPLACE INTO forecast_entries (issue_id, place, place_name, place_type, element, valid_from, valid_to, period, label, value, unit, lower, upper, jma_type, condition)
             SELECT json_extract(j.value, '$.issueId'), json_extract(j.value, '$.place'), json_extract(j.value, '$.placeName'), json_extract(j.value, '$.placeType'),
                    json_extract(j.value, '$.element'), json_extract(j.value, '$.validFrom'), json_extract(j.value, '$.validTo'),
                    json_extract(j.value, '$.period'), json_extract(j.value, '$.label'), json_extract(j.value, '$.value'),
                    json_extract(j.value, '$.unit'), json_extract(j.value, '$.lower'), json_extract(j.value, '$.upper'),
                    json_extract(j.value, '$.jmaType'), json_extract(j.value, '$.condition')
             FROM json_each(?) j`,
          )
          .bind(JSON.stringify(values.slice(i, i + ENTRIES_PER_STATEMENT))),
      );
    statements.push(
      db
        .prepare(
          "INSERT OR REPLACE INTO forecast_imports (source, office, month, commit_sha, url, file_hash, fetched_at, rows, issues, empty_days, overlaps, differ, detail, license, parser) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          SHIROMATZ_SOURCE,
          office,
          month,
          commit,
          url,
          await sha256(csv),
          fetchedAt,
          csv.split("\n").filter((l) => l.trim()).length - 1,
          issues.length,
          JSON.stringify(empty),
          overlaps,
          differences.length,
          JSON.stringify({ file: name, perDay, differences: differences.slice(0, 50) }),
          LICENSE,
          SHIROMATZ_PARSER,
        ),
    );
    await db.batch(statements);
    result.offices.push({ office, issues: issues.length, emptyDays: empty, overlaps, differ: differences.length });
  }
  return result;
}

/** The months taken, for the administrator's screen. */
export async function importSummary(db: Db) {
  await ensureForecastImportSchema(db);
  const rows = (
    await db
      .prepare("SELECT office, month, commit_sha, fetched_at, rows, issues, empty_days, overlaps, differ, license FROM forecast_imports WHERE source = ? ORDER BY month, office")
      .bind(SHIROMATZ_SOURCE)
      .all<{ office: string; month: string; commit_sha: string; fetched_at: string; rows: number; issues: number; empty_days: string; overlaps: number; differ: number; license: string }>()
  ).results;
  return {
    first: IMPORT_FIRST,
    last: IMPORT_LAST,
    parser: { telegram: FORECAST_XML_PARSER, record: SHIROMATZ_PARSER },
    months: rows.map((r) => ({ ...r, empty_days: JSON.parse(r.empty_days) as string[] })),
  };
}
