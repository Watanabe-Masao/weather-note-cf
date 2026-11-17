// 見本のための作ったデータ（本物ではない）：高知のまわりの雨を、南西から北東へ動く雨の帯と、その中の強い雨の
// かたまりで作る。本番は気象庁の「雨雲の動き」（5分ごと、1時間先まで）と「今後の雨」（1時間ごと、15時間先まで）、
// 過去の1時間ごとの量はアメダス。強さ（mm/h）と量（mm）は別の物で、混ぜない（要件 R4）。

export const KOCHI = { name: "高知", lat: 33.56, lon: 133.53 };
/**
 * 現在地（見本は仮の位置）。本番は端末の位置情報（断られたら出さない）。地図に「＋」の印を置くだけで、
 * その場所の雨の値は出さない（ピンポイントの降水量と取り違えないため、2026-11-18 渡辺さん）。位置はサーバーに送らない。
 */
export const HERE = { lat: 33.6, lon: 133.66 };
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

/**
 * 地図のこま：3時間前〜今は実況（5分ごと）、今〜1時間先は雨雲の動きの予測（5分ごと、強さ mm/h）、
 * その先15時間先までは今後の雨（1時間ごと、その1時間の量 mm）。1時間先を境に、地図が表すものが変わる。
 */
export const NOWCAST = Array.from({ length: 49 }, (_, i) => -180 + i * 5);
export const HOURLY_FRAMES = Array.from({ length: 14 }, (_, i) => 120 + i * 60);
export const FRAMES = [...NOWCAST, ...HOURLY_FRAMES];
export const isForecast = (m: number) => m > 0;
/** 1時間の量のこま（今後の雨）。m は1時間の終わり：m=120 は 16:00〜17:00 の量。 */
export const isAmount = (m: number) => m > 60;

/** 1時間の量（mm）：その1時間の強さの平均（見本）。先の時間ほどぼかす。 */
export function amount(x: number, y: number, mEnd: number): number {
  let sum = 0;
  for (let k = 0; k < 6; k++) sum += intensity(x, y, mEnd - 60 + k * 10 + 5) / 6;
  const v = sum * (mEnd > 6 * 60 ? 0.6 : 1);
  return v < 0.4 ? 0 : Math.round(v * 10) / 10;
}
/** こま m の地図の値：1時間先までは強さ（mm/h）、その先は1時間の量（mm）。 */
export const valueAt = (x: number, y: number, m: number) => (isAmount(m) ? amount(x, y, m) : intensity(x, y, m));
export const frameLabel = (m: number) => (isAmount(m) ? `${minuteLabel(m - 60)}〜${minuteLabel(m)}` : minuteLabel(m));

/** 今からの隔たり（「40分前」「1時間20分後」「2〜3時間後」）。 */
const span = (min: number) => {
  const h = Math.floor(min / 60);
  const r = min % 60;
  return h && r ? `${h}時間${r}分` : h ? `${h}時間` : `${r}分`;
};
export const relLabel = (m: number) =>
  m === 0 ? "今" : isAmount(m) ? `${(m - 60) / 60}〜${m / 60}時間後` : m < 0 ? `${span(-m)}前` : `${span(m)}後`;

/**
 * 再生の速さ（1こまを出す時間、ミリ秒）。こまの刻みが違っても、見た目の動きの速さが大きく食い違わないように
 * 長い刻みのこまは長く出す（5分＝0.3秒、1時間＝1.2秒）。それでも1時間ごとは5分ごとの3倍の速さで時間が進むので、
 * そのあいだは「3倍速」と出す。刻みが変わる所では一度止めて知らせる。
 */
export const STEP_MS = { five: 300, hour: 1200 };
export const SPEED_UP = (60 / STEP_MS.hour) / (5 / STEP_MS.five); // 1時間ごとのときの、時間の進み方の倍率

/** 高知の地点の強さ（5分ごと、mm/h）。 */
export const pointSeries = NOWCAST.map((m) => ({ m, v: intensity(KOCHI.lon, KOCHI.lat, m) }));

/** 1時間ごとの量（mm）：過去6時間はアメダスの実績、この先15時間は「今後の雨」の予測。 */
export const hourly = Array.from({ length: 21 }, (_, i) => {
  const h = i - 5; // −5..15：h の値は (h−1)時〜h時の1時間（終わりの時刻で呼ぶ）。今後の雨は15時間先まで
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
export function aheadItems(state: SampleState = "ok"): { label: string; value: string; sub?: string }[] {
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
  // この先15時間（今後の雨）：合計と、いちばん多い1時間
  // 取れなかった1時間は足さず、合計は「以上」にして、何時間分が欠けているかを書く（0mm と見せない）
  const all = hourly.filter((p) => p.forecast);
  const lost = all.filter((p) => isMissing(p.h * 60, state));
  const next = all.filter((p) => !isMissing(p.h * 60, state));
  const total = Math.round(next.reduce((t, p) => t + p.mm, 0) * 10) / 10;
  const most = next.reduce((a, b) => (b.mm > a.mm ? b : a), next[0]);
  const more = lost.length ? "以上" : "";
  const lostNote = lost.length ? `${lost.length}時間分は取れなかった` : null;
  out.push(
    total > 0
      ? { label: "15時間の合計", value: `${total}mm${more}`, sub: lostNote ?? `多いのは${minuteLabel((most.h - 1) * 60)}〜 ${most.mm}mm` }
      : { label: "15時間の合計", value: `0mm${more}`, sub: lostNote ?? undefined },
  );
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

/**
 * こまの取れ方（本番と同じ形）。本番は気象庁のタイルを読みに行き、読めなかったこまは「取れなかった」。
 * 雨が無いこま（タイルが空）と取れなかったこまは、見た目も言葉も分ける（R5-1：「取れなかった」を「ない」と見せない）。
 */
export type SampleState = "ok" | "missing" | "stale";
export interface Source {
  name: string;
  /** 発表の時刻（今からの分）。本番は気象庁の一覧の basetime。 */
  issued: number;
  /** これより古いと「古い」と出す（分）。見本は仮の値：本番は気象庁の一覧が出てくる間隔を見て決める。 */
  staleAfter: number;
}
export function sources(state: SampleState): { nowcast: Source; hourly: Source } {
  return state === "stale"
    ? { nowcast: { name: "雨雲の動き", issued: -40, staleAfter: 15 }, hourly: { name: "今後の雨", issued: -90, staleAfter: 90 } }
    : { nowcast: { name: "雨雲の動き", issued: 0, staleAfter: 15 }, hourly: { name: "今後の雨", issued: -30, staleAfter: 90 } };
}
export const isStale = (s: Source) => -s.issued >= s.staleAfter;
/** 見本で「取れなかった」にするこま（実況の2こまと、今後の雨の1こま）。 */
const MISSING = new Set([-95, -90, 420]);
export const isMissing = (m: number, state: SampleState) => state === "missing" && MISSING.has(m);
/** 地図の凡例の見出し：こまが表すもの（強さか、1時間の量か）。色の段は同じでも、物と単位が違う。 */
export const legendTitle = (m: number) => (isAmount(m) ? "1時間の量（mm）" : "雨の強さ（mm/h）");
