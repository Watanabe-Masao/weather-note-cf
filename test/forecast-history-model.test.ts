// 予報の履歴 (#250, R6): the day's issues as the screen lists them (shared/forecastHistoryModel.ts), from what
// /api/forecast-history gives for the kept telegrams (worker/src/forecastHistory.ts) on a D1 stand-in.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { changesOf, ForecastHistory, oneSource, prevOf, type Slot } from "../shared/forecastHistoryModel";
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
