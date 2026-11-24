// 予報の履歴 (#250, R6): the day's issues as the screen lists them (shared/forecastHistoryModel.ts), from what
// /api/forecast-history gives for the kept telegrams (worker/src/forecastHistory.ts) on a D1 stand-in.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { changesOf, ForecastHistory, oneSource, prevOf, type Slot, tempPoints, tempSlot } from "../shared/forecastHistoryModel";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { forecastHistory } from "../worker/src/forecastHistory";
import { parseForecasts } from "../worker/src/forecastParse";
import { d1 } from "./d1";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), "utf8");

async function day(date: string) {
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
  const log = db.raw.prepare("INSERT INTO forecast_fetch_log (at, feed, ok, entries, wanted, added, left_over, error) VALUES (?, 'short', ?, 0, 0, 0, 0, ?)");
  // 11/16 17時（08:00Z）の前後：失敗が続き、補えていない → 週間の 11/16 17時は「取れなかった」。
  log.run("2026-11-16T07:55:00Z", 0, "配信一覧：HTTP 503");
  log.run("2026-11-16T08:00:00Z", 0, "配信一覧：HTTP 503");
  // 11/15 11時（02:00Z）の前後：取得は成功しているのに発表がない → 「届いていない」。
  log.run("2026-11-15T02:05:00Z", 1, null);
  const r = await forecastHistory(db, "47893", date);
  if (!r.supported) throw new Error("supported");
  return new ForecastHistory(r);
}

const brief = (s: Slot) => `${s.kind === "VPFW50" ? "週" : "府"} ${s.at.slice(5, 13).replace("T", " ")} ${s.state}`;

describe("予報の履歴：発表の回", () => {
  it("lists the day's issues in time order with their state, up to the last issue kept", async () => {
    const h = await day("2026-11-18");
    const slots = h.slots("2026-11-18");
    expect(slots.map(brief)).toMatchSnapshot();
    const at = (kind: string, iso: string) => slots.find((s) => s.kind === kind && s.at === iso)!;
    expect(at("VPFW50", "2026-11-16T17:00:00+09:00").state).toBe("failed");
    expect(at("VPFW50", "2026-11-15T11:00:00+09:00").state).toBe("notIssued");
    expect(at("VPFW50", "2026-11-12T11:00:00+09:00").state).toBe("missing");
    expect(at("VPFD51", "2026-11-17T11:00:00+09:00").state).toBe("ok");
    // 今より先の回（11/17 17時・当日の回）は出さない。
    expect(slots.at(-1)!.at).toBe("2026-11-17T11:00:00+09:00");
  });

  it("shows one issue a time: the one with numbers, 府県天気予報 when both have them (R6-10)", async () => {
    const h = await day("2026-11-18");
    const all = h.slots("2026-11-18");
    const shown = oneSource(all);
    const at11 = shown.filter((s) => s.at === "2026-11-17T11:00:00+09:00");
    expect(at11.map((s) => s.kind)).toEqual(["VPFD51"]);
    expect(new Set(shown.map((s) => s.at)).size).toBe(shown.length);
  });

  it("marks what changed from the issue before of the same kind, and says it in the list's words", async () => {
    const h = await day("2026-11-18");
    const all = h.slots("2026-11-18");
    const s = all.find((x) => x.kind === "VPFD51" && x.at === "2026-11-17T11:00:00+09:00")!;
    const p = prevOf(all, s)!;
    expect(p.at).toBe("2026-11-17T05:00:00+09:00");
    // 何が変わったかは電文しだい：印と言葉が食い違わないことを確かめる。
    const words = changesOf(s, p).map((c) => c.text);
    expect(words.some((w) => w.startsWith("降水"))).toBe(s.changed.has("pop"));
    expect(words.some((w) => w.startsWith("最高"))).toBe(s.changed.has("max"));
    expect(words.some((w) => w.startsWith("最低"))).toBe(s.changed.has("min"));
    expect(words.includes("天気")).toBe(s.changed.has("weather"));
  });

  it("does not compare a same-day issue (its values are from part of the day)", async () => {
    const h = await day("2026-11-17");
    const today = h.slots("2026-11-17").filter((s) => s.lead === 0 && s.state === "ok");
    expect(today.length).toBeGreaterThan(0);
    for (const s of today) expect([...s.changed]).toEqual([]);
    // 当日 11時の府県天気予報：過ぎた時間帯（0〜6・6〜12時）は対象期間外（null）。
    const d11 = today.find((s) => s.kind === "VPFD51" && s.at === "2026-11-17T11:00:00+09:00")!;
    expect(d11.values!.pop6!.slice(0, 2)).toEqual([null, null]);
  });
});

describe("予報の履歴：記録の無い回も今まで並べる", () => {
  it("lists the regular issues up to now as 記録なし when nothing was kept after an earlier issue", async () => {
    const h = await day("2026-11-18");
    // 記録は 11/17 11時まで。今を 11/18 12時とすると、11/17 17時・11/18 5時・11時の回も並ぶ（記録なし）。
    const slots = h.slots("2026-11-18", "2026-11-18T12:00:00+09:00");
    const after = slots.filter((s) => s.at > "2026-11-17T11:00:00+09:00");
    expect(after.map((s) => `${s.kind} ${s.at.slice(5, 13)}`)).toEqual([
      "VPFW50 11-17T17",
      "VPFD51 11-17T17",
      "VPFD51 11-18T05",
      "VPFD51 11-18T11",
    ]);
    expect(after.every((s) => s.state !== "ok")).toBe(true);
  });
});

describe("時間帯のグラフの気象庁の予報（3時間ごとの気温、2026-11-23）", () => {
  it("shows the morning's 5時 issue unless one is picked, as JMA gave it (whole degrees, no fill between)", async () => {
    const h = await day("2026-11-17");
    const slots = h.slots("2026-11-17", "2026-11-17T23:00:00+09:00");
    const s = tempSlot(slots, "2026-11-17", null)!;
    expect([s.kind, s.at]).toEqual(["VPFD51", "2026-11-17T05:00:00+09:00"]);
    // 5時の発表は 6時から：0時・3時は無い。24時（次の日の 0時）まで。
    expect(tempPoints(h, s.shown, "2026-11-17").map((p) => [p.hour, p.v])).toEqual([
      [6, 12],
      [9, 16],
      [12, 19],
      [15, 16],
      [18, 15],
      [21, 15],
      [24, 14],
    ]);
  });

  it("before 5時, or with no 5時 issue, takes the latest 府県天気予報 before it", async () => {
    const h = await day("2026-11-17");
    const early = h.slots("2026-11-17", "2026-11-17T04:00:00+09:00");
    expect(tempSlot(early, "2026-11-17", null)?.at).toBe("2026-11-16T17:00:00+09:00");
    // 次の日は、その日の 5時の発表がまだ無い：前の日の 11時。
    const next = await day("2026-11-18");
    expect(tempSlot(next.slots("2026-11-18", "2026-11-17T12:00:00+09:00"), "2026-11-18", null)?.at).toBe("2026-11-17T11:00:00+09:00");
  });

  it("follows the issue picked in 予報の移り変わり; a 週間 issue has no 3-hourly temperatures", async () => {
    const h = await day("2026-11-18");
    const slots = h.slots("2026-11-18", "2026-11-17T23:00:00+09:00");
    const d11 = slots.find((z) => z.kind === "VPFD51" && z.at === "2026-11-17T11:00:00+09:00")!;
    expect(tempSlot(slots, "2026-11-18", d11.key)).toBe(d11);
    expect(tempPoints(h, d11.shown, "2026-11-18").map((p) => p.hour)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24]);
    const w11 = slots.find((z) => z.kind === "VPFW50" && z.at === "2026-11-17T11:00:00+09:00")!;
    expect(tempSlot(slots, "2026-11-18", w11.key)).toBe(w11);
    expect(tempPoints(h, w11.shown, "2026-11-18")).toEqual([]);
  });
});

describe("予報の履歴：風（2026-11-24 渡辺さん「予報の移り変わりを風にも」、電文の読み直し parser 2）", () => {
  it("府県天気予報の回に、その日の風の文と3時間ごとの代表風。週間には無い", async () => {
    const h = await day("2026-11-18");
    const all = h.slots("2026-11-18");
    const d05 = all.find((x) => x.kind === "VPFD51" && x.at === "2026-11-17T05:00:00+09:00")!;
    expect(d05.values?.wind).toEqual({ text: "西の風　後　北西の風　やや強く　海上　では　後　北西の風　強く", from: 0 });
    expect(d05.values?.wind3).toHaveLength(8);
    expect(d05.values?.wind3?.[0]).toMatchObject({ dir: expect.any(String) });
    const w = all.find((x) => x.kind === "VPFW50" && x.state === "ok")!;
    expect(w.values?.wind ?? null).toBeNull();
  });
  it("風の文が変わったら印（同じ区切りどうしだけ）", async () => {
    const h = await day("2026-11-18");
    const all = h.slots("2026-11-18");
    const d11 = all.find((x) => x.kind === "VPFD51" && x.at === "2026-11-17T11:00:00+09:00")!;
    const p = prevOf(all, d11)!;
    expect(d11.changed.has("wind")).toBe(!!p.values?.wind && !!d11.values?.wind && p.values.wind.text !== d11.values.wind.text);
  });
});
