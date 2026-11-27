// 空の答え合わせのための予報の履歴（worker/src/skyHistory.ts、#532 の 2・#540、2026-11-27）：
// 画面と同じ取得（予報は fetchForecast、AOD は空気質の予測の取得）で受け取った値を、受け取り終えた時刻つきで、変わった所だけ追記する。
// 前日14時の再現：締め切りちょうどまでに受け取った値に絞ってから、出典の優先順位で選ぶ。直後の値を混ぜない。
import { describe, expect, it } from "vitest";
import type { Station } from "../shared/types";
import { saveAirForecast } from "../worker/src/airForecast";
import { dayBeforeCutoff, historyRange, recordSkyHistory, saveSkyForecast, skyAsOf, validAtOf } from "../worker/src/skyHistory";
import { d1 } from "./d1";

const KOCHI = { blockNo: "47893", lat: [33, 34], lon: [133, 33] } as unknown as Station;
const H = 3_600_000;
/** 11/25 の日本時間 hh:mm(:ss)。 */
const at = (jst: string) => Date.parse(`2026-11-25T${jst}+09:00`);
const iso = (t: number) => new Date(t).toISOString();

function times(from: string, days: number) {
  const t: string[] = [];
  for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) t.push(`${new Date(Date.parse(from) + d * 86_400_000).toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:00`);
  return t;
}
type F = (i: number) => number | null;
/** Open-Meteo の予報の応答（16日、今日 0:00 から）。i は今日 0:00 からの時間。 */
function forecastBody(o: { code?: F; rain?: F; cover?: F; vis?: F } = {}) {
  const t = times("2026-11-25", 16);
  const s = (f: F | undefined, d: number) => t.map((_, i) => (f ? f(i) : d));
  const days = t.filter((x) => x.endsWith("T00:00")).map((x) => x.slice(0, 10));
  return JSON.stringify({
    latitude: 33.5625,
    longitude: 133.5625,
    hourly: { time: t, weather_code: s(o.code, 3), precipitation: s(o.rain, 0), cloud_cover: s(o.cover, 62), visibility: s(o.vis, 24_140), temperature_2m: s(undefined, 10) },
    daily: { time: days, weather_code: days.map(() => 3) },
  });
}
/** 取りに行くと、時計が `takes` ミリ秒進んでから応答が届く。 */
function server(clock: { t: number }, body: () => string, takes = 0, status = 200) {
  const seen: string[] = [];
  const get = async (url: string) => {
    seen.push(url);
    clock.t += takes;
    return { ok: status === 200, status, text: async () => body() };
  };
  return { get, seen };
}
const run = (db: ReturnType<typeof d1>, start: number, body: () => string, takes = 0, status = 200) => {
  const clock = { t: start };
  const s = server(clock, body, takes, status);
  return saveSkyForecast(db, [KOCHI], start, { get: s.get, clock: () => clock.t });
};

describe("空の予報の履歴：保存", () => {
  it("範囲は受け取った日の 1:00〜翌々日の 0:00（今日と明日の JMA の時間 1〜24）。24 時は次の日の 0:00", () => {
    expect(historyRange(iso(at("10:20:00")))).toEqual({ from: "2026-11-25T01:00:00+09:00", to: "2026-11-27T00:00:00+09:00" });
    expect(validAtOf("2026-11-26", 24)).toBe("2026-11-27T00:00:00+09:00");
    expect(validAtOf("2026-11-26", 3)).toBe("2026-11-26T03:00:00+09:00");
  });
  it("画面と同じ予報の取得（信頼度は取らない）。初回は範囲の全部、同じ値の回は足さない、変わった値だけ。1時間に1回まで", async () => {
    const db = d1();
    const clock = { t: at("10:20:00") };
    const a = server(clock, () => forecastBody());
    expect(await saveSkyForecast(db, [KOCHI], clock.t, { get: a.get, clock: () => clock.t })).toEqual({ appended: 48 * 4, ok: true });
    expect(a.seen).toHaveLength(1);
    expect(a.seen[0]).toContain("cloud_cover");
    expect(await run(db, at("10:30:00"), () => forecastBody())).toMatchObject({ skipped: true });
    expect(await run(db, at("11:21:00"), () => forecastBody())).toEqual({ appended: 0, ok: true });
    // 明日 3時の全雲量だけ 62 → 80
    expect(await run(db, at("12:22:00"), () => forecastBody({ cover: (i) => (i === 27 ? 80 : 62) }))).toEqual({ appended: 1, ok: true });
    const log = db.raw.prepare("SELECT source, via, ok, req_lat, grid_lat, appended FROM sky_forecast_fetch_log ORDER BY at").all();
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ source: "open-meteo-forecast", via: "cron", ok: 1, grid_lat: 33.5625, appended: 192 });
    // 視程は km（20 km で止める前の値）、単位と出典は行ごと
    expect(db.raw.prepare("SELECT unit, source, value FROM sky_forecast_history WHERE item = 'visibility' LIMIT 1").get()).toEqual({ unit: "km", source: "open-meteo-forecast", value: 24.1 });
  });
  it("明日の最後の1時間の降水（翌々日 0:00）を残す。0 は値、値の無い時間は missing。取れなかった回は行を足さず、記録に失敗", async () => {
    const db = d1();
    await run(db, at("10:20:00"), () => forecastBody({ rain: (i) => (i === 48 ? 2.5 : 0) }));
    expect(db.raw.prepare("SELECT value FROM sky_forecast_history WHERE item = 'rain' AND valid_at = '2026-11-27T00:00:00+09:00'").get()).toEqual({ value: 2.5 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sky_forecast_history WHERE item = 'rain' AND value = 0").get()).toEqual({ n: 47 });
    expect(await run(db, at("11:21:00"), () => forecastBody({ rain: (i) => (i === 48 ? 2.5 : 0), cover: (i) => (i <= 10 ? null : 62) }))).toEqual({ appended: 10, ok: true });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sky_forecast_history WHERE item = 'cover' AND status = 'missing' AND value IS NULL").get()).toEqual({ n: 10 });
    expect(await run(db, at("12:22:00"), () => "", 0, 503)).toEqual({ appended: 0, ok: false });
    expect(db.raw.prepare("SELECT ok, error FROM sky_forecast_fetch_log ORDER BY at DESC LIMIT 1").get()).toEqual({ ok: 0, error: "予報の取得に失敗しました（503）。" });
  });
  it("AOD は空気質の予測の取得の応答から、受け取った時刻で（別に問い合わせない）", async () => {
    const db = d1();
    const t = times("2026-11-25", 5);
    const body = JSON.stringify({ latitude: 33.55, longitude: 133.55, hourly: { time: t, pm2_5: t.map(() => 8), pm10: t.map(() => 12), dust: t.map(() => 0), aerosol_optical_depth: t.map((_, i) => (i === 30 ? 0.3 : 0.1)) } });
    const clock = { t: at("10:20:00") };
    const seen: string[] = [];
    await saveAirForecast(db, clock.t, async (url) => (seen.push(url), (clock.t += 3000), { ok: true, status: 200, text: async () => body }), () => clock.t);
    expect(seen).toHaveLength(1);
    expect(db.raw.prepare("SELECT COUNT(*) AS n, MIN(fetched_at) AS f FROM sky_forecast_history WHERE item = 'aod'").get()).toEqual({ n: 48, f: iso(at("10:20:03")) });
    expect(db.raw.prepare("SELECT value FROM sky_forecast_history WHERE item = 'aod' AND valid_at = '2026-11-26T06:00:00+09:00'").get()).toEqual({ value: 0.3 });
  });
});

describe("空の予報の履歴：前日14時の再現", () => {
  // 対象日 11/26、締め切り 11/25 14:00 JST（05:00Z）
  const cutoff = dayBeforeCutoff("2026-11-26");
  const V = "2026-11-26T03:00:00+09:00";
  it("締め切りは前の日の 14:00 JST", () => {
    expect(cutoff).toBe("2026-11-25T05:00:00.000Z");
  });
  it("取得時刻は受け取り終えた時刻：13:59:59 に頼み 14:00:02 に届いた値は締め切りに入らない", async () => {
    const db = d1();
    await run(db, at("12:20:00"), () => forecastBody({ cover: () => 40 }));
    await run(db, at("13:59:59"), () => forecastBody({ cover: () => 55 }), 3000);
    expect(db.raw.prepare("SELECT MAX(fetched_at) AS f FROM sky_forecast_history").get()).toEqual({ f: iso(at("14:00:02")) });
    expect(await skyAsOf(db, "47893", "cover", V, cutoff)).toMatchObject({ value: 40, source: "open-meteo-forecast", fetchedAt: iso(at("12:20:00")), confirmedAt: iso(at("12:20:00")) });
  });
  it("14時ちょうどに受け取った値は使い、直後の値は混ぜない。旧値の取得時刻は、変わらない回でも書き換えない", async () => {
    const db = d1();
    await run(db, at("10:20:00"), () => forecastBody({ cover: () => 40 }));
    await run(db, at("12:20:00"), () => forecastBody({ cover: () => 40 })); // 同じ値（行は足さない）
    await run(db, at("13:59:58"), () => forecastBody({ cover: () => 55 }), 2000); // 14:00:00 ちょうどに届く
    await run(db, at("15:01:00"), () => forecastBody({ cover: () => 90 }));
    expect(await skyAsOf(db, "47893", "cover", V, cutoff)).toMatchObject({ value: 55, unit: "%", status: "ok", fetchedAt: iso(at("14:00:00")) });
    // 13時の締め切りなら、10:20 に受け取った値（12:20 に確かめたが、取得時刻は 10:20 のまま）
    expect(await skyAsOf(db, "47893", "cover", V, iso(at("13:00:00")))).toMatchObject({ value: 40, fetchedAt: iso(at("10:20:00")), confirmedAt: iso(at("12:20:00")) });
  });
  it("締め切り前の最後の回が欠測なら missing と、その前に受け取った値・時刻。取れなかった回は確かめた時刻にしない", async () => {
    const db = d1();
    await run(db, at("10:20:00"), () => forecastBody({ vis: () => 8000 }));
    await run(db, at("11:30:00"), () => forecastBody({ vis: () => null }));
    await run(db, at("13:00:00"), () => "", 0, 500);
    expect(await skyAsOf(db, "47893", "visibility", V, cutoff)).toMatchObject({ status: "missing", value: 8, fetchedAt: iso(at("10:20:00")), confirmedAt: iso(at("11:30:00")) });
  });
  it("対象日の最後の1時間の降水（翌々日 0:00）も前日14時に再現できる。履歴の無い日・項目は none（再現不可）", async () => {
    const db = d1();
    await run(db, at("10:20:00"), () => forecastBody({ rain: (i) => (i === 48 ? 1.5 : 0) }));
    expect(await skyAsOf(db, "47893", "rain", "2026-11-27T00:00:00+09:00", cutoff)).toMatchObject({ value: 1.5, unit: "mm/h", status: "ok" });
    expect(await skyAsOf(db, "47893", "rain", "2026-11-26T01:00:00+09:00", cutoff)).toMatchObject({ value: 0, status: "ok" });
    expect(await skyAsOf(db, "47893", "rain", "2026-11-28T03:00:00+09:00", dayBeforeCutoff("2026-11-28"))).toMatchObject({ status: "none", source: null, value: null, fetchedAt: null, confirmedAt: null });
    expect(await skyAsOf(db, "47893", "aod", V, cutoff)).toMatchObject({ status: "none" });
  });
  it("出典ごとに受け取った時刻で残す（予報と AOD は別の時刻）", async () => {
    const db = d1();
    await recordSkyHistory(db, { station: "47893", source: "open-meteo-cams", via: "cron", receivedAt: iso(at("13:55:00")), values: [{ item: "aod", validAt: V, value: 0.2 }] });
    await recordSkyHistory(db, { station: "47893", source: "open-meteo-cams", via: "cron", receivedAt: iso(at("14:05:00")), values: [{ item: "aod", validAt: V, value: 0.4 }] });
    expect(await skyAsOf(db, "47893", "aod", V, cutoff)).toMatchObject({ value: 0.2, source: "open-meteo-cams", fetchedAt: iso(at("13:55:00")) });
  });
});
