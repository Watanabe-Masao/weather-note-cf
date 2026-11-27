// 空の答え合わせのための予報の履歴（worker/src/skyHistory.ts、#532 の 2、2026-11-27）：
// 天気コード・降水量・全雲量・視程・AOD を、項目ごとの実取得時刻とともに、変わった所だけ追記する。
// 前日14時の再現：締め切りちょうどまでに受け取った値を選び、直後の値を混ぜない。欠測・取れなかった回・旧値の時刻・履歴の無い日。
import { describe, expect, it } from "vitest";
import type { Station } from "../shared/types";
import { dayBeforeCutoff, saveSkyHistory, skyAodUrl, skyAsOf, skyForecastUrl } from "../worker/src/skyHistory";
import { d1 } from "./d1";

const KOCHI = { blockNo: "47893", lat: [33, 34], lon: [133, 33] } as unknown as Station;
// 2026-11-25 10:20 JST
const NOW = Date.parse("2026-11-25T01:20:00Z");
const H = 3_600_000;

function hours(from: string, days: number) {
  const time: string[] = [];
  for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) time.push(`${new Date(Date.parse(from) + d * 86_400_000).toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:00`);
  return time;
}
type Vals = { code?: (i: number) => number | null; rain?: (i: number) => number | null; cover?: (i: number) => number | null; vis?: (i: number) => number | null; aod?: (i: number) => number | null };
function server(from: string, v: Vals = {}, fail: { forecast?: number; cams?: number } = {}) {
  const time = hours(from, 2);
  const s = (f: ((i: number) => number | null) | undefined, d: number | null) => time.map((_, i) => (f ? f(i) : d));
  const seen: string[] = [];
  const get = async (url: string) => {
    seen.push(url);
    const cams = url.includes("air-quality");
    const st = cams ? fail.cams : fail.forecast;
    if (st) return { ok: false, status: st, text: async () => "" };
    const body = cams
      ? { latitude: 33.55, longitude: 133.55, hourly: { time, aerosol_optical_depth: s(v.aod, 0.12) } }
      : { latitude: 33.5625, longitude: 133.5625, hourly: { time, weather_code: s(v.code, 3), precipitation: s(v.rain, 0), cloud_cover: s(v.cover, 62), visibility: s(v.vis, 24_140) } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { get, seen };
}

describe("空の予報の履歴：保存", () => {
  it("今日と明日の1時間ごとを、アプリの予報と同じ座標（天気）・空気質と同じ位置（AOD）で頼む", () => {
    expect(skyForecastUrl("33.56666666666667", "133.55", "2026-11-25", "2026-11-26")).toBe(
      "https://api.open-meteo.com/v1/forecast?latitude=33.56666666666667&longitude=133.55&timezone=Asia%2FTokyo&hourly=weather_code%2Cprecipitation%2Ccloud_cover%2Cvisibility&start_date=2026-11-25&end_date=2026-11-26",
    );
    expect(skyAodUrl(33.56, 133.53, "2026-11-25", "2026-11-26")).toContain("hourly=aerosol_optical_depth&domains=cams_global");
  });
  it("初回は全部、同じ値の回は足さない、変わった値だけ足す。1時間に1回まで（日付が変われば すぐ）", async () => {
    const db = d1();
    const a = server("2026-11-25");
    expect(await saveSkyHistory(db, [KOCHI], NOW, a.get)).toEqual({ appended: 48 * 5, ok: true });
    expect(a.seen).toHaveLength(2);
    expect(await saveSkyHistory(db, [KOCHI], NOW + 600_000, a.get)).toMatchObject({ skipped: true });
    expect(await saveSkyHistory(db, [KOCHI], NOW + H, a.get)).toEqual({ appended: 0, ok: true });
    // 2時間後：明日 3時の全雲量だけ 62 → 80
    const b = server("2026-11-25", { cover: (i) => (i === 27 ? 80 : 62) });
    expect(await saveSkyHistory(db, [KOCHI], NOW + 2 * H, b.get)).toEqual({ appended: 1, ok: true });
    const log = db.raw.prepare("SELECT source, ok, req_lat, grid_lat, grid_lon, appended FROM sky_forecast_fetch_log ORDER BY at, source").all();
    expect(log).toHaveLength(6);
    expect(log[0]).toMatchObject({ source: "open-meteo-cams", ok: 1, req_lat: 33.56, grid_lat: 33.55 });
    expect(log[1]).toMatchObject({ source: "open-meteo-forecast", ok: 1, grid_lat: 33.5625, grid_lon: 133.5625, appended: 192 });
    // 単位と出典は行ごと。視程は m のまま（20 km で止めない）
    expect(db.raw.prepare("SELECT unit, source, value FROM sky_forecast_history WHERE item = 'visibility' LIMIT 1").get()).toEqual({ unit: "m", source: "open-meteo-forecast", value: 24_140 });
  });
  it("0 は値、値の無い時間は missing の行。取れなかった回は行を足さず、記録に失敗（ほかの出典は続ける）", async () => {
    const db = d1();
    await saveSkyHistory(db, [KOCHI], NOW, server("2026-11-25", { cover: () => 0 }).get);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sky_forecast_history WHERE item = 'cover' AND status = 'ok' AND value = 0").get()).toEqual({ n: 48 });
    expect(await saveSkyHistory(db, [KOCHI], NOW + H, server("2026-11-25", { cover: (i) => (i < 10 ? null : 0) }, { cams: 503 }).get)).toEqual({ appended: 10, ok: false });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sky_forecast_history WHERE item = 'cover' AND status = 'missing' AND value IS NULL").get()).toEqual({ n: 10 });
    expect(db.raw.prepare("SELECT ok, error FROM sky_forecast_fetch_log WHERE source = 'open-meteo-cams' ORDER BY at DESC LIMIT 1").get()).toEqual({ ok: 0, error: "open-meteo-cams: HTTP 503" });
  });
});

describe("空の予報の履歴：前日14時の再現", () => {
  // 対象日 11/26、締め切り 11/25 14:00 JST（05:00Z）
  const cutoff = dayBeforeCutoff("2026-11-26");
  const at = (jst: string) => Date.parse(`2026-11-25T${jst}:00+09:00`);
  it("締め切りは前の日の 14:00 JST", () => {
    expect(cutoff).toBe("2026-11-25T05:00:00.000Z");
  });
  it("14時ちょうどに受け取った値は使い、直後の値は混ぜない。旧値の取得時刻は、変わらない回でも書き換えない", async () => {
    const db = d1();
    await saveSkyHistory(db, [KOCHI], at("10:20"), server("2026-11-25", { cover: () => 40 }).get);
    await saveSkyHistory(db, [KOCHI], at("12:20"), server("2026-11-25", { cover: () => 40 }).get); // 同じ値（行は足さない）
    await saveSkyHistory(db, [KOCHI], at("14:00"), server("2026-11-25", { cover: () => 55 }).get);
    await saveSkyHistory(db, [KOCHI], at("14:01") + H, server("2026-11-25", { cover: () => 90 }).get);
    const r = await skyAsOf(db, "47893", "cover", "2026-11-26T03:00:00+09:00", cutoff);
    expect(r).toMatchObject({ value: 55, unit: "%", status: "ok", fetchedAt: new Date(at("14:00")).toISOString(), confirmedAt: new Date(at("14:00")).toISOString() });
    // 13時の締め切りなら、10:20 に受け取った値（12:20 に確かめたが、取得時刻は 10:20 のまま）
    const early = await skyAsOf(db, "47893", "cover", "2026-11-26T03:00:00+09:00", new Date(at("13:00")).toISOString());
    expect(early).toMatchObject({ value: 40, fetchedAt: new Date(at("10:20")).toISOString(), confirmedAt: new Date(at("12:20")).toISOString() });
  });
  it("締め切り前の最後の回が欠測なら missing、その前に受け取った値と時刻も返す。取れなかった回は確かめた時刻にしない", async () => {
    const db = d1();
    await saveSkyHistory(db, [KOCHI], at("10:20"), server("2026-11-25", { aod: () => 0.2 }).get);
    await saveSkyHistory(db, [KOCHI], at("11:30"), server("2026-11-25", { aod: () => null }).get);
    await saveSkyHistory(db, [KOCHI], at("13:00"), server("2026-11-25", {}, { cams: 500 }).get);
    const r = await skyAsOf(db, "47893", "aod", "2026-11-26T09:00:00+09:00", cutoff);
    expect(r).toMatchObject({ status: "missing", value: 0.2, fetchedAt: new Date(at("10:20")).toISOString(), confirmedAt: new Date(at("11:30")).toISOString() });
  });
  it("0時の降水（前の日の 24 時）は、その日の 0:00 の対象時刻。履歴の無い日・項目は none（前日14時時点の再現不可）", async () => {
    const db = d1();
    await saveSkyHistory(db, [KOCHI], at("10:20"), server("2026-11-25", { rain: (i) => (i === 24 ? 1.5 : 0) }).get);
    expect(await skyAsOf(db, "47893", "rain", "2026-11-26T00:00:00+09:00", cutoff)).toMatchObject({ value: 1.5, unit: "mm/h", status: "ok" });
    expect(await skyAsOf(db, "47893", "rain", "2026-11-28T00:00:00+09:00", dayBeforeCutoff("2026-11-28"))).toMatchObject({ status: "none", value: null, fetchedAt: null, confirmedAt: null });
  });
});
