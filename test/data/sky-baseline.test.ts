// 空色エンジン 段階 1（#536、2026-11-27）：今の空色を固定事例として記録する（回帰の基準）。比べる基準のコミットは 4fcfd76（#531 のマージ）。
// 高知の 晴れ・薄明・曇り・霧・雨・欠測 と、11/24 の「1時台・雨・0.0 mm」（時刻の境目と欠測）。
// 事例ごとに：対象日時・地点、渡した値と出典、太陽と月の位置（軌道）、今の画面の色（β 切り：空の帯と同じ 10 分ごとの色、
// 天頂・地平・言葉と skyTrace の各段）と、同じ事例の β 入り（晴天大気＋雲の合成、決まった視線の色と sceneTrace）。
// 記録は test/data/sky-baseline.json。shared/sky.ts・shared/skyScene.ts・月の計算を変えると差が出る（わざと変えたときは、
// SKY_BASELINE_WRITE=1 npx vitest run test/data/sky-baseline.test.ts で書き直し、PR に「何が・なぜ変わったか」を書く）。
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sunUpFraction } from "../../shared/brightness";
import { moonPhase, moonTopo } from "../../shared/moon";
import { daySky, skyAt, skyTrace } from "../../shared/sky";
import { dayLights } from "../../shared/brightness";
import { cloudAmount, moonOutlook, SKY_SCENE_VERSION, type SceneInput, sceneSeed, sceneTrace, skyRgb, skyWeatherFrom } from "../../shared/skyScene";
import { solarAltitude, solarAzimuth, stationLatLon } from "../../shared/sunTimes";
import type { WeatherRow } from "../../shared/types";

const FILE = new URL("./sky-baseline.json", import.meta.url);
const BASE_COMMIT = "4fcfd76";
const KOCHI = "47893";
/** β の色を見る視線（方位・高さ）。「空を見上げる」の窓（横 90°）の真ん中と四隅のあたり。 */
const LOOKS: [number, number][] = [
  [180, 30],
  [135, 5],
  [225, 5],
  [180, 70],
  [0, 30],
];

type Case = { id: string; label: string; date: string; at: number; rows: (date: string) => WeatherRow[] };
const row = (date: string, n: number, over: Partial<WeatherRow> = {}): WeatherRow => ({ date, n, type: "actual", provider: "JMA", raw: {}, quality: {}, ...over }) as WeatherRow;
const day = (date: string, f: (n: number) => Partial<WeatherRow>) => Array.from({ length: 24 }, (_, i) => row(date, i + 1, f(i + 1)));

const CASES: Case[] = [
  { id: "clear-noon", label: "晴れ（昼）", date: "2026-11-13", at: 12 * 60 + 15, rows: (d) => day(d, (n) => ({ sun: sunUpFraction(d, n, KOCHI), rain: 0, weather: "晴" })) },
  { id: "clear-dusk", label: "薄明（晴れの日の入りのあと）", date: "2026-11-13", at: 17 * 60 + 35, rows: (d) => day(d, (n) => ({ sun: sunUpFraction(d, n, KOCHI), rain: 0, weather: "晴" })) },
  // 日没直後（#537 の β2 比較、11/27 渡辺さん）：同じ日・同じ地点で太陽 −1.9°。17:35（−6.8°）と並べ、太陽側と反対側を同じ露出で比べる。
  { id: "clear-sunset", label: "日没直後（晴れ、太陽 −2° 前後）", date: "2026-11-13", at: 17 * 60 + 10, rows: (d) => day(d, (n) => ({ sun: sunUpFraction(d, n, KOCHI), rain: 0, weather: "晴" })) },
  { id: "cloudy-noon", label: "曇り（昼）", date: "2026-11-13", at: 12 * 60 + 15, rows: (d) => day(d, () => ({ sun: 0, rain: 0, weather: "曇" })) },
  { id: "fog-morning", label: "霧（朝）", date: "2026-11-13", at: 8 * 60 + 15, rows: (d) => day(d, () => ({ sun: 0, rain: 0, weather: "霧", visibility: 0.8 })) },
  { id: "rain-afternoon", label: "雨（午後）", date: "2026-11-13", at: 15 * 60 + 15, rows: (d) => day(d, () => ({ sun: 0, rain: 3, weather: "雨" })) },
  { id: "missing", label: "欠測（その日の行が無い）", date: "2026-11-13", at: 12 * 60 + 15, rows: () => [] },
  {
    id: "rain-0mm-0124",
    label: "11/24 1時台・雨・0.0 mm（時刻の境目と欠測）",
    date: "2026-11-24",
    at: 1 * 60 + 15,
    rows: (d) => day(d, (n) => (n === 2 ? { weather: "雨", rain: 0 } : n < 7 || n > 17 ? { rain: 0 } : { sun: sunUpFraction(d, n, KOCHI), rain: 0 })),
  },
];

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function record(c: Case) {
  const ll = stationLatLon(KOCHI)!;
  const rows = c.rows(c.date);
  const n = Math.min(24, Math.floor(c.at / 60) + 1);
  const ms = Date.parse(`${c.date}T00:00:00+09:00`) + c.at * 60_000;
  const sunAlt = solarAltitude(c.date, c.at, ll.lat, ll.lon);
  const sunAz = solarAzimuth(c.date, c.at, ll.lat, ll.lon);
  const moon = moonTopo(ms, ll.lat, ll.lon);
  const lit = moonPhase(ms).illuminated;
  // β 切り（今の画面）：空の帯と同じ 10 分ごとの色。その時間の行が無ければ晴れの空（SunSheet の skies と同じ）。
  const own = rows.length ? daySky(rows, KOCHI).find((s) => s.n === n)?.steps[Math.floor((c.at % 60) / 10)] ?? null : null;
  const off = own ?? skyAt(sunAlt, 1, 0, c.at > 720);
  const light = rows.length ? dayLights(rows, KOCHI)[rows.findIndex((r) => r.n === n)] : null;
  const factor = light?.factor ?? 1;
  const mm = typeof rows.find((r) => r.n === n)?.rain === "number" ? (rows.find((r) => r.n === n)!.rain as number) : 0;
  const trace = own ? skyTrace(own.altitude, factor, mm, c.at > 720) : skyTrace(sunAlt, 1, 0, c.at > 720);
  // β 入り：晴天大気（雲の係数を晴れにした今の空色）＋天気から描いた雲。
  const wx = skyWeatherFrom(rows, n, KOCHI);
  const scene: SceneInput = { clear: skyAt(sunAlt, 1, 0, c.at > 720), sunAlt, sunAz, moonAlt: moon.altitude, moonAz: moon.azimuth, moonLit: lit, wx, seed: sceneSeed(KOCHI, c.date, n, cloudAmount(wx)) };
  const hour = rows.find((r) => r.n === n);
  return {
    label: c.label,
    station: KOCHI,
    date: c.date,
    time: `${String(Math.floor(c.at / 60)).padStart(2, "0")}:${String(c.at % 60).padStart(2, "0")}`,
    jmaHour: n,
    input: hour ? { type: hour.type, provider: hour.provider, weather: hour.weather ?? null, sun: hour.sun ?? null, rain: hour.rain ?? null, visibility: hour.visibility ?? null } : null,
    sun: { altitude: r4(sunAlt), azimuth: r4(sunAz) },
    moon: { altitude: r4(moon.altitude), azimuth: r4(moon.azimuth), illuminated: r4(lit) },
    betaOff: {
      factor: r4(factor),
      zenith: off.zenith,
      horizon: off.horizon,
      word: off.word,
      lux: r4(off.lux),
      index: off.index,
      steps: trace.steps.map((s) => ({ key: s.key, zenith: s.zenith, horizon: s.horizon, note: s.note })),
    },
    betaOn: {
      sceneVersion: SKY_SCENE_VERSION,
      source: wx.source,
      kind: wx.kind,
      amount: cloudAmount(wx),
      looks: LOOKS.map(([az, alt]) => ({ az, alt, rgb: skyRgb(scene, az, alt).map(r4) })),
      // 太陽側と反対側（太陽の方位と、その反対。高さ 3° と 20°）。同じ露出（同じ計算）で比べる。
      sides: [3, 20].flatMap((alt) => [
        { side: "太陽側", az: r4(sunAz), alt, rgb: skyRgb(scene, sunAz, alt).map(r4) },
        { side: "反対側", az: r4((sunAz + 180) % 360), alt, rgb: skyRgb(scene, (sunAz + 180) % 360, alt).map(r4) },
      ]),
      outlook: moonOutlook(wx, moon.altitude),
      trace: sceneTrace(scene),
    },
  };
}

/**
 * 薄明の刻み（#537、11/27 渡辺さん「切り替わる高度の前後を細かく刻んで確認すると、1枚の画像では見えない段差も拾える」）：
 * 高知 11/13 の夕方、太陽 +2° 〜 −10° を 0.25° ごとに、今の空色（晴れ）の天頂・地平の色と、β の晴天大気の太陽側・反対側（高さ 3°）。
 * β2 で候補モデルから今の薄明の色へ切り替えるとき、その前後の段差を同じ刻みで比べる基準。
 */
function sweep() {
  const ll = stationLatLon(KOCHI)!;
  const az = solarAzimuth("2026-11-13", 17 * 60 + 10, ll.lat, ll.lon);
  const wx = skyWeatherFrom([], 1, KOCHI);
  const out = [];
  for (let k = 0; k <= 48; k++) {
    const alt = 2 - k * 0.25;
    const sky = skyAt(alt, 1, 0, true);
    const scene: SceneInput = { clear: sky, sunAlt: alt, sunAz: az, moonAlt: -30, moonAz: 0, moonLit: 0, wx, seed: 1 };
    out.push({ sunAlt: alt, zenith: sky.zenith, horizon: sky.horizon, word: sky.word, sunSide: skyRgb(scene, az, 3).map(r4), away: skyRgb(scene, (az + 180) % 360, 3).map(r4) });
  }
  return out;
}

describe("空色エンジン 段階 1：今の空色の固定事例（基準 4fcfd76）", () => {
  const now = { _note: `空色エンジン 段階 1（#536）の固定事例。基準のコミット ${BASE_COMMIT}（#531）。書き直しは test/data/sky-baseline.test.ts の説明を見る。`, base: BASE_COMMIT, cases: Object.fromEntries(CASES.map((c) => [c.id, record(c)])), twilightSweep: sweep() };
  if (process.env.SKY_BASELINE_WRITE) writeFileSync(FILE, JSON.stringify(now, null, 2) + "\n");
  const saved = JSON.parse(readFileSync(FILE, "utf8")) as typeof now;
  it("事例がそろっている：晴れ・日没直後・薄明・曇り・霧・雨・欠測・11/24 1時台の雨 0.0 mm", () => {
    expect(Object.keys(saved.cases).sort()).toEqual(CASES.map((c) => c.id).sort());
    expect(saved.base).toBe(BASE_COMMIT);
    // 薄明の事例は太陽が地平線の下 0〜−18°（薄明）
    expect(saved.cases["clear-dusk"].sun.altitude).toBeLessThan(0);
    expect(saved.cases["clear-dusk"].sun.altitude).toBeGreaterThan(-18);
    // 日没直後の事例は太陽 −1〜−3°
    expect(saved.cases["clear-sunset"].sun.altitude).toBeLessThan(-1);
    expect(saved.cases["clear-sunset"].sun.altitude).toBeGreaterThan(-3);
  });
  it("薄明の刻み（太陽 +2°〜−10°、0.25° ごと）が同じ", () => {
    expect(sweep()).toEqual(saved.twilightSweep);
  });
  for (const c of CASES)
    it(`同じ入力から同じ色・軌道：${c.label}`, () => {
      expect(record(c)).toEqual(saved.cases[c.id]);
    });
});
