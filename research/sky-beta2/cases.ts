// β2 の最初の比較の固定事例（#537、2026-11-27 渡辺さん）：高知の晴天空で、太陽側・横・反対側を同じ視線・同じ露出で並べる。
// 太陽高度 +5°（11/23 16:30 の画面に相当）と、#543 の日没直後 −1.9°・薄明 −6.8°。同じ日（11/13）・同じ地点（高知 47893）。
// 太陽の位置は今の共通計算（shared/sunTimes.ts）。書き出し：npx tsx research/sky-beta2/cases.ts > research/sky-beta2/cases.json
import { solarAltitude, solarAzimuth, stationLatLon } from "../../shared/sunTimes";

const STATION = "47893";
const DATE = "2026-11-13";
const ll = stationLatLon(STATION)!;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
/** 時刻（分）：+5°（16:34、+5.01°）、日没直後（17:10、−1.90°）、薄明（17:35、−6.83°）。 */
const TIMES: [string, number][] = [
  ["sun+5", 16 * 60 + 34],
  ["sunset-1.9", 17 * 60 + 10],
  ["dusk-6.8", 17 * 60 + 35],
];
/** 視線：太陽との方位差（0＝太陽側、90＝横、180＝反対側）と高さ。天頂も。 */
const DIFFS = [0, 30, 60, 90, 100, 120, 150, 180];
const ALTS = [3, 10, 20, 45];

const cases = TIMES.map(([id, at]) => {
  const sunAlt = solarAltitude(DATE, at, ll.lat, ll.lon);
  const sunAz = solarAzimuth(DATE, at, ll.lat, ll.lon);
  const views = [
    ...ALTS.flatMap((alt) => DIFFS.map((d) => ({ id: `d${d}-a${alt}`, diff: d, az: r4((sunAz + d) % 360), alt }))),
    { id: "zenith", diff: null, az: 0, alt: 90 },
  ];
  return { id, station: STATION, date: DATE, time: `${Math.floor(at / 60)}:${String(at % 60).padStart(2, "0")}`, minutes: at, sunAlt: r4(sunAlt), sunAz: r4(sunAz), views };
});
/** 帯（パノラマ）：方位 0〜360°（0.5° ごと）× 高さ −2〜60°（0.5° ごと）。 */
const panorama = { az: [0, 360, 0.5], alt: [-2, 60, 0.5] };
console.log(JSON.stringify({ _note: "β2 の固定事例（research/sky-beta2/cases.ts で生成）", observerHeightM: 10, panorama, cases }, null, 2));
