// 空気質の予測（worker/src/airForecast.ts、2026-11-25）：1時間に1回まで、今日から5日分を地点ごとに丸ごと置き換える。
// 値の無い時間は残さない。取れた値が無ければ前の分を残す。画面用の読み出し（今日と先の日は予測、過ぎた日は終わった日の値）。
import { describe, expect, it } from "vitest";
import { airForecastUrl, readAir, saveAirForecast } from "../worker/src/airForecast";
import { ensureAirSchema } from "../worker/src/airQuality";
import { d1 } from "./d1";

// 2026-11-25 10:20 JST
const NOW = Date.parse("2026-11-25T01:20:00Z");

function body(from: string, days: number, pm: (i: number) => number | null = () => 8) {
  const time: string[] = [];
  for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) time.push(`${new Date(Date.parse(from) + d * 86_400_000).toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:00`);
  const v = (f: (i: number) => number | null) => time.map((_, i) => f(i));
  return JSON.stringify({ hourly: { time, pm2_5: v(pm), pm10: v((i) => (pm(i) == null ? null : 12)), dust: v((i) => (pm(i) == null ? null : i % 24)), aerosol_optical_depth: v((i) => (pm(i) == null ? null : 0.1)) } });
}
const ok = (b: string) => ({ ok: true, status: 200, text: async () => b });

describe("空気質の予測：取得と置き換え", () => {
  it("asks for today and the next 4 days at Kochi", () => {
    expect(airForecastUrl(33.56, 133.53, "2026-11-25", "2026-11-29")).toBe(
      "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=33.56&longitude=133.53&hourly=pm2_5,pm10,dust,aerosol_optical_depth&start_date=2026-11-25&end_date=2026-11-29&timezone=Asia%2FTokyo",
    );
  });
  it("replaces the whole forecast once an hour at most, keeps no hour without values", async () => {
    const db = d1();
    const seen: string[] = [];
    // 5日目の後ろ半分はまだ計算に無い（null）
    const get = async (url: string) => (seen.push(url), ok(body("2026-11-25", 5, (i) => (i >= 108 ? null : 8))));
    expect(await saveAirForecast(db, NOW, get)).toEqual({ saved: 108, ok: true });
    expect(seen[0]).toContain("start_date=2026-11-25&end_date=2026-11-29");
    expect(await saveAirForecast(db, NOW + 600_000, get)).toMatchObject({ skipped: true });
    // 次の計算：値が変わる・先の時間が増える。前の分は残らない（丸ごと置き換え）。
    expect(await saveAirForecast(db, NOW + 3_600_000, async () => ok(body("2026-11-25", 5, () => 20)))).toEqual({ saved: 120, ok: true });
    expect(db.raw.prepare("SELECT COUNT(*) AS n, MIN(pm2_5) AS lo FROM air_quality_forecast").get()).toEqual({ n: 120, lo: 20 });
  });
  it("keeps the last forecast when the new one has no value or fails, and logs it", async () => {
    const db = d1();
    await saveAirForecast(db, NOW, async () => ok(body("2026-11-25", 5)));
    expect(await saveAirForecast(db, NOW + 3_600_000, async () => ok(body("2026-11-25", 5, () => null)))).toEqual({ saved: 0, ok: false });
    expect(await saveAirForecast(db, NOW + 2 * 3_600_000, async () => ({ ok: false, status: 503, text: async () => "" }))).toEqual({ saved: 0, ok: false });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM air_quality_forecast").get()).toEqual({ n: 120 });
    expect(db.raw.prepare("SELECT ok, error FROM air_forecast_fetch_log ORDER BY at DESC LIMIT 1").get()).toMatchObject({ ok: 0 });
  });
});

describe("空気質の読み出し（/api/air）", () => {
  it("today and later from the forecast, a past day from the finished days", async () => {
    const db = d1();
    await saveAirForecast(db, NOW, async () => ok(body("2026-11-25", 5)));
    const today = await readAir(db, "47893", "2026-11-25", "2026-11-25");
    expect(today).toMatchObject({ kind: "forecast", date: "2026-11-25", source: "Open-Meteo（CAMS）" });
    expect(today.hours.length).toBe(24);
    expect(today.hours[13]).toEqual({ h: 13, pm2_5: 8, pm10: 12, dust: 13, aod: 0.1 });
    expect(today.fetchedAt).toBe(new Date(NOW).toISOString());
    await ensureAirSchema(db);
    db.raw
      .prepare("INSERT INTO air_quality_hourly (station, valid_at, pm2_5, pm10, dust, aod, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("47893", "2026-11-24T09:00:00+09:00", 5, 9, 1, 0.08, "open-meteo-cams", "2026-11-25T00:00:00Z");
    // 値の無い印の行（古い側の提供前）は出さない
    db.raw
      .prepare("INSERT INTO air_quality_hourly (station, valid_at, pm2_5, pm10, dust, aod, source, fetched_at) VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?)")
      .run("47893", "2026-11-24T00:00:00+09:00", "open-meteo-cams", "2026-11-25T00:00:00Z");
    expect(await readAir(db, "47893", "2026-11-24", "2026-11-25")).toMatchObject({ kind: "past", hours: [{ h: 9, pm2_5: 5, pm10: 9, dust: 1, aod: 0.08 }] });
    expect((await readAir(db, "47893", "2026-11-20", "2026-11-25")).hours).toEqual([]);
  });
});
