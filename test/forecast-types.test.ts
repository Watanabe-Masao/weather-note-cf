// 予報が外れやすい型（shared/forecastTypes.ts、FS-05、2026-11-24 に固定）：条件と、保存した電文からの材料の作り方。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bigMiss, FORECAST_TYPES, type LeadForecast, leadLookup, matchedTypes, TYPES_FROZEN_AT } from "../shared/forecastTypes";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { forecastHistory } from "../worker/src/forecastHistory";
import { parseForecasts } from "../worker/src/forecastParse";
import { d1 } from "./d1";

/** 表の形の材料：table[t][L] */
const lookup = (table: Record<string, Record<number, LeadForecast>>) => (t: string, L: number) => table[t]?.[L];
const type = (id: string) => FORECAST_TYPES.find((x) => x.id === id)!;

describe("型の定義（固定）", () => {
  it("is fixed on 2026-11-24 with unique ids, and each says what JMA's forecast it reads", () => {
    expect(TYPES_FROZEN_AT).toBe("2026-11-24");
    expect(new Set(FORECAST_TYPES.map((x) => x.id)).size).toBe(FORECAST_TYPES.length);
    for (const x of FORECAST_TYPES) expect(x.expected.ci[0]).toBeGreaterThan(1);
  });

  it("A: the day before, the minimum raised by 2℃ or more since 7 days before", () => {
    const steps = (vals: number[]) => Object.fromEntries(vals.map((v, i) => [i + 1, { min: v }])); // 1日前…7日前
    expect(type("A-min-raised-L1").match("2026-12-01", 1, lookup({ "2026-12-01": steps([6, 5, 5, 4, 4, 4, 4]) }))).toBe(true);
    expect(type("A-min-raised-L1").match("2026-12-01", 1, lookup({ "2026-12-01": steps([5, 5, 5, 4, 4, 4, 4]) }))).toBe(false);
    // 7日前までそろわなければ判定しない
    expect(type("A-min-raised-L1").match("2026-12-01", 1, lookup({ "2026-12-01": steps([6, 5, 5, 4]) }))).toBe(false);
  });

  it("B: rain chance 50% or more 2–3 days before; only 50–60% 4–7 days before", () => {
    const f = (pop: number) => lookup({ "2026-12-01": { 2: { pop }, 5: { pop } } });
    expect(type("B-max-rain-L2-3").match("2026-12-01", 2, f(70))).toBe(true);
    expect(type("B-max-rain-L4-7").match("2026-12-01", 5, f(70))).toBe(false);
    expect(type("B-max-rain-L4-7").match("2026-12-01", 5, f(60))).toBe(true);
  });

  it("G: summer, cloudy, 30–40%; E: turning months, a drop of 2–3℃ from the day before; C: moved 2–3℃ from the issue before", () => {
    const g = lookup({ "2027-07-10": { 3: { pop: 40, wx: "くもり" } }, "2026-12-10": { 3: { pop: 40, wx: "くもり" } } });
    expect(type("G-rain-summer-cloudy-L2-3").match("2027-07-10", 3, g)).toBe(true);
    expect(type("G-rain-summer-cloudy-L2-3").match("2026-12-10", 3, g)).toBe(false);
    // 同じ日（11/24）に出た予報：11/29 の最低 5、11/28 の最低 8 → 3℃下がる
    const e = lookup({ "2026-11-29": { 5: { min: 5 } }, "2026-11-28": { 4: { min: 8 } } });
    expect(type("E-min-turning-drop-L4-7").match("2026-11-29", 5, e)).toBe(true);
    const c = (a: number) => lookup({ "2026-12-01": Object.fromEntries([3, 4, 5, 6, 7].map((l) => [l, { max: l === 3 ? a : 15 }])) });
    expect(type("C-max-moved-L2-3").match("2026-12-01", 3, c(18))).toBe(true);
    expect(type("C-max-moved-L2-3").match("2026-12-01", 3, c(19))).toBe(false); // 4℃は「2〜3℃」でない
  });

  it("calls a miss big at more than 2℃, and a rain miss when below 50% and 1mm or more fell", () => {
    expect(bigMiss("min", { min: 6 }, { min: 3.9 })).toBe(true);
    expect(bigMiss("min", { min: 6 }, { min: 4 })).toBe(false);
    expect(bigMiss("rainMiss", { pop: 40 }, { rainMm: 1.5 })).toBe(true);
    expect(bigMiss("rainMiss", { pop: 60 }, { rainMm: 3 })).toBeNull();
  });
});

describe("材料：保存した電文から", () => {
  const fixture = (name: string) => readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), "utf8");
  it("reads the latest issue of the day before for each target day and lead", async () => {
    const db = d1();
    await ensureForecastSchema(db);
    const keep = (id: string, kind: string, xml: string) =>
      db.raw
        .prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, ?, '390000', 'u', ?, '2026-11-17T02:00:00Z', 'h', ?)")
        .run(id, kind, /<ReportDateTime>([^<]+)</.exec(xml)?.[1] ?? null, xml);
    keep("d17", "VPFD51", fixture("vpfd51-390000-1700.xml"));
    keep("d05", "VPFD51", fixture("vpfd51-390000-0500.xml"));
    keep("d11", "VPFD51", fixture("vpfd51-390000-1100.xml"));
    keep("w11", "VPFW50", fixture("vpfw50-390000-1100.xml"));
    await parseForecasts(db, 50);
    const r = await forecastHistory(db, "47893", "2026-11-19");
    if (!r.supported) throw new Error("supported");
    const fc = leadLookup(r, "2026-11-17T12:00:00+09:00");
    // 11/19 の 2日前（11/17 に出た）：気温は週間の 11時、天気は府県の 11時、降水確率は週間
    const f = fc("2026-11-19", 2)!;
    expect(f.max).toBe(16);
    expect(f.min).toBe(8);
    expect(f.pop).toBe(30);
    expect(["晴", "くもり", "雨", "雪"]).toContain(f.wx);
    // 型の当てはまりは、そろう材料だけで判定する（7日前の発表が無いので動きの型は当てはまらない）
    expect(matchedTypes("2026-11-19", fc).every((m) => !m.type.id.startsWith("C-") && !m.type.id.startsWith("A-"))).toBe(true);
  });
});
