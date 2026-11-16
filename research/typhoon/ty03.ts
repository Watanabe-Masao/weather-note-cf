// TY-03 (#220): is the telegram read right? parseTyphoonXml (shared/typhoonXml.ts) set against what
// the same telegram also says in another form. JMA writes most values twice — the centre in 度 and in
// 度分 (and in words), a radius in 海里 and in km, the wind in ノット and in m/s — and the reader takes
// only one of each, so the other is an independent check of the fields it picked. Criteria, set
// before any result was seen (2026-11-16):
//  C1 読めた        every typhoon telegram in the feed reads with no problems, and has its 実況 centre
//  C2 中心          the centre read (度) within 0.05° of the 度分 and of the words, every time
//  C3 半径          every circle read (暴風域・強風域・暴風警戒域・予報円, long and short) within
//                   max(5 km, 3%) of a km radius JMA gives in that time
//  C4 風            wind read (ノット) × 0.5144 within 3 m/s of JMA's m/s, every time it gives both
//  C5 時間          a forecast's hours = its time − the analysis's time
//  C6 取りこぼし    every area in the XML (WarningAreaPart, 強風域 Circle, ProbabilityCircle) is read
// It reads JMA's long feed (7 days) as it is now: the telegrams the collector keeps (#237).
// Run by the "research-typhoon-archive" workflow (manual only); nothing is committed.
//   npx --yes tsx@4.19.2 research/typhoon/ty03.ts --out research/typhoon/out3
// 出典：気象庁（防災情報XML）。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseTyphoonXml, type XmlCircle } from "../../shared/typhoonXml";
import {
  feedEntries,
  telegramId,
  telegramKind,
} from "../../worker/src/typhoonArchive";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const out = arg("out", "research/typhoon/out3");
mkdirSync(join(out, "raw"), { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: {
      "user-agent":
        "weather-note research (github.com/Watanabe-Masao/weather-note-cf)",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const t = await r.text();
  await sleep(1500);
  return t;
}

const half = (s: string) =>
  s.replace(/[０-９．]/g, (d) =>
    d === "．" ? "." : String.fromCharCode(d.charCodeAt(0) - 0xfee0),
  );
const attrOf = (a: string, n: string) =>
  new RegExp(`${n}="([^"]*)"`).exec(a)?.[1] ?? "";

interface Check {
  n: number;
  bad: string[];
}
const C: Record<string, Check> = {
  C1: { n: 0, bad: [] },
  C2: { n: 0, bad: [] },
  C3: { n: 0, bad: [] },
  C4: { n: 0, bad: [] },
  C5: { n: 0, bad: [] },
  C6: { n: 0, bad: [] },
};
const check = (k: string, ok: boolean, what: string) => {
  C[k].n++;
  if (!ok) C[k].bad.push(what);
};

// --xml <file>: check one telegram on disk instead of the feed (to try the checks themselves).
const local = arg("xml", "");
const entries = local
  ? [
      {
        title: "台風解析・予報情報",
        url: `file/${local.replace(/^.*\//, "").replace(/\.xml$/, "")}_0_VPTW60_000000.xml`,
        updated: "",
      },
    ]
  : feedEntries(
      await get("https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml"),
    ).filter(
      (e) => /台風解析・予報情報/.test(e.title) && /VPTW\d\d/.test(e.url),
    );
const byNumber = new Map<string, number>();
const kinds = new Map<string, number>();

for (const e of entries) {
  const id = telegramId(e.url);
  let xml: string;
  try {
    xml = local ? readFileSync(local, "utf8") : await get(e.url);
  } catch (err) {
    check("C1", false, `${id}: 取れない ${String(err)}`);
    continue;
  }
  writeFileSync(join(out, "raw", `${id}.xml`), xml);
  const t = parseTyphoonXml(xml, telegramKind(e.url));
  kinds.set(t.kind, (kinds.get(t.kind) ?? 0) + 1);
  byNumber.set(t.number ?? "?", (byNumber.get(t.number ?? "?") ?? 0) + 1);
  const now = t.times.find((x) => x.hours === 0);
  check(
    "C1",
    !t.problems.length && !!now && now.lat != null && now.lon != null,
    `${id}: ${t.problems.join("／") || "実況の中心なし"}`,
  );

  // The XML's own MeteorologicalInfo blocks, in the same order as t.times.
  const infos = [
    ...xml.matchAll(
      /<MeteorologicalInfo\b[^>]*>([\s\S]*?)<\/MeteorologicalInfo>/g,
    ),
  ].map((m) => m[1]);
  const analysisAt = now ? Date.parse(now.validAt) : NaN;
  t.times.forEach((time, i) => {
    const info = infos[i] ?? "";
    const tag = `${id} ${time.part.replace(/\s/g, "")}`;
    // C2: the centre in 度分 and in words (the analysis gives them; a forecast's centre is its 予報円's).
    const dm =
      /<(?:jmx_eb:)?Coordinate\b[^>]*type="中心位置（度分）"[^>]*>([+-]\d+)([+-]\d+)/.exec(
        info,
      );
    if (dm && time.lat != null && time.lon != null) {
      const deg = (s: string) =>
        Math.sign(Number(s)) *
        (Math.floor(Math.abs(Number(s)) / 100) +
          (Math.abs(Number(s)) % 100) / 60);
      const dLat = Math.abs(deg(dm[1]) - time.lat);
      const dLon = Math.abs(deg(dm[2]) - time.lon);
      check(
        "C2",
        dLat <= 0.05 && dLon <= 0.05,
        `${tag}: 度 ${time.lat},${time.lon} / 度分 ${dm[1]}${dm[2]}`,
      );
    }
    const words = /description="北緯([０-９．]+)度東経([０-９．]+)度"/.exec(
      info,
    );
    if (words && time.lat != null && time.lon != null) {
      check(
        "C2",
        Math.abs(Number(half(words[1])) - time.lat) <= 0.05 &&
          Math.abs(Number(half(words[2])) - time.lon) <= 0.05,
        `${tag}: 度 ${time.lat},${time.lon} / ${words[0]}`,
      );
    }
    // C3: every km radius JMA gives in this time.
    const kms = [...info.matchAll(/<(?:jmx_eb:)?Radius\b([^>]*)>([^<]*)</g)]
      .filter((m) => attrOf(m[1], "unit") === "km")
      .map((m) => Number(m[2]));
    const circles: [string, XmlCircle | null][] = [
      ["暴風域", time.storm],
      ["強風域", time.gale],
      ["暴風警戒域", time.warning],
      ["予報円", time.probability],
    ];
    for (const [name, c] of circles) {
      if (!c || !kms.length) continue;
      for (const r of [c.radius.long, c.radius.short]) {
        const near = kms.some((k) => Math.abs(k - r) <= Math.max(5, k * 0.03));
        check(
          "C3",
          near,
          `${tag} ${name}: 読んだ ${r.toFixed(1)} km / 電文の km ${kms.join(",")}`,
        );
      }
    }
    // C4: knots against m/s, same type.
    for (const [type, kt] of [
      ["最大風速", time.windKt],
      ["最大瞬間風速", time.gustKt],
    ] as const) {
      const ms = [
        ...info.matchAll(/<(?:jmx_eb:)?WindSpeed\b([^>]*)>([^<]*)</g),
      ].find(
        (m) => attrOf(m[1], "type") === type && attrOf(m[1], "unit") === "m/s",
      );
      if (kt == null || !ms || ms[2].trim() === "") continue;
      check(
        "C4",
        Math.abs(kt * 0.5144 - Number(ms[2])) <= 3,
        `${tag} ${type}: ${kt} kt / ${ms[2]} m/s`,
      );
    }
    // C5
    if (time.hours > 0 && Number.isFinite(analysisAt)) {
      const h = (Date.parse(time.validAt) - analysisAt) / 3_600_000;
      check(
        "C5",
        h === time.hours,
        `${tag}: ${time.hours} 時間後 / 時刻の差 ${h} 時間`,
      );
    }
    // C6: what the XML has, read or not.
    const has = {
      暴風域:
        [...info.matchAll(/<WarningAreaPart\b[^>]*type="暴風域"/g)].length > 0,
      暴風警戒域: /<WarningAreaPart\b[^>]*type="暴風警戒域"/.test(info),
      強風域: /<(?:jmx_eb:)?Circle\b[^>]*type="強風域"/.test(info),
      予報円: /<ProbabilityCircle\b/.test(info),
    };
    const read = {
      暴風域: time.storm,
      暴風警戒域: time.warning,
      強風域: time.gale,
      予報円: time.probability,
    };
    for (const k of Object.keys(has) as (keyof typeof has)[]) {
      if (!has[k]) continue;
      // An area JMA lists with no size (半径なし: e.g. no 暴風域) is not a miss.
      const block =
        k === "予報円"
          ? /<ProbabilityCircle\b[\s\S]*?<\/ProbabilityCircle>/.exec(info)?.[0]
          : k === "強風域"
            ? /<(?:jmx_eb:)?Circle\b[^>]*type="強風域"[\s\S]*?<\/(?:jmx_eb:)?Circle>/.exec(
                info,
              )?.[0]
            : new RegExp(
                `<WarningAreaPart\\b[^>]*type="${k}"[\\s\\S]*?</WarningAreaPart>`,
              ).exec(info)?.[0];
      const sized = [
        ...(block ?? "").matchAll(
          /<(?:jmx_eb:)?Radius\b[^>]*>(\d+(?:\.\d+)?)</g,
        ),
      ].some((m) => Number(m[1]) > 0);
      if (!sized) continue;
      check("C6", !!read[k], `${tag}: ${k} が電文にあるのに読めていない`);
    }
  });
}

const pct = (c: Check) => (c.n ? `${c.n - c.bad.length}/${c.n}` : "0/0");
const verdict = (c: Check) =>
  !c.n ? "（数えられない）" : c.bad.length ? "**満たさない**" : "満たす";
const names: Record<string, string> = {
  C1: "読めた（problems なし・実況の中心あり）",
  C2: "中心：度と度分・文字の位置が 0.05° 以内",
  C3: "半径：読んだ値が電文の km と max(5km, 3%) 以内",
  C4: "風：ノット×0.5144 と m/s が 3 以内",
  C5: "時間：◯時間後 = 時刻の差",
  C6: "取りこぼし：電文にある域をすべて読んだ",
};
const lines = [
  `# TY-03 電文の読み方の突き合わせ（${new Date().toISOString()}）`,
  "",
  `長いフィードの台風電文：${entries.length}件（${[...kinds].map(([k, n]) => `${k} ${n}`).join("、") || "なし"}）`,
  `台風ごと：${[...byNumber].map(([k, n]) => `${k} ${n}件`).join("、") || "なし"}`,
  "",
  "| 基準 | 合った数 | 判定 |",
  "|---|---|---|",
  ...Object.keys(C).map(
    (k) => `| ${k} ${names[k]} | ${pct(C[k])} | ${verdict(C[k])} |`,
  ),
];
for (const k of Object.keys(C))
  if (C[k].bad.length)
    lines.push(
      "",
      `## ${k} 合わなかったもの`,
      "",
      ...C[k].bad.slice(0, 40).map((s) => `- ${s}`),
    );
const report = lines.join("\n") + "\n";
writeFileSync(join(out, "ty03-report.md"), report);
console.log(report);
