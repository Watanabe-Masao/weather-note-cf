// 空気質の保存（worker/src/airQuality.ts）：新しい側の抜けを先に、済んだら 2023-01-01 まで1か月ずつ古い側へ。
// 1時間に1回まで。値の無い時間は残さない。失敗は記録。

import { describe, expect, it } from "vitest";
import { AIR_FIRST_DAY, airUrl, nextRange, saveAirQuality } from "../worker/src/airQuality";
import { d1 } from "./d1";

// 2026-11-21 22:10 JST
const NOW = Date.parse("2026-11-21T13:10:00Z");

function hours(from: string, days: number, empty = false) {
  const time: string[] = [];
  for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) time.push(`${new Date(Date.parse(from) + d * 86_400_000).toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:00`);
  const v = (x: number) => time.map(() => (empty ? null : x));
  return JSON.stringify({ hourly: { time, pm2_5: v(8.2), pm10: v(12), dust: v(0), aerosol_optical_depth: v(0.11) } });
}
const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });

describe("空気質：取る範囲", () => {
  it("fills the newest gap first, a month at most, then goes back a month at a time to 2023-01-01", () => {
    expect(nextRange(null, null, "2026-11-20")).toEqual({ from: "2026-10-21", to: "2026-11-20" });
    expect(nextRange("2026-10-21", "2026-11-18", "2026-11-20")).toEqual({ from: "2026-11-19", to: "2026-11-20" });
    expect(nextRange("2026-10-21", "2026-11-20", "2026-11-20")).toEqual({ from: "2026-09-20", to: "2026-10-20" });
    expect(nextRange("2023-01-20", "2026-11-20", "2026-11-20")).toEqual({ from: AIR_FIRST_DAY, to: "2023-01-19" });
    expect(nextRange(AIR_FIRST_DAY, "2026-11-20", "2026-11-20")).toBeNull();
  });
  it("asks for the four values at Kochi by JST day", () => {
    expect(airUrl(33.56, 133.53, "2026-11-19", "2026-11-20")).toBe(
      "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=33.56&longitude=133.53&hourly=pm2_5,pm10,dust,aerosol_optical_depth&start_date=2026-11-19&end_date=2026-11-20&timezone=Asia%2FTokyo",
    );
  });
});

describe("空気質：保存と記録", () => {
  it("saves each hour once an hour at most, then the older months", async () => {
    const db = d1();
    const seen: string[] = [];
    const get = async (url: string) => {
      seen.push(url);
      const from = url.match(/start_date=([\d-]+)/)![1];
      const to = url.match(/end_date=([\d-]+)/)![1];
      return ok(hours(from, (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1));
    };
    expect(await saveAirQuality(db, NOW, get)).toEqual({ saved: 31 * 24, ok: true });
    expect(db.raw.prepare("SELECT valid_at, pm2_5, aod FROM air_quality_hourly ORDER BY valid_at DESC LIMIT 1").get()).toEqual({ valid_at: "2026-11-20T23:00:00+09:00", pm2_5: 8.2, aod: 0.11 });
    // 1時間たたないうちは取らない。
    expect(await saveAirQuality(db, NOW + 600_000, get)).toMatchObject({ skipped: true });
    expect(seen.length).toBe(1);
    await saveAirQuality(db, NOW + 3_600_000, get);
    expect(seen[1]).toContain("start_date=2026-09-20&end_date=2026-10-20");
  });
  it("keeps no hour without values, and logs a failure", async () => {
    const db = d1();
    expect(await saveAirQuality(db, NOW, async () => ok(hours("2026-10-21", 31, true)))).toEqual({ saved: 0, ok: true });
    expect(await saveAirQuality(db, NOW + 3_600_000, async () => ({ ok: false, status: 503, text: async () => "" }))).toEqual({ saved: 0, ok: false });
    expect(db.raw.prepare("SELECT ok, error FROM air_quality_fetch_log ORDER BY at DESC LIMIT 1").get()).toMatchObject({ ok: 0 });
  });
});

describe("空気質：欠けた日の取り直し（1時間だけ入った日を済んだとしない）", () => {
  it("refetches a short day first, at most once a day, and the day becomes 24 hours", async () => {
    const db = d1();
    // 11/1〜11/20 はそろっている（20日分）
    await saveAirQuality(db, NOW - 3_600_000 * 2, async () => ok(hours("2026-10-22", 30)));
    // 11/20 の分を1時間だけ残して消す（取りこぼしの代わり）
    db.raw.prepare("DELETE FROM air_quality_hourly WHERE valid_at >= '2026-11-20T01:00:00+09:00' AND valid_at < '2026-11-21T00:00:00+09:00'").run();
    const seen: string[] = [];
    const get = async (u: string) => (seen.push(u), ok(hours("2026-11-20", 1)));
    await saveAirQuality(db, NOW, get);
    expect(seen[0]).toContain("start_date=2026-11-20&end_date=2026-11-20");
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM air_quality_hourly WHERE valid_at LIKE '2026-11-20%'").get()).toEqual({ n: 24 });
  });
  it("does not ask the same short range again within a day when the provider has no value either", async () => {
    const db = d1();
    await saveAirQuality(db, NOW - 3_600_000 * 2, async () => ok(hours("2026-10-22", 30)));
    db.raw.prepare("DELETE FROM air_quality_hourly WHERE valid_at = '2026-11-20T05:00:00+09:00'").run();
    const seen: string[] = [];
    const get = async (u: string) => (seen.push(u), ok(hours("2026-11-20", 1, true)));
    await saveAirQuality(db, NOW, get);
    await saveAirQuality(db, NOW + 3_600_000, get);
    expect(seen.filter((u) => u.includes("start_date=2026-11-20&end_date=2026-11-20")).length).toBe(1);
    // 値の無い返事でも、持っている時間の値は消さない
    expect(db.raw.prepare("SELECT COUNT(pm2_5) AS n FROM air_quality_hourly WHERE valid_at LIKE '2026-11-20%'").get()).toEqual({ n: 23 });
  });
});
