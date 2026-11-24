// 1日の「まとめ」の行（2026-11-24 渡辺さん「その一日のまとめたもの。それぞれの項目を最小限にまとめて見せる」）。
//
// 帯の仲間ごとに1行。言葉が中心で、数字は上の表（まとめでは天気・最高・最低）に無いものだけ（数字は1か所）。
// 行を押すとその仲間の画面へ（src/ui/DaySummary.tsx）。値はどれも、ほかの画面と同じものから（新しく計算しない）：
//   気温：日中の肌感（表の肌感と同じ）・明日の朝の最低（表の明日と同じ値と書き方、今日だけ）
//   雨：1時間ごとの雨（0.5mm 以上の時間の数・いちばん多い時刻）と日の雨の量
//   風：主な風向（windSummary）と日中（6〜18時）の風速の幅
//   空・光：日照の時間と日の出・日の入り（計算の値、src/data/sun.ts）
//   大気：湿度の平均と見通し（視程）の最小
import { hourlyExtreme } from "./chartMetrics";
import { SECTORS, sectorOf, windOf, windSummary } from "../shared/windDirection";
import type { WeatherRow } from "../shared/types";

export type SummaryGroup = "temp" | "rainwind" | "sky" | "air";

export interface SummaryLine {
  group: SummaryGroup;
  /** 行の名前（気温・雨・風・空・光・大気）。 */
  label: string;
  text: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface SummaryInput {
  /** その日の行（表と同じ、getDay）。 */
  row: WeatherRow | null;
  /** その日の1時間ごと（今日は過ぎた時間が観測、これからが予報）。 */
  hours: WeatherRow[] | null;
  /** 日中の肌感の言葉（「肌寒い」など。無ければ null）。 */
  feelWord: string | null;
  /** 明日の朝の最低（表の明日と同じ書き方の文字。今日だけ、無ければ null）。 */
  nextMin: string | null;
  /** 日の出・日の入り（「6:45」の形）。 */
  sun: { rise: string; set: string };
  /** 過ぎた日か（言い方：「降った」「降りそう」）。 */
  past: boolean;
  /**
   * 今日だけ：アメダスのいちばん新しい10分の観測（今の気温・この1時間の雨と、その時刻）。朝の確認で、今の気温と
   * 降り始めを先に読めるように（2026-11-24 渡辺さん）。今日でなければ null。
   */
  now?: { temp: number | null; rain: number | null; at: string | null } | null;
  /**
   * 今日か（今日の雨の行を使う）。今の観測がまだ無くても今日は今日（2026-11-24 渡辺さんの共有したレビュー：観測だけ
   * 取れていないと、1日の分の言い方になっていた）。
   */
  today?: boolean;
  /** 今日だけ：今の時（0〜23、日本時間）。「このあと」の時間を決める。 */
  hourNow?: number;
  /** 1時間ごとの値の様子：読み込み中・そろった・取れなかった・無い（雨なしと言ってよいかの判断に使う）。 */
  hoursState?: "loading" | "ready" | "error" | "none";
}

/** 気温の行。 */
function tempLine(x: SummaryInput): string {
  // 今日は、いちばん先に今の気温を1つだけ（観測の時刻つき）。湿度・風などの今の値は項目の画面で（2026-11-24 渡辺さん）。
  const now = x.now?.temp != null ? `いま ${x.now.temp.toFixed(1)}℃${x.now.at ? `（${x.now.at}観測）` : ""}` : null;
  const parts = [now, x.feelWord ? `日中は${x.feelWord}` : null, x.nextMin != null ? `明日の朝は ${x.nextMin}℃ まで` : null].filter(Boolean);
  return parts.length ? parts.join("。") : "—";
}

/** 1日の時間の数（1〜24時）。 */
const DAY_HOURS = 24;

/**
 * 雨の行：雨のある時間（0.5mm 以上）の数と、いちばん多い時刻、日の量。
 * 「雨なし」と言うのは、1日の時間がそろって確かめられたとき、または日の量が 0 と分かっているときだけ（2026-11-24 渡辺さん、
 * docs/thread-rules.md「ゼロ・該当なし・変化なしは…確認できた場合に」）。読み込み中・取れなかった・一部だけは、そう言う。
 */
function rainLine(x: SummaryInput): string {
  if (x.today) return todayRainLine(x);
  const hours = x.hours ?? [];
  const known = hours.filter((r) => num(r.rain) != null);
  const wet = known.filter((r) => (num(r.rain) ?? 0) >= 0.5);
  const total = num(x.row?.rain);
  const part = known.length < DAY_HOURS ? `（${known.length}時間分）` : "";
  if (wet.length) {
    const top = wet.reduce((a, b) => ((num(b.rain) ?? 0) > (num(a.rain) ?? 0) ? b : a));
    const amount = total != null ? `・${total.toFixed(1)}mm` : "";
    return `雨は${wet.length}時間${amount}${part}。多いのは${top.n - 1}時台`;
  }
  if (!known.length) {
    if (total != null) return total >= 0.5 ? `雨 ${total.toFixed(1)}mm` : x.past ? "雨は降らなかった" : "雨の見込みはありません";
    return x.hoursState === "loading" ? "読み込み中…" : x.hoursState === "error" ? "雨のデータを取れませんでした" : "雨のデータがありません";
  }
  if (part) return `${known.length}時間分だけ分かっています（その中では雨なし）`;
  return x.past ? "雨は降らなかった" : "雨の見込みはありません";
}

/** 取得できた範囲だけで数えたとき（欠けた時間があるとき）に添える言葉（2026-11-24 渡辺さんの共有したレビュー）。 */
const PART = "取得できた範囲";

/** 今の時（0〜23、日本時間）：渡されなければ観測の時刻から、それも無ければ観測の済んだ時間の最後から。 */
function hourNowOf(x: SummaryInput): number {
  if (x.hourNow != null) return x.hourNow;
  const at = x.now?.at?.match(/^(\d{1,2}):/);
  if (at) return Number(at[1]);
  const done = (x.hours ?? []).filter((r) => r.type !== "forecast").map((r) => r.n);
  return done.length ? Math.max(...done) : 0;
}

/**
 * 今日の雨の行：降り始めを先に（2026-11-24 渡辺さん）。観測と予報を読み分ける：
 *   - 今降っている（この1時間の観測が 0.5mm 以上）→「雨を観測（8:50時点）」、このあとの予報を添える
 *   - まだ降っていない → このあとの1時間ごとの予報で最初に 0.5mm 以上の時刻「9時ごろから雨の見込み」
 * 量と時間は「このあと」の予報の分だと書く（1日の分と混ぜない）。そろっていないときは雨なしと言わない。
 *
 * 「このあと」は今の時台から 24時までの時間（観測の済んだ時間を除く）。その時間ごとに、予報の雨が分かるか・欠けたかを見る
 * （2026-11-24 渡辺さんの共有したレビュー）：
 *   - 最初に雨の見込みがある時間より前に欠けた時間があれば、降り始めとは言わない（「9時台に雨の見込み。降り始めは不明」）
 *   - 欠けた時間があれば、時間の数と量に「取得できた範囲」と添える
 *   - このあとの予報が1時間も分からなければ、読み込み中・取れなかった・無い を言う（「0時間分」とは言わない）
 *   - 予報がまだ届いていないのと、今日の時間が終わったのとを分ける（後者は 24時を過ぎたときだけで、今日の画面には無い）
 */
function todayRainLine(x: SummaryInput): string {
  const hours = x.hours ?? [];
  const hourNow = hourNowOf(x);
  const at = new Map(hours.map((r) => [r.n, r]));
  // このあとの時間（n は 1〜24 の「その時間の終わり」：n = 9 は 8時台）。観測の済んだ時間は除く。
  const slots: { n: number; rain: number | null }[] = [];
  for (let n = hourNow + 1; n <= DAY_HOURS; n++) {
    const r = at.get(n);
    if (r && r.type !== "forecast") continue;
    slots.push({ n, rain: r ? num(r.rain) : null });
  }
  const known = slots.filter((s) => s.rain != null);
  const missing = known.length < slots.length;
  const wet = known.filter((s) => (s.rain ?? 0) >= 0.5);
  const sum = wet.reduce((a, s) => a + (s.rain ?? 0), 0);
  const rest = wet.length ? `このあと ${wet.length}時間・${sum.toFixed(1)}mm の見込み${missing ? `、${PART}` : ""}` : null;
  const raining = (x.now?.rain ?? 0) >= 0.5;
  const seen = raining ? `雨を観測（${x.now?.at ?? "いま"}時点）` : null;
  if (!slots.length) return seen ?? "今日の残りの時間はありません";
  if (!known.length) {
    const why =
      x.hoursState === "loading" ? "このあとの雨の予報を読み込み中…" : x.hoursState === "error" ? "このあとの雨の予報を取れませんでした" : "このあとの雨の予報データがありません";
    return [seen, why].filter(Boolean).join("。");
  }
  if (raining) return [seen, rest ?? (missing ? `このあと ${known.length}時間分だけ分かっています（その中では雨なし）` : "このあとの雨の見込みはありません")].join("。");
  if (wet.length) {
    const first = wet[0];
    const sure = slots.filter((s) => s.n < first.n).every((s) => s.rain != null);
    return sure ? `${first.n - 1}時ごろから雨の見込み（${rest}）` : `${first.n - 1}時台に雨の見込み。降り始めは不明（${rest}）`;
  }
  if (missing) return `このあと ${known.length}時間分だけ分かっています（その中では雨なし）`;
  return "このあと雨の見込みはありません";
}

/** 風の行：主な風向と、日中の風速の幅。 */
function windLine(x: SummaryInput): string {
  const hours = x.hours ?? [];
  const w = hours.length ? windSummary(hours) : null;
  const dir = w && w.mode != null ? `${SECTORS[w.mode]}の風` : w && w.calm && !w.n ? "風はほとんどない" : null;
  const day = hours.filter((r) => r.n >= 6 && r.n <= 18).map((r) => num(r.wind)).filter((v): v is number => v != null);
  // 日中の 13時間（n 6〜18）が欠けていれば、取得できた範囲と添える（雨の行と同じ決まり、2026-11-24）。
  const range = day.length ? `日中は ${Math.round(Math.min(...day))}〜${Math.round(Math.max(...day))} m/s${day.length < 13 ? `（${PART}）` : ""}` : null;
  const parts = [dir, range].filter(Boolean);
  return parts.length ? parts.join("、") : "—";
}

/** 空・光の行：日照の時間と、日の出・日の入り。 */
function skyLine(x: SummaryInput): string {
  const sun = num(x.row?.sun);
  const light = sun == null ? null : sun < 1 ? "日差しはほとんどなし" : `日照 ${sun.toFixed(1)}時間`;
  return [light, `日の出 ${x.sun.rise}・日の入り ${x.sun.set}`].filter(Boolean).join("。");
}

/** 大気の行：湿度の平均と、見通しの最小。 */
function airLine(x: SummaryInput): string {
  const hum = num(x.row?.humidity);
  const vis = hourlyExtreme(x.hours, "visibility", "min");
  // 最小は欠けた時間にあったかもしれないので、24時間そろっていなければ取得できた範囲と添える。
  const visKnown = (x.hours ?? []).filter((r) => num(r.visibility) != null).length;
  const parts = [hum != null ? `湿度 平均 ${Math.round(hum)}%` : null, vis != null ? `見通しの最小 ${vis.toFixed(1)}km${visKnown < DAY_HOURS ? `（${PART}）` : ""}` : null].filter(Boolean);
  return parts.length ? parts.join("・") : "—";
}

/** まとめの5行（気温・雨・風・空・光・大気）。雨と風は帯では同じ仲間（雨・風）。 */
export function summaryLines(x: SummaryInput): SummaryLine[] {
  return [
    { group: "temp", label: "気温", text: tempLine(x) },
    { group: "rainwind", label: "雨", text: rainLine(x) },
    { group: "rainwind", label: "風", text: windLine(x) },
    { group: "sky", label: "空・光", text: skyLine(x) },
    { group: "air", label: "大気", text: airLine(x) },
  ];
}

/**
 * いまの値（今日、項目の画面の上、2026-11-24 渡辺さん「今の気温や湿度は個別の項目別として切り出す」）：アメダスのいちばん
 * 新しい10分の観測から、その仲間の項目だけ。無い値は出さない（日射はアメダスに無い）。
 */
const NOW_ITEMS: Record<string, { key: string; label: string; unit: string; digits: number; tone: string }[]> = {
  temp: [{ key: "temp", label: "気温", unit: "℃", digits: 1, tone: "temp" }],
  sky: [{ key: "sun", label: "日照（この1時間）", unit: "h", digits: 1, tone: "sun" }],
  rainwind: [
    { key: "rain", label: "降水（この1時間）", unit: "mm", digits: 1, tone: "rain" },
    { key: "wind", label: "風速", unit: "m/s", digits: 1, tone: "wind" },
  ],
  air: [
    { key: "humidity", label: "湿度", unit: "%", digits: 0, tone: "humidity" },
    { key: "pressure", label: "気圧", unit: "hPa", digits: 1, tone: "pressure" },
    { key: "visibility", label: "視程", unit: "km", digits: 1, tone: "visibility" },
  ],
};

export function nowValues(latest: WeatherRow, group: string) {
  const w = windOf(latest);
  const items = (NOW_ITEMS[group] ?? [])
    .map((x) => {
      const v = num(latest[x.key]);
      return { ...x, v, text: v == null ? "" : v.toFixed(x.digits), note: x.key === "wind" && w != null ? (w === "calm" ? "静穏" : SECTORS[sectorOf(w)]) : "" };
    })
    .filter((x) => x.v != null);
  return { at: typeof latest.observedAt === "string" ? latest.observedAt : null, items };
}
