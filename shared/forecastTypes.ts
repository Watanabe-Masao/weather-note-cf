// 予報が外れやすい「型」（FS-05、PR #459）。2026-11-24 に定義を固定した（渡辺さん「型の検証を慎重に」）。
//
// ここに書いた条件・期待する効き目・向きは、あとから変えない（変えるなら新しい id にして、固定した日を書く）。
// 過去のデータで見つけ、過去のデータで確かめただけなので、これからの予報で本当に効くかは、画面に出さずに
// 毎日の判定と答え合わせを続けて確かめる（影の運用）。合格の基準（PASS）を通った型だけを画面に出す。
//
// 決まり：予報どうしは混ぜない。材料は気象庁の府県・週間天気予報だけ（Open-Meteo の予報は使わない）。
// 答え合わせは気象庁の観測（事実として共通に使う）。
//
// 材料の作り方（FS-05 の fs05.py・fs04_season.py と同じ）：
//  - 対象日 t の L 日前の予報＝t−L の日に出た発表のうち、値のあるいちばん遅いもの（取り消し・優先でない写しは除く）。
//  - 気温：最高・最低（府県天気予報の日中の最高・朝の最低、週間の最高・最低）。
//  - 降水確率：1日前は府県（中部）の6時間降水確率のいちばん高い区切り（区切りが3つ以上あるとき）、2日前からは週間の日の値。
//  - 天気：2日前までは府県（中部）、3日前からは週間（高知県）の天気予報用テロップ番号の頭の数字（1 晴・2 くもり・3 雨・4 雪）。
//  - 動き：L 日前から 7日前までの同じ対象日の予報が全部そろうときだけ（L ≤ 6）。
//  - 前の日からの変化：同じ日（t−L）に出た、対象日 t の予報 − 前の日 t−1 の予報（前の日は max(L−1, 1) 日前）。


import type { HistoryEntry, HistoryIssue } from "./forecastHistory";
import { ForecastHistory, jstDate, type V } from "./forecastHistoryModel";
import { usableIssues } from "./jmaOfficial";

export const TYPES_FROZEN_AT = "2026-11-24";

export type TypeItem = "max" | "min" | "rainMiss";
export type WxCat = "晴" | "くもり" | "雨" | "雪";

/** ある対象日の、ある日数前の予報（気象庁だけ）。 */
export interface LeadForecast {
  max?: number | null;
  min?: number | null;
  /** 降水確率（％） */
  pop?: number | null;
  wx?: WxCat | null;
}

/** 対象日 t（YYYY-MM-DD）の L 日前の予報を返す（無ければ undefined）。 */
export type LeadLookup = (t: string, L: number) => LeadForecast | undefined;

export interface ForecastType {
  id: string;
  /**
   * "candidate"：合格すれば画面に出す候補（FS-05 のおすすめ）。"watch"：様子を見るだけ（件数が少なく確かめられなかった、
   * FS-06）。どちらも画面には出さず、毎日の判定と答え合わせを続ける。
   */
  stage: "candidate" | "watch";
  /** 固定した日（あとから条件を変えない） */
  frozenAt: string;
  /** FS-05 の表の記号 */
  fs05: string;
  item: TypeItem;
  /** 使う何日前 */
  leads: number[];
  /** 画面での言い方（案、FS-05） */
  text: string;
  /** 外れる向き（気温）。"low"：実際が予報より低い（予報が高すぎ）、"high"：実際が予報より高い、null：決まらない。 */
  direction: "low" | "high" | null;
  /** FS-05 の全期間の値（固定した期待） */
  expected: { ratio: number; ci: [number, number]; hitRate: number; baseRate: number; directionShare?: number };
  /** 条件（材料は気象庁の予報だけ） */
  match: (t: string, L: number, fc: LeadLookup) => boolean;
}

const H = 24 * 3_600_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * H).toISOString().slice(0, 10);
const month = (d: string) => Number(d.slice(5, 7));

/** L 日前から 7日前までの予報（新しい順）。どれかが欠ければ null。L ≤ 6 だけ。 */
function seq(t: string, L: number, fc: LeadLookup, k: "max" | "min"): number[] | null {
  if (L > 6) return null;
  const out: number[] = [];
  for (let l = L; l <= 7; l++) {
    const v = fc(t, l)?.[k];
    if (v == null) return null;
    out.push(v);
  }
  return out;
}

/** 同じ日に出た、対象日の予報 − 前の日の予報。 */
function dayChange(t: string, L: number, fc: LeadLookup, k: "max" | "min"): number | null {
  const a = fc(t, L)?.[k];
  const b = fc(addDays(t, -1), Math.max(L - 1, 1))?.[k];
  return a == null || b == null ? null : a - b;
}

/**
 * 知らせる候補の5つ（FS-05 のおすすめ）を、FS-05 で確かめた何日前のまとまりごとに分けたもの（まとまりで効き目と向きが違う
 * ので、別の型として確かめる）。合格するまで画面には出さない。
 */
export const FORECAST_TYPES: ForecastType[] = [
  {
    id: "A-min-raised-L1",
    stage: "candidate",
    frozenAt: TYPES_FROZEN_AT,
    fs05: "A",
    item: "min",
    leads: [1],
    text: "最低気温の予報が上がってきています。この形の日は、実際はもっと冷えることが多い",
    direction: "low",
    expected: { ratio: 2.63, ci: [2.09, 3.22], hitRate: 0.18, baseRate: 0.07, directionShare: 0.94 },
    // 前日の最低の予報が、7日前の予報より 2℃以上上がっている
    match: (t, L, fc) => {
      const s = seq(t, L, fc, "min");
      return !!s && s[0] - s[s.length - 1] >= 2;
    },
  },
  {
    id: "B-max-rain-L2-3",
    stage: "candidate",
    frozenAt: TYPES_FROZEN_AT,
    fs05: "B・B'",
    item: "max",
    leads: [2, 3],
    text: "雨の予報の日は、最高気温が外れやすい（多くは予報より低い）",
    direction: "low",
    // 70% 以上：2.02（1.73〜2.38）・高すぎ 58%、50〜60%：1.73（1.46〜2.04）・高すぎ 65%。まとめた期待は控えめに 50〜60% の値。
    expected: { ratio: 1.73, ci: [1.46, 2.04], hitRate: 0.34, baseRate: 0.2, directionShare: 0.58 },
    match: (t, L, fc) => {
      const p = fc(t, L)?.pop;
      return p != null && p >= 50;
    },
  },
  {
    id: "B-max-rain-L4-7",
    stage: "candidate",
    frozenAt: TYPES_FROZEN_AT,
    fs05: "B''",
    item: "max",
    leads: [4, 5, 6, 7],
    text: "雨の予報の日は、最高気温が外れやすい",
    direction: null,
    // 4〜7日前で残ったのは 50〜60% だけ（70% 以上は残らなかった）
    expected: { ratio: 1.56, ci: [1.4, 1.75], hitRate: 0.43, baseRate: 0.28 },
    match: (t, L, fc) => {
      const p = fc(t, L)?.pop;
      return p != null && p >= 50 && p <= 60;
    },
  },
  {
    id: "G-rain-summer-cloudy-L2-3",
    stage: "candidate",
    frozenAt: TYPES_FROZEN_AT,
    fs05: "G",
    item: "rainMiss",
    leads: [2, 3],
    text: "夏の、くもり・降水確率 30〜40% の予報は、3 回に 1 回は降る",
    direction: null,
    expected: { ratio: 2.94, ci: [2.16, 3.9], hitRate: 0.27, baseRate: 0.09 },
    match: (t, L, fc) => summerCloudy(t, fc(t, L)),
  },
  {
    id: "G-rain-summer-cloudy-L4-7",
    stage: "candidate",
    frozenAt: TYPES_FROZEN_AT,
    fs05: "G'",
    item: "rainMiss",
    leads: [4, 5, 6, 7],
    text: "夏の、くもり・降水確率 30〜40% の予報は、3 回に 1 回は降る",
    direction: null,
    expected: { ratio: 1.97, ci: [1.53, 2.46], hitRate: 0.32, baseRate: 0.16 },
    match: (t, L, fc) => summerCloudy(t, fc(t, L)),
  },
  {
    id: "E-min-turning-drop-L4-7",
    stage: "candidate",
    frozenAt: TYPES_FROZEN_AT,
    fs05: "E",
    item: "min",
    leads: [4, 5, 6, 7],
    text: "季節の変わり目に、先の予報で冷え込みが来るときは外れやすい（実際は予報ほど下がらないことが多い）",
    direction: "high",
    expected: { ratio: 1.98, ci: [1.6, 2.47], hitRate: 0.39, baseRate: 0.19, directionShare: 0.67 },
    // 3・4・10・11月、同じ日に出た予報で、前の日より最低が 2〜3℃下がる
    match: (t, L, fc) => {
      if (![3, 4, 10, 11].includes(month(t))) return false;
      const d = dayChange(t, L, fc, "min");
      return d != null && d <= -2 && d > -4;
    },
  },
  {
    id: "C-max-moved-L2-3",
    stage: "candidate",
    frozenAt: TYPES_FROZEN_AT,
    fs05: "C",
    item: "max",
    leads: [2, 3],
    text: "予報が直前の発表から 2〜3℃動いた日は、まだ外れやすい",
    direction: null,
    expected: { ratio: 1.67, ci: [1.36, 1.98], hitRate: 0.33, baseRate: 0.2 },
    match: (t, L, fc) => moved(t, L, fc),
  },
  {
    id: "C-max-moved-L4-6",
    stage: "candidate",
    frozenAt: TYPES_FROZEN_AT,
    fs05: "C''",
    item: "max",
    leads: [4, 5, 6],
    text: "予報が直前の発表から 2〜3℃動いた日は、まだ外れやすい",
    direction: null,
    expected: { ratio: 1.59, ci: [1.33, 1.87], hitRate: 0.44, baseRate: 0.28 },
    match: (t, L, fc) => moved(t, L, fc),
  },
  {
    id: "W-max-autumn-falling-L1-3",
    stage: "watch",
    frozenAt: "2026-11-24",
    fs05: "FS-06",
    item: "max",
    leads: [1, 2, 3],
    text: "秋に、最高気温の予報が下がり続けた日は外れやすい（様子を見る候補）",
    direction: null,
    // FS-06（PR #459、fs06b.py）：66件、大外れ ふだんの 2.04 倍（1.10〜3.04）。件数が少なく確かめられなかった。
    expected: { ratio: 2.04, ci: [1.1, 3.04], hitRate: 0, baseRate: 0 },
    // 8〜11月、7日前から L 日前までの並びで、どの発表でも前の発表より上がっておらず、7日前より 2℃以上下がっている
    match: (t, L, fc) => {
      if (![8, 9, 10, 11].includes(month(t))) return false;
      const s = seq(t, L, fc, "max");
      if (!s) return false;
      for (let i = 0; i < s.length - 1; i++) if (s[i] > s[i + 1]) return false;
      return s[0] - s[s.length - 1] <= -2;
    },
  },
];

/** 夏（6〜8月）の、くもり・降水確率 30〜40% の予報。 */
function summerCloudy(t: string, f: LeadForecast | undefined): boolean {
  return [6, 7, 8].includes(month(t)) && f?.pop != null && f.pop >= 30 && f.pop <= 40 && f.wx === "くもり";
}

/** 同じ対象日の、ひとつ前（L+1 日前）の予報からの最高の動きが 2〜3℃（L ≤ 6、7日前までそろうとき）。 */
function moved(t: string, L: number, fc: LeadLookup): boolean {
  const s = seq(t, L, fc, "max");
  if (!s) return false;
  const d = Math.abs(s[0] - s[1]);
  return d > 1 && d <= 3;
}

/** 大外れ：気温は ±2℃超、雨の見逃しは降水確率 50% 未満で 1mm 以上降った。 */
export function bigMiss(item: TypeItem, forecast: LeadForecast, observed: { max?: number | null; min?: number | null; rainMm?: number | null }): boolean | null {
  if (item === "rainMiss") {
    if (forecast.pop == null || observed.rainMm == null || forecast.pop >= 50) return null;
    return observed.rainMm >= 1;
  }
  const f = forecast[item];
  const o = observed[item];
  if (f == null || o == null) return null;
  return Math.abs(f - o) > 2;
}

/**
 * 合格の基準（11/24、画面に出す前）：当てはまった日の大外れの割合が、当てはまらない日の 1.3 倍以上、その倍率の 95% の幅の
 * 下の端が 1 を超える、当てはまった対象日が 20 日以上、外れる向きが決まっている型は向きが同じ側に半分より多い。
 */
export const PASS = { minRatio: 1.3, ciLowAbove: 1, minDays: 20, directionShareAbove: 0.5 };

// ---- 材料を、保存した気象庁の電文の行から作る -------------------------------------------------------------


const CAT: Record<string, WxCat> = { "1": "晴", "2": "くもり", "3": "雨", "4": "雪" };
const num = (v: V | null | undefined) => (v && v.s === "value" ? Number(v.v) : null);

/**
 * 保存した電文の行（forecast_issues・forecast_entries、高知の地点・区域だけ）から、対象日 t の L 日前の予報を引く。
 * `now` より後の発表は使わない。FS-05 と同じ選び方（上の説明）。
 */
export function leadLookup(rows: { issues: HistoryIssue[]; entries: HistoryEntry[] }, now: string): LeadLookup {
  const model = new ForecastHistory({ issues: rows.issues, entries: rows.entries, fetchLog: [] });
  const byDay = new Map<string, HistoryIssue[]>();
  for (const i of usableIssues(rows.issues, now)) {
    const d = jstDate(i.issued_at);
    byDay.set(d, [...(byDay.get(d) ?? []), i]); // 新しい順のまま
  }
  const memo = new Map<string, LeadForecast | undefined>();
  return (t, L) => {
    const key = `${t}|${L}`;
    if (memo.has(key)) return memo.get(key);
    const day = byDay.get(addDays(t, -L)) ?? [];
    const vals = day.map((issue) => ({ issue, v: model.valuesFor(issue, t) })).filter((x) => x.v);
    const out: LeadForecast = {};
    for (const k of ["max", "min"] as const) {
      const hit = vals.find((x) => num(x.v![k]) != null);
      if (hit) out[k] = num(hit.v![k]);
    }
    const wxKind = L <= 2 ? "VPFD51" : "VPFW50";
    const wx = vals.find((x) => x.issue.kind === wxKind && x.v!.weather.s === "value");
    if (wx && wx.v!.weather.s === "value") out.wx = CAT[String(wx.v!.weather.v)[0]] ?? null;
    if (L === 1) {
      const p = vals.find((x) => x.issue.kind === "VPFD51" && (x.v!.pop6 ?? []).filter((q) => num(q) != null).length >= 3);
      if (p) out.pop = Math.max(...p.v!.pop6!.map((q) => num(q)).filter((n): n is number => n != null));
    } else {
      const p = vals.find((x) => x.issue.kind === "VPFW50" && num(x.v!.popDay) != null);
      if (p) out.pop = num(p.v!.popDay);
    }
    const res = Object.keys(out).length ? out : undefined;
    memo.set(key, res);
    return res;
  };
}

/** 対象日 t に当てはまる型（何日前ごと）。 */
export function matchedTypes(t: string, fc: LeadLookup): { type: ForecastType; lead: number; forecast: LeadForecast }[] {
  const out: { type: ForecastType; lead: number; forecast: LeadForecast }[] = [];
  for (const type of FORECAST_TYPES)
    for (const L of type.leads) {
      const f = fc(t, L);
      if (f && type.match(t, L, fc)) out.push({ type, lead: L, forecast: f });
    }
  return out;
}
