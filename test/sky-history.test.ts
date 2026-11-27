// 空の答え合わせのための予報の履歴（worker/src/skyHistory.ts、#532 の 2・#540、2026-11-27）：
// 画面と同じ取得（予報は fetchForecast、AOD は空気質の予測の取得）で受け取った値を、受け取り終えた時刻つきで、値が同じでも回ごとに全部追記する（保存の順によらない）。
// 前日14時の再現：締め切りちょうどまでに受け取った値に絞ってから、出典の優先順位で選ぶ。直後の値を混ぜない。
import { describe, expect, it } from "vitest";
import type { Station } from "../shared/types";
import { saveAirForecast } from "../worker/src/airForecast";
import { dayBeforeCutoff, ensureSkyHistorySchema, fetchDue, historyRange, recordSkyHistory, saveSkyForecast, skyAsOf, validAtOf } from "../worker/src/skyHistory";
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
function forecastBody(o: { code?: F; rain?: F; cover?: F; vis?: F; low?: F } = {}) {
  const t = times("2026-11-25", 16);
  const s = (f: F | undefined, d: number) => t.map((_, i) => (f ? f(i) : d));
  const days = t.filter((x) => x.endsWith("T00:00")).map((x) => x.slice(0, 10));
  return JSON.stringify({
    latitude: 33.5625,
    longitude: 133.5625,
    hourly: {
      time: t,
      weather_code: s(o.code, 3),
      precipitation: s(o.rain, 0),
      cloud_cover: s(o.cover, 62),
      cloud_cover_low: s(o.low, 10),
      cloud_cover_mid: s(undefined, 30),
      cloud_cover_high: s(undefined, 55),
      visibility: s(o.vis, 24_140),
      temperature_2m: s(undefined, 10),
    },
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
  it("画面と同じ予報の取得（信頼度は取らない）。受け取った回ごとに範囲の全部（同じ値でも）。1時間に1回まで", async () => {
    const db = d1();
    const clock = { t: at("10:20:00") };
    const a = server(clock, () => forecastBody());
    expect(await saveSkyForecast(db, [KOCHI], clock.t, { get: a.get, clock: () => clock.t })).toEqual({ appended: 48 * 7, ok: true });
    expect(a.seen).toHaveLength(1);
    expect(a.seen[0]).toContain("cloud_cover");
    expect(await run(db, at("10:30:00"), () => forecastBody())).toMatchObject({ skipped: true });
    expect(await run(db, at("11:21:00"), () => forecastBody())).toEqual({ appended: 48 * 7, ok: true });
    // 明日 3時の全雲量だけ 62 → 80（それでも回の全部を残す）
    expect(await run(db, at("12:22:00"), () => forecastBody({ cover: (i) => (i === 27 ? 80 : 62) }))).toEqual({ appended: 48 * 7, ok: true });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sky_forecast_values WHERE item = 'cover' AND valid_at = '2026-11-26T03:00:00+09:00'").get()).toEqual({ n: 3 });
    const log = db.raw.prepare("SELECT source, via, ok, req_lat, grid_lat, appended FROM sky_forecast_receipts ORDER BY at").all();
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ source: "open-meteo-forecast", via: "cron", ok: 1, grid_lat: 33.5625, appended: 336 });
    // 視程は km（20 km で止める前の値）、単位と出典は行ごと
    expect(db.raw.prepare("SELECT unit, source, value FROM sky_forecast_values WHERE item = 'visibility' LIMIT 1").get()).toEqual({ unit: "km", source: "open-meteo-forecast", value: 24.1 });
  });
  it("明日の最後の1時間の降水（翌々日 0:00）を残す。0 は値、値の無い時間は missing。取れなかった回は行を足さず、記録に失敗", async () => {
    const db = d1();
    await run(db, at("10:20:00"), () => forecastBody({ rain: (i) => (i === 48 ? 2.5 : 0) }));
    expect(db.raw.prepare("SELECT value FROM sky_forecast_values WHERE item = 'rain' AND valid_at = '2026-11-27T00:00:00+09:00'").get()).toEqual({ value: 2.5 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sky_forecast_values WHERE item = 'rain' AND value = 0").get()).toEqual({ n: 47 });
    expect(await run(db, at("11:21:00"), () => forecastBody({ rain: (i) => (i === 48 ? 2.5 : 0), cover: (i) => (i <= 10 ? null : 62) }))).toEqual({ appended: 48 * 7, ok: true });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sky_forecast_values WHERE item = 'cover' AND status = 'missing' AND value IS NULL").get()).toEqual({ n: 10 });
    expect(await run(db, at("12:22:00"), () => "", 0, 503)).toEqual({ appended: 0, ok: false });
    expect(db.raw.prepare("SELECT ok, error FROM sky_forecast_receipts ORDER BY at DESC LIMIT 1").get()).toEqual({ ok: 0, error: "予報の取得に失敗しました（503）。" });
  });
  it("AOD は空気質の予測の取得の応答から、受け取った時刻で（別に問い合わせない）", async () => {
    const db = d1();
    const t = times("2026-11-25", 5);
    const body = JSON.stringify({ latitude: 33.55, longitude: 133.55, hourly: { time: t, pm2_5: t.map(() => 8), pm10: t.map(() => 12), dust: t.map(() => 0), aerosol_optical_depth: t.map((_, i) => (i === 30 ? 0.3 : 0.1)) } });
    const clock = { t: at("10:20:00") };
    const seen: string[] = [];
    await saveAirForecast(db, clock.t, async (url) => (seen.push(url), (clock.t += 3000), { ok: true, status: 200, text: async () => body }), () => clock.t);
    expect(seen).toHaveLength(1);
    expect(db.raw.prepare("SELECT COUNT(*) AS n, MIN(fetched_at) AS f FROM sky_forecast_values WHERE item = 'aod'").get()).toEqual({ n: 48, f: iso(at("10:20:03")) });
    expect(db.raw.prepare("SELECT value FROM sky_forecast_values WHERE item = 'aod' AND valid_at = '2026-11-26T06:00:00+09:00'").get()).toEqual({ value: 0.3 });
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
    expect(db.raw.prepare("SELECT MAX(fetched_at) AS f FROM sky_forecast_values").get()).toEqual({ f: iso(at("14:00:02")) });
    expect(await skyAsOf(db, "47893", "cover", V, cutoff)).toMatchObject({ value: 40, source: "open-meteo-forecast", fetchedAt: iso(at("12:20:00")), confirmedAt: iso(at("12:20:00")) });
  });
  it("14時ちょうどに受け取った値は使い、直後の値は混ぜない。同じ値の回も、その受信時刻で残る", async () => {
    const db = d1();
    await run(db, at("10:20:00"), () => forecastBody({ cover: () => 40 }));
    await run(db, at("12:20:00"), () => forecastBody({ cover: () => 40 })); // 同じ値（この回も残す）
    await run(db, at("13:59:58"), () => forecastBody({ cover: () => 55 }), 2000); // 14:00:00 ちょうどに届く
    await run(db, at("15:01:00"), () => forecastBody({ cover: () => 90 }));
    expect(await skyAsOf(db, "47893", "cover", V, cutoff)).toMatchObject({ value: 55, unit: "%", status: "ok", fetchedAt: iso(at("14:00:00")) });
    // 13時の締め切りなら、12:20 に受け取った値（10:20 と同じ値でも、12:20 の回として）
    expect(await skyAsOf(db, "47893", "cover", V, iso(at("13:00:00")))).toMatchObject({ value: 40, fetchedAt: iso(at("12:20:00")), confirmedAt: iso(at("12:20:00")) });
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
  it("保存の順が受信の順と入れ替わっても、締め切りの再現は同じ（11/27 渡辺さんのテスト：13:58 に 20%、13:59 に 80%、14:01 に 80%）", async () => {
    const rec = (hhmm: string, value: number) => ({ station: "47893", source: "open-meteo-forecast" as const, via: "api" as const, receivedAt: iso(at(`${hhmm}:00`)), values: [{ item: "cover" as const, validAt: V, value }] });
    const receipts = [rec("13:58", 20), rec("13:59", 80), rec("14:01", 80)];
    const orders = [
      [0, 1, 2],
      [2, 1, 0],
      [0, 2, 1],
      [2, 0, 1],
      [1, 2, 0],
      [1, 0, 2],
    ];
    for (const order of orders) {
      const db = d1();
      for (const k of order) await recordSkyHistory(db, receipts[k]);
      expect(await skyAsOf(db, "47893", "cover", V, cutoff), `保存の順 ${order.join("→")}`).toMatchObject({ value: 80, fetchedAt: iso(at("13:59:00")), status: "ok" });
      expect(await skyAsOf(db, "47893", "cover", V, iso(at("13:58:30")))).toMatchObject({ value: 20, fetchedAt: iso(at("13:58:00")) });
    }
  });
  it("出典ごとに受け取った時刻で残す（予報と AOD は別の時刻）", async () => {
    const db = d1();
    await recordSkyHistory(db, { station: "47893", source: "open-meteo-cams", via: "cron", receivedAt: iso(at("13:55:00")), values: [{ item: "aod", validAt: V, value: 0.2 }] });
    await recordSkyHistory(db, { station: "47893", source: "open-meteo-cams", via: "cron", receivedAt: iso(at("14:05:00")), values: [{ item: "aod", validAt: V, value: 0.4 }] });
    expect(await skyAsOf(db, "47893", "aod", V, cutoff)).toMatchObject({ value: 0.2, source: "open-meteo-cams", fetchedAt: iso(at("13:55:00")) });
  });
});

describe("空の予報の履歴：11/27 レビューの直し", () => {
  const cutoff = dayBeforeCutoff("2026-11-26");
  const V = "2026-11-26T03:00:00+09:00";
  const rec = (o: { t: string; value: number | null; id?: string; source?: string; item?: "cover" | "aod"; validAt?: string }) => ({
    station: "47893",
    source: (o.source ?? "open-meteo-forecast") as "open-meteo-forecast",
    via: "api" as const,
    receivedAt: iso(at(o.t)),
    receiptId: o.id,
    values: [{ item: o.item ?? ("cover" as const), validAt: o.validAt ?? V, value: o.value }],
  });

  it("同じミリ秒に受け取った2回は両方残り、どちらを選ぶかは保存の順によらない（受信の ID の順）", async () => {
    const a = rec({ t: "13:59:00.123", value: 20, id: "2026-11-25T04:59:00.123Z~aaaaaaaa" });
    const b = rec({ t: "13:59:00.123", value: 80, id: "2026-11-25T04:59:00.123Z~bbbbbbbb" });
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const db = d1();
      for (const r of order) await recordSkyHistory(db, r);
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sky_forecast_values").get()).toEqual({ n: 2 });
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sky_forecast_receipts").get()).toEqual({ n: 2 });
      expect(await skyAsOf(db, "47893", "cover", V, cutoff)).toMatchObject({ value: 80, fetchedAt: iso(at("13:59:00.123")) });
    }
    // ID を決めなくても（ふだんの乱数）、同じミリ秒の2回が両方残る
    const db = d1();
    await recordSkyHistory(db, rec({ t: "13:59:00.123", value: 20 }));
    await recordSkyHistory(db, rec({ t: "13:59:00.123", value: 80 }));
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sky_forecast_values").get()).toEqual({ n: 2 });
  });

  it("出典が2つ：締め切りまでに ok の値を受け取っていた最初の出典を選ぶ（none・missing だけの出典は飛ばす）", async () => {
    const S = ["src-a", "src-b"];
    // a は記録が無い、b に値 → b
    let db = d1();
    await recordSkyHistory(db, rec({ t: "13:00:00", value: 30, source: "src-b" }));
    expect(await skyAsOf(db, "47893", "cover", V, cutoff, S)).toMatchObject({ source: "src-b", value: 30, status: "ok" });
    // a は欠測だけ、b に値 → b
    db = d1();
    await recordSkyHistory(db, rec({ t: "12:00:00", value: null, source: "src-a" }));
    await recordSkyHistory(db, rec({ t: "13:00:00", value: 30, source: "src-b" }));
    expect(await skyAsOf(db, "47893", "cover", V, cutoff, S)).toMatchObject({ source: "src-b", value: 30 });
    // a は値のあと欠測（最後の回が missing）→ a の前の値（b より優先）
    db = d1();
    await recordSkyHistory(db, rec({ t: "11:00:00", value: 10, source: "src-a" }));
    await recordSkyHistory(db, rec({ t: "12:00:00", value: null, source: "src-a" }));
    await recordSkyHistory(db, rec({ t: "13:00:00", value: 30, source: "src-b" }));
    expect(await skyAsOf(db, "47893", "cover", V, cutoff, S)).toMatchObject({ source: "src-a", value: 10, status: "missing", fetchedAt: iso(at("11:00:00")), confirmedAt: iso(at("12:00:00")) });
    // どちらも欠測だけ → 欠測のある最初の出典（値は null）。どちらも記録なし → none
    db = d1();
    await recordSkyHistory(db, rec({ t: "13:00:00", value: null, source: "src-b" }));
    expect(await skyAsOf(db, "47893", "cover", V, cutoff, S)).toMatchObject({ source: "src-b", value: null, status: "missing" });
    expect(await skyAsOf(d1(), "47893", "cover", V, cutoff, S)).toMatchObject({ source: null, status: "none" });
  });

  it("確かめた時刻は、その時間を実際に含んでいた応答から（頼んだ範囲ではなく）", async () => {
    const db = d1();
    await recordSkyHistory(db, rec({ t: "11:00:00", value: 40 }));
    // 13:00 の回は別の時間だけを返した（V を含まない）
    await recordSkyHistory(db, rec({ t: "13:00:00", value: 50, validAt: "2026-11-26T04:00:00+09:00" }));
    expect(await skyAsOf(db, "47893", "cover", V, cutoff)).toMatchObject({ value: 40, confirmedAt: iso(at("11:00:00")) });
    expect(db.raw.prepare("SELECT from_valid, to_valid, range_from, range_to FROM sky_forecast_receipts ORDER BY at DESC LIMIT 1").get()).toEqual({
      from_valid: "2026-11-26T04:00:00+09:00",
      to_valid: "2026-11-26T04:00:00+09:00",
      range_from: "2026-11-25T01:00:00+09:00",
      range_to: "2026-11-27T00:00:00+09:00",
    });
  });

  it("定時の間隔：取れた回で数える。取れなかったあとは 10 分で取り直す。13:45〜13:59 にまだ取れていなければ必ず取る", () => {
    const t = (x: string) => iso(at(x));
    expect(fetchDue(t("13:10:00"), t("13:10:00"), at("13:40:00"))).toBe(false);
    expect(fetchDue(t("13:10:00"), t("13:10:00"), at("13:45:00"))).toBe(true); // 締め切りの直前
    expect(fetchDue(t("13:46:00"), t("13:46:00"), at("13:55:00"))).toBe(false); // 直前に取れている
    expect(fetchDue(t("13:10:00"), t("13:10:00"), at("14:05:00"))).toBe(false);
    expect(fetchDue(t("13:10:00"), t("13:10:00"), at("14:10:00"))).toBe(true); // 1時間
    expect(fetchDue(t("12:00:00"), t("13:20:00"), at("13:25:00"))).toBe(false); // 失敗の直後
    expect(fetchDue(t("12:00:00"), t("13:20:00"), at("13:31:00"))).toBe(true); // 10 分あけて取り直す
    expect(fetchDue(null, null, at("09:00:00"))).toBe(true);
  });

  it("予報：12:50 に取れたあと、13:50 の定時処理は取る（14時の締め切りの値が古くならない）", async () => {
    const db = d1();
    await run(db, at("12:50:00"), () => forecastBody({ cover: () => 40 }));
    expect(await run(db, at("13:40:00"), () => forecastBody({ cover: () => 50 }))).toMatchObject({ skipped: true });
    expect(await run(db, at("13:50:00"), () => forecastBody({ cover: () => 60 }))).toMatchObject({ ok: true, appended: 336 });
    expect(await skyAsOf(db, "47893", "cover", V, cutoff)).toMatchObject({ value: 60, fetchedAt: iso(at("13:50:00")) });
  });

  it("AOD：取れなかった回は間隔に数えない（10 分で取り直す）", async () => {
    const db = d1();
    const t = times("2026-11-25", 5);
    const body = JSON.stringify({ latitude: 33.55, longitude: 133.55, hourly: { time: t, pm2_5: t.map(() => 8), pm10: t.map(() => 12), dust: t.map(() => 0), aerosol_optical_depth: t.map(() => 0.2) } });
    const fail = async () => ({ ok: false, status: 503, text: async () => "" });
    const okGet = async () => ({ ok: true, status: 200, text: async () => body });
    expect(await saveAirForecast(db, at("13:00:00"), fail, () => at("13:00:01"))).toMatchObject({ ok: false });
    expect(await saveAirForecast(db, at("13:05:00"), okGet, () => at("13:05:01"))).toMatchObject({ skipped: true });
    expect(await saveAirForecast(db, at("13:11:00"), okGet, () => at("13:11:01"))).toMatchObject({ ok: true });
    expect(await skyAsOf(db, "47893", "aod", V, cutoff)).toMatchObject({ value: 0.2, fetchedAt: iso(at("13:11:01")) });
    expect(db.raw.prepare("SELECT model, variant, kind FROM sky_forecast_receipts WHERE ok = 1").get()).toEqual({ model: "cams_global", variant: "full", kind: "ok" });
  });

  it("どこから来た値か：省ける項目を外して取り直した回は without-optional、モデルは best_match", async () => {
    const db = d1();
    const clock = { t: at("10:20:00") };
    let n = 0;
    const get = async (url: string) => (n++ === 0 ? { ok: false, status: 400, text: async () => "" } : { ok: true, status: 200, text: async () => (url.includes("cloud_cover") ? "" : forecastBody({ cover: () => null, vis: () => null })) });
    await saveSkyForecast(db, [KOCHI], clock.t, { get, clock: () => clock.t });
    expect(db.raw.prepare("SELECT model, variant, kind, via FROM sky_forecast_receipts").get()).toEqual({ model: "best_match", variant: "without-optional", kind: "ok", via: "cron" });
  });

  it("保存の失敗は、取れなかった回と分けて記録する（kind = db）", async () => {
    const db = d1();
    await ensureSkyHistorySchema(db);
    const broken = { ...db, batch: async () => Promise.reject(new Error("D1 is down")) };
    const clock = { t: at("10:20:00") };
    const s = server(clock, () => forecastBody());
    expect(await saveSkyForecast(broken, [KOCHI], clock.t, { get: s.get, clock: () => clock.t })).toEqual({ appended: 0, ok: false });
    expect(db.raw.prepare("SELECT ok, kind, error FROM sky_forecast_receipts").get()).toEqual({ ok: 0, kind: "db", error: "D1 is down" });
    await run(db, at("10:40:00"), () => "", 0, 503);
    expect(db.raw.prepare("SELECT kind FROM sky_forecast_receipts ORDER BY at DESC LIMIT 1").get()).toEqual({ kind: "fetch" });
  });

  it("前の表（#540〜11/27）の中身は、一度だけ新しい表へ写る（前の表は消さない）", async () => {
    const db = d1();
    db.raw.exec(`CREATE TABLE sky_forecast_history (station TEXT NOT NULL, item TEXT NOT NULL, valid_at TEXT NOT NULL, fetched_at TEXT NOT NULL, source TEXT NOT NULL, unit TEXT NOT NULL, value REAL, status TEXT NOT NULL, model_run TEXT, PRIMARY KEY (station, item, source, valid_at, fetched_at))`);
    db.raw.exec(`CREATE TABLE sky_forecast_fetch_log (at TEXT NOT NULL, station TEXT NOT NULL, source TEXT NOT NULL, via TEXT NOT NULL, ok INTEGER NOT NULL, from_valid TEXT, to_valid TEXT, req_lat REAL, req_lon REAL, grid_lat REAL, grid_lon REAL, model_run TEXT, appended INTEGER NOT NULL, error TEXT, PRIMARY KEY (at, station, source))`);
    const f = iso(at("11:00:00"));
    db.raw.prepare("INSERT INTO sky_forecast_history VALUES ('47893', 'cover', ?, ?, 'open-meteo-forecast', '%', 70, 'ok', NULL)").run(V, f);
    db.raw.prepare("INSERT INTO sky_forecast_fetch_log VALUES (?, '47893', 'open-meteo-forecast', 'cron', 1, '2026-11-25T01:00:00+09:00', '2026-11-27T00:00:00+09:00', 33.56, 133.55, 33.56, 133.56, NULL, 1, NULL)").run(f);
    db.raw.prepare("INSERT INTO sky_forecast_fetch_log VALUES (?, '47893', 'open-meteo-forecast', 'cron', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, '503')").run(iso(at("12:00:00")));
    expect(await skyAsOf(db, "47893", "cover", V, cutoff)).toMatchObject({ value: 70, fetchedAt: f, confirmedAt: f });
    expect(db.raw.prepare("SELECT kind, from_valid, range_to FROM sky_forecast_receipts ORDER BY at").all()).toEqual([
      { kind: "ok", from_valid: V, range_to: "2026-11-27T00:00:00+09:00" },
      { kind: "fetch", from_valid: null, range_to: null },
    ]);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM sky_forecast_history").get()).toEqual({ n: 1 });
  });
});

describe("空の予報の履歴：層ごとの雲量（11/27）", () => {
  it("下層・中層・上層の雲量も、受け取った回ごとに残り、前日14時に再現できる", async () => {
    const db = d1();
    await run(db, at("10:20:00"), () => forecastBody({ low: () => 20 }));
    await run(db, at("13:50:00"), () => forecastBody({ low: () => 70 }));
    const V = "2026-11-26T17:00:00+09:00";
    const cutoff = dayBeforeCutoff("2026-11-26");
    expect(await skyAsOf(db, "47893", "cover_low", V, cutoff)).toMatchObject({ value: 70, unit: "%", status: "ok", fetchedAt: iso(at("13:50:00")) });
    expect(await skyAsOf(db, "47893", "cover_mid", V, cutoff)).toMatchObject({ value: 30 });
    expect(await skyAsOf(db, "47893", "cover_high", V, cutoff)).toMatchObject({ value: 55 });
    expect(await skyAsOf(db, "47893", "cover_low", V, iso(at("12:00:00")))).toMatchObject({ value: 20 });
  });
});
