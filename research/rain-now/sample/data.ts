// 見本のための作ったデータ（本物ではない）：高知のまわりの雨を、南西から北東へ動く雨の帯と、その中の強い雨の
// かたまりで作る。本番は気象庁の「雨雲の動き」（5分ごと、1時間先まで）と「今後の雨」（1時間ごと、15時間先まで）、
// 過去の1時間ごとの量はアメダス。強さ（mm/h）と量（mm）は別の物で、混ぜない（要件 R4）。

export const KOCHI = { name: "高知", lat: 33.56, lon: 133.53 };
export const BOX = { w: 132.2, e: 134.9, s: 32.6, n: 34.5 };

/**
 * 地図の寄せ方：気象庁の地図タイルの段階で。8＝四国全体（今の広さ）、9＝高知県くらい、10＝高知市のまわり
 * （#274 で読めたいちばん近い段階。11 より近い段階があるかは確かめていない）。中心は地点。
 * 雨のマスの細かさも段階に合わせる（本番は気象庁の画像の細かさ：最初の30分は 250m、その先は 1km）。
 */
export const ZOOMS = [8, 9, 10] as const;
export type Zoom = (typeof ZOOMS)[number];
export function viewOf(z: Zoom) {
  const k = 2 ** (z - 8);
  const hw = (BOX.e - BOX.w) / 2 / k;
  const hh = (BOX.n - BOX.s) / 2 / k;
  // 段階8 は四国全体の箱、それより近いときは地点を中心に
  const cx = z === 8 ? (BOX.e + BOX.w) / 2 : KOCHI.lon;
  const cy = z === 8 ? (BOX.n + BOX.s) / 2 : KOCHI.lat;
  return { w: cx - hw, e: cx + hw, s: cy - hh, n: cy + hh, cell: 0.02 / k, km: z === 8 ? 50 : z === 9 ? 20 : 10 };
}

/** 今（見本の時刻）：2026-11-18 15:00 JST。分で数える（0 = 今）。 */
export const NOW_LABEL = "2026-11-18T15:00";
export const minuteLabel = (m: number) => {
  const t = 15 * 60 + m;
  const h = Math.floor((((t % 1440) + 1440) % 1440) / 60);
  const mm = (((t % 60) + 60) % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
};

const g = (x: number, y: number, cx: number, cy: number, sx: number, sy: number, rot: number) => {
  const dx = x - cx;
  const dy = y - cy;
  const u = dx * Math.cos(rot) + dy * Math.sin(rot);
  const v = -dx * Math.sin(rot) + dy * Math.cos(rot);
  return Math.exp(-(u * u) / (2 * sx * sx) - (v * v) / (2 * sy * sy));
};

/** 分 m の、経度 x・緯度 y の雨の強さ（mm/h）。帯は 1時間に経度 0.35°・緯度 0.22° ほど北東へ。 */
export function intensity(x: number, y: number, m: number): number {
  const h = m / 60;
  const band = 9 * g(x, y, 133.05 + 0.35 * h, 33.05 + 0.22 * h, 0.13, 0.75, 0.6);
  const cell1 = 38 * g(x, y, 133.18 + 0.4 * h, 33.22 + 0.25 * h, 0.06, 0.08, 0);
  const cell2 = 22 * g(x, y, 132.85 + 0.38 * h, 32.95 + 0.24 * h, 0.07, 0.06, 0);
  // 過去の弱いにわか雨（2時間前ごろに高知の北を通った）
  // 過去のにわか雨（1時間半前ごろに高知を通った）
  const shower = 6 * g(x, y, 133.98 + 0.3 * h, 33.83 + 0.18 * h, 0.1, 0.07, 0) * (h < -0.5 ? 1 : 0);
  const v = band + cell1 + cell2 + shower;
  return v < 0.4 ? 0 : Math.round(v * 10) / 10;
}

/** 地図のこま：3時間前〜今は実況（5分ごと）、今〜1時間先は予測（5分ごと）。 */
export const FRAMES = Array.from({ length: 49 }, (_, i) => -180 + i * 5);
export const isForecast = (m: number) => m > 0;

/** 高知の地点の強さ（5分ごと、mm/h）。 */
export const pointSeries = FRAMES.map((m) => ({ m, v: intensity(KOCHI.lon, KOCHI.lat, m) }));

/** 1時間ごとの量（mm）：過去6時間はアメダスの実績、この先15時間は「今後の雨」の予測。 */
export const hourly = Array.from({ length: 21 }, (_, i) => {
  const h = i - 5; // −5..15：h の値は (h−1)時〜h時の1時間（終わりの時刻で呼ぶ）
  let sum = 0;
  for (let k = 0; k < 12; k++) sum += intensity(KOCHI.lon, KOCHI.lat, (h - 1) * 60 + k * 5 + 2.5) / 12;
  // 予測は先ほどぼかす（見本：遠い先ほど弱く広く）
  const v = h > 0 ? sum * (h > 6 ? 0.6 : 1) : sum;
  return { h, mm: Math.round(v * 2) / 2, forecast: h > 0 };
});

/** 気象庁の雨の強さの色の段（mm/h）。 */
export const SCALE = [
  { from: 0.4, to: 1, color: "#f2f2ff", label: "<1" },
  { from: 1, to: 5, color: "#a0d2ff", label: "1" },
  { from: 5, to: 10, color: "#218cff", label: "5" },
  { from: 10, to: 20, color: "#0041ff", label: "10" },
  { from: 20, to: 30, color: "#faf500", label: "20" },
  { from: 30, to: 50, color: "#ff9900", label: "30" },
  { from: 50, to: 80, color: "#ff2800", label: "50" },
  { from: 80, to: 999, color: "#b40068", label: "80" },
];
export const colorOf = (v: number) => SCALE.find((s) => v >= s.from && v < s.to)?.color ?? null;

/** 言葉（見本）：この先1時間の高知の雨を、決まった形だけで言う（理由は言わない）。 */
export const STRENGTH = (v: number) => (v >= 30 ? "激しい雨" : v >= 20 ? "強い雨" : v >= 10 ? "やや強い雨" : v >= 1 ? "雨" : "弱い雨");
/** この先1時間の高知の雨を、降りはじめ・いちばん強い・その後に分けて（時刻と「何分後」を並べて）。 */
export function aheadItems(): { label: string; value: string; sub?: string }[] {
  const ahead = pointSeries.filter((p) => p.m > 0);
  const now = pointSeries.find((p) => p.m === 0)!.v;
  const first = ahead.find((p) => p.v >= 1);
  if (now < 1 && !first) return [{ label: "この先1時間", value: "雨の予測なし" }];
  const out: { label: string; value: string; sub?: string }[] = [];
  out.push(now >= 1 ? { label: "今", value: STRENGTH(now), sub: `${now}mm/h` } : { label: "降りはじめ", value: `${minuteLabel(first!.m)}ごろ`, sub: `${first!.m}分後` });
  const peak = ahead.reduce((a, b) => (b.v > a.v ? b : a), ahead[0]);
  out.push({ label: "いちばん強い", value: `${minuteLabel(peak.m)}ごろ`, sub: `${Math.round(peak.v)}mm/h・${STRENGTH(peak.v)}` });
  const stop = ahead.find((p, i) => i > 0 && p.v < 1 && ahead[i - 1].v >= 1);
  out.push(stop ? { label: "やむ", value: `${minuteLabel(stop.m)}ごろ`, sub: `${stop.m}分後` } : { label: "その後", value: `${minuteLabel(60)}以降も`, sub: "降り続く見込み" });
  return out;
}

export function sayAhead(): string {
  const ahead = pointSeries.filter((p) => p.m > 0);
  const now = pointSeries.find((p) => p.m === 0)!.v;
  const first = ahead.find((p) => p.v >= 1);
  if (now < 1 && !first) return "この先1時間、高知で雨の予測はありません";
  const peak = ahead.reduce((a, b) => (b.v > a.v ? b : a), ahead[0]);
  const parts: string[] = [];
  if (now < 1 && first) parts.push(`${first.m}分後から${STRENGTH(first.v)}`);
  else parts.push(`今 ${STRENGTH(now)}`);
  if (peak.v >= 10) parts.push(`${peak.m}分後がいちばん強く ${Math.round(peak.v)}mm/h`);
  const stop = ahead.find((p, i) => i > 0 && p.v < 1 && ahead[i - 1].v >= 1);
  parts.push(stop ? `${stop.m}分後にやむ見込み` : "1時間後も続く見込み");
  return parts.join("、");
}
