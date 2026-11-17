// 予報の履歴 R6 の見本（#250）：見本に使うデータを、本物の処理に通して作る。
//
//  - 自前の電文：test/fixtures/forecast の高知（390000）の電文を forecast_telegrams に置き、
//    worker の parseForecasts（parseForecastXml → issueStatements → choosePreferred）で読む。
//  - shiromatz：2026-10 の記録の zip を importShiromatzMonth に渡す（取り込みと同じ道。zip は
//    コミット固定の URL から取ったもので、コミットとハッシュを出力に残す）。
//  - 合成：訂正・取り消し・取得失敗は実データに例がないので、実際の電文を元に作る（合成と印を付ける）。
//
// D1 の代わりは test/d1.ts（Node の SQLite）。出力の列は forecast_issues / forecast_entries のまま。
//
// 使い方（zip は別のディレクトリに置く。リポジトリには入れない）:
//   npx rolldown research/forecast-history/build-data.ts --platform node --format esm -o /tmp/fh-build.mjs
//   node /tmp/fh-build.mjs <forecast_202610.zip のパス> <その zip のコミット>

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { d1 } from "../../test/d1";
import { ensureForecastSchema } from "../../worker/src/forecastArchive";
import { importShiromatzMonth } from "../../worker/src/forecastImport";
import { parseForecasts } from "../../worker/src/forecastParse";

const [zipPath, commit] = process.argv.slice(2);
if (!zipPath || !commit)
  throw new Error("使い方：node build.mjs <zip> <commit>");
// 実行はリポジトリの一番上から（まとめて1つのファイルにすると import.meta.url が変わるため）。
const root = new URL(`file://${process.cwd()}/`);
const fixture = (name: string) =>
  readFileSync(new URL(`test/fixtures/forecast/${name}`, root), "utf8");

/** この見本で読む場所：中部（短期の区域）・高知県（週間の区域）・高知（地点）。 */
const PLACES = ["390010", "390000", "74182"];

type Db = ReturnType<typeof d1>;

function keep(
  db: Db,
  id: string,
  kind: string,
  xml: string,
  fetchedAt: string,
) {
  const issued = /<ReportDateTime>([^<]+)</.exec(xml)?.[1] ?? null;
  db.raw
    .prepare(
      "INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, ?, '390000', ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      kind,
      `fixture:${id}`,
      issued,
      fetchedAt,
      createHash("sha256").update(xml).digest("hex"),
      xml,
    );
}

function dump(
  db: Db,
  label: string,
  extra: { id: string } & Record<string, unknown>,
) {
  const issues = db.raw
    .prepare(
      "SELECT issue_id, source, office, kind, issued_at, info_type, revision_of, preferred, parser, entries, problems FROM forecast_issues WHERE kind IN ('VPFD51','VPFW50') ORDER BY issued_at, kind, issue_id",
    )
    .all();
  const entries = db.raw
    .prepare(
      `SELECT e.issue_id, place, place_name, place_type, element, valid_from, valid_to, period, label, value, unit, lower, upper, jma_type, condition
       FROM forecast_entries e JOIN forecast_issues i USING (issue_id)
       WHERE place IN (SELECT value FROM json_each(?)) AND element IN ('weather','weather_text','weather_code','weather_3h','pop','temp_max','temp_min','reliability')
       ORDER BY e.issue_id, element, valid_from`,
    )
    .all(JSON.stringify(PLACES));
  const fetchLog = db.raw
    .prepare(
      "SELECT at, feed, ok, entries, wanted, added, left_over, error FROM forecast_fetch_log ORDER BY at",
    )
    .all();
  // 取得時刻（発表時刻とは別、R1-4）。shiromatz は月の zip を取った時刻（forecast_imports.fetched_at、R2-4）。
  const telegrams = db.raw
    .prepare(
      "SELECT id, kind, issued_at, fetched_at, parser, parsed FROM forecast_telegrams ORDER BY issued_at",
    )
    .all();
  return { label, issues, entries, fetchLog, telegrams, ...extra };
}

async function realNovember() {
  const db = d1();
  await ensureForecastSchema(db);
  // 取得時刻は電文の発表から数分後（取得時刻は発表時刻の代わりにしない、R1-4）。
  keep(
    db,
    "vpfd51-390000-1700",
    "VPFD51",
    fixture("vpfd51-390000-1700.xml"),
    "2026-11-16T08:04:00Z",
  );
  keep(
    db,
    "vpfd51-390000-0500",
    "VPFD51",
    fixture("vpfd51-390000-0500.xml"),
    "2026-11-16T20:04:00Z",
  );
  keep(
    db,
    "vpfd51-390000-1100",
    "VPFD51",
    fixture("vpfd51-390000-1100.xml"),
    "2026-11-17T02:04:00Z",
  );
  keep(
    db,
    "vpfw50-390000-1100",
    "VPFW50",
    fixture("vpfw50-390000-1100.xml"),
    "2026-11-17T02:04:00Z",
  );
  const r = await parseForecasts(db, 50);
  return { db, read: r };
}

async function syntheticNovember() {
  const { db } = await realNovember();
  // 合成1：11時の府県天気予報の訂正（中部 11/18 12〜18時の降水確率 30 → 50）。電文名は別。
  const fix = fixture("vpfd51-390000-1100.xml")
    .replace("<InfoType>発表</InfoType>", "<InfoType>訂正</InfoType>")
    .replace(
      '<jmx_eb:ProbabilityOfPrecipitation condition="雨" description="３０パーセント" refID="5" type="６時間降水確率" unit="%">30</jmx_eb:ProbabilityOfPrecipitation>',
      '<jmx_eb:ProbabilityOfPrecipitation condition="雨" description="５０パーセント" refID="5" type="６時間降水確率" unit="%">50</jmx_eb:ProbabilityOfPrecipitation>',
    );
  if (!fix.includes(">50</jmx_eb:ProbabilityOfPrecipitation>"))
    throw new Error("合成の訂正が作れない");
  keep(
    db,
    "synthetic-vpfd51-390000-1100-teisei",
    "VPFD51",
    fix,
    "2026-11-17T02:31:00Z",
  );
  // 合成2：16日17時の府県天気予報の取り消し（本文なし）。
  const cancel = fixture("vpfd51-390000-1700.xml")
    .replace("<InfoType>発表</InfoType>", "<InfoType>取消</InfoType>")
    .replace(
      /<Body\b[\s\S]*<\/Body>/,
      '<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/"></Body>',
    );
  keep(
    db,
    "synthetic-vpfd51-390000-1700-torikeshi",
    "VPFD51",
    cancel,
    "2026-11-16T08:40:00Z",
  );
  // 合成3：取得の記録。15日の夕方に配信一覧が3回続けて読めなかった（→ 17時の週間は「取得失敗」）。
  // 14日以前は記録なし（→「未取得」の見本）。
  const log = db.raw.prepare(
    "INSERT INTO forecast_fetch_log (at, feed, ok, entries, wanted, added, left_over, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  log.run("2026-11-15T07:50:00Z", "short", 1, 120, 2, 0, 0, null);
  for (const at of [
    "2026-11-15T07:55:00Z",
    "2026-11-15T08:00:00Z",
    "2026-11-15T08:05:00Z",
  ])
    log.run(at, "short", 0, 0, 0, 0, 0, "配信一覧：HTTP 503");
  log.run("2026-11-15T08:10:00Z", "short", 1, 118, 2, 0, 0, null);
  log.run("2026-11-16T08:04:00Z", "short", 1, 121, 1, 1, 0, null);
  await parseForecasts(db, 50);
  return db;
}

async function realOctober() {
  const db = d1();
  await ensureForecastSchema(db);
  const zip = readFileSync(zipPath);
  const get = async (url: string) => {
    if (url.includes("info/refs"))
      return new Response(
        `001e# service=git-upload-pack\n${commit} refs/heads/main\n`,
      );
    if (url.includes(commit) && url.endsWith("forecast_202610.zip"))
      return new Response(zip);
    return new Response("", { status: 404 });
  };
  const result = await importShiromatzMonth(
    db,
    "2026-10",
    Date.parse("2026-11-17T03:00:00Z"),
    get as never,
  );
  const imported = db.raw
    .prepare(
      "SELECT source, office, month, commit_sha, url, file_hash, fetched_at, rows, issues, empty_days, overlaps, differ, license, parser FROM forecast_imports",
    )
    .all();
  return {
    db,
    result,
    imported,
    zipHash: createHash("sha256").update(zip).digest("hex"),
  };
}

const nov = await realNovember();
const syn = await syntheticNovember();
const oct = await realOctober();

const out = {
  made: "research/forecast-history/build-data.ts",
  note: "列は forecast_issues / forecast_entries のまま。preferred は choosePreferred が決めたもの。",
  scenarios: [
    dump(oct.db, "2026年10月：shiromatz の記録（実データ）", {
      id: "oct",
      source: {
        repo: "shiromatz/Japan-Meteorological-Agency-Weather-Forecast",
        commit,
        path: "forecast/forecast_202610.zip",
        zipSha256: oct.zipHash,
        license: "CC BY-SA 4.0",
      },
      imported: oct.imported,
    }),
    dump(nov.db, "2026年11月：自前の電文（実データ、fixtures の4通）", {
      id: "nov",
      read: nov.read,
    }),
    dump(syn, "2026年11月：訂正・取り消し・取得失敗を合成", {
      id: "syn",
      synthetic: [
        "synthetic-vpfd51-390000-1100-teisei：11/17 11時の訂正（中部 11/18 12〜18時の降水確率 30→50）",
        "synthetic-vpfd51-390000-1700-torikeshi：11/16 17時の取り消し",
        "forecast_fetch_log：11/15 16:55〜17:05 に3回失敗",
      ],
    }),
  ],
};
// 合成4：貯まった状態の仮。本番では 11/10 から自前の電文が毎回たまるが、見本の手元には4通しかないので、
// 10月の記録を31日ずらして「11/10〜11/18 の電文がそろった状態」を作る（値は10月のもの、実際の11月の予報ではない）。
// shiromatz の記録には3時間ごとの天気が無いので、6時間の降水確率とその日の天気の番号から仮に作る。
{
  const SHIFT = 31 * 86_400_000;
  const shift = (iso: string) => {
    const t = new Date(Date.parse(iso) + SHIFT + 9 * 3_600_000)
      .toISOString()
      .slice(0, 19);
    return `${t}+09:00`;
  };
  const src = out.scenarios[0] as unknown as {
    issues: Record<string, unknown>[];
    entries: Record<string, unknown>[];
  };
  const idOf = (old: string, at: string, kind: string) => `kari:${kind}:${at}`;
  const issues: Record<string, unknown>[] = [];
  const ids = new Map<string, string>();
  for (const i of src.issues) {
    const at = shift(String(i.issued_at));
    if (at < "2026-11-10T05:00:00+09:00" || at > "2026-11-18T17:00:00+09:00")
      continue;
    const id = idOf(String(i.issue_id), at, String(i.kind));
    ids.set(String(i.issue_id), id);
    issues.push({ ...i, issue_id: id, source: "jma-xml", issued_at: at });
  }
  const entries: Record<string, unknown>[] = [];
  for (const e of src.entries) {
    const id = ids.get(String(e.issue_id));
    if (!id) continue;
    entries.push({
      ...e,
      issue_id: id,
      valid_from: e.valid_from ? shift(String(e.valid_from)) : e.valid_from,
      valid_to: e.valid_to ? shift(String(e.valid_to)) : e.valid_to,
    });
  }
  for (const i of issues.filter((x) => x.kind === "VPFD51")) {
    const id = String(i.issue_id);
    const at = String(i.issued_at);
    const mine = entries.filter((e) => e.issue_id === id);
    const pops = mine.filter(
      (e) => e.element === "pop" && e.place === "390010",
    );
    const day0 = at.slice(0, 10);
    const h0 = Number(at.slice(11, 13));
    const end = Date.parse(`${day0}T00:00:00+09:00`) + 2 * 86_400_000; // 明日の24時まで
    for (
      let t =
        Date.parse(`${day0}T00:00:00+09:00`) +
        Math.ceil((h0 + 1) / 3) * 3 * 3_600_000;
      t < end;
      t += 3 * 3_600_000
    ) {
      const from =
        new Date(t + 9 * 3_600_000).toISOString().slice(0, 19) + "+09:00";
      const to =
        new Date(t + 3 * 3_600_000 + 9 * 3_600_000).toISOString().slice(0, 19) +
        "+09:00";
      const p = pops.find(
        (x) => String(x.valid_from) <= from && from < String(x.valid_to),
      );
      const code = mine.find(
        (x) =>
          x.element === "weather_code" &&
          String(x.valid_from).slice(0, 10) === from.slice(0, 10),
      );
      const pv = p ? Number(p.value) : null;
      const c = code ? String(code.value)[0] : "2";
      const value =
        pv != null && pv >= 50
          ? "雨"
          : c === "1" && (pv == null || pv <= 20)
            ? "晴れ"
            : c === "3" && pv != null && pv >= 30
              ? "雨"
              : "くもり";
      entries.push({
        issue_id: id,
        place: "390010",
        place_name: "中部",
        place_type: "area",
        element: "weather_3h",
        valid_from: from,
        valid_to: to,
        period: "PT3H",
        label: null,
        value,
        unit: null,
        lower: null,
        upper: null,
        jma_type: "天気",
        condition: null,
      });
    }
  }
  out.scenarios.splice(1, 0, {
    label: "2026年11月：貯まった状態の仮（10月の記録を31日ずらしたもの）",
    issues,
    entries,
    fetchLog: [],
    telegrams: [],
    id: "acc",
    synthetic: [
      "10月の記録の発表時刻・対象の時刻を31日後ろへ（10/10 05時〜10/18 17時 → 11/10〜11/18）",
      "3時間ごとの天気は6時間の降水確率と天気の番号から仮に作ったもの",
    ],
  } as never);
}
// 見本のページが読む（リポジトリには入れない：shiromatz の値の扱いは要件の未決 1）。
const dest = new URL(
  "research/forecast-history/sample/public/sample-data.json",
  root,
);
mkdirSync(new URL(".", dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out));
console.log(
  "wrote",
  dest.pathname,
  out.scenarios
    .map(
      (s) => `${s.id}: issues ${s.issues.length} entries ${s.entries.length}`,
    )
    .join(" / "),
);
