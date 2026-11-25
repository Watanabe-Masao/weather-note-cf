// 空気の質の内訳（2026-11-25 渡辺さん「内訳の詳細画面」→ 空気の質の全項目 →「何が何やら」→ ヒートマップ、色はふだんと比べて）。
//
// 縦に項目、横に 0〜23時。マスの色は、その項目の「ふだん」（その地点の手前30日の1時間値、shared/airUsual.ts）と比べた
// 多さの5段（Weather Note の集計）。数字は時刻を選んで下の表で読む。基準（環境省）と用語は畳んだ欄に分ける。
//
// 決まり（design-system 4.0a、thread-rules）：
// - 誰の値か（CAMS のモデルの値・予測、そらまめくんの実測の速報値）と、Weather Note の集計（ふだんとの比べ）、基準（環境省）を分けて書く。
// - 環境基準は決まった集計（日平均・1時間値・8時間値）とだけ比べる。1時間ごとのマスの色は基準とは関係しない。
// - 日平均の基準は、24時間そろった日だけ内側・外側を言う。1時間値の基準は、取得できた時間についてだけ言う。
// - 光化学オキシダントの環境基準は 8時間値（オゾンとして 0.07 ppm 以下、2025年の改正）なので、1時間値とは比べない。
// - PM10・黄砂・AOD には日本の基準が無い：多い・少ないは「ふだんと比べて」だけで言う。
// 出典：環境省「大気汚染に係る環境基準」（https://www.env.go.jp/kijun/taiki.html）、「微小粒子状物質による大気の汚染に係る環境基準」。
import type { AirHour, MeasuredHour } from "../shared/airQuality";
import type { UsualItem } from "../shared/airUsual";

const DAY = 24;
const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export interface HeatRow {
  /** usual の項目名と同じ（pm2_5・pm10・dust・aod／pm2_5・ox・spm・no2・so2）。 */
  key: string;
  name: string;
  unit: string;
  digits: number;
  /** 時（0〜23）ごとの値。実測はその1時間の平均で、時はその1時間の始まり（「h時台」）。 */
  values: (number | null)[];
  usual: UsualItem | null;
}

export const fmt = (v: number, digits: number) => (digits ? v.toFixed(digits) : String(Math.round(v)));

const byHour = <T>(rows: T[], h: (r: T) => number, v: (r: T) => number | null): (number | null)[] => {
  const out: (number | null)[] = Array(DAY).fill(null);
  for (const r of rows) {
    const x = h(r);
    const y = v(r);
    if (x >= 0 && x < DAY && finite(y)) out[x] = y;
  }
  return out;
};

const CAMS = [
  { key: "pm2_5", name: "PM2.5", unit: "µg/m³", digits: 0 },
  { key: "pm10", name: "PM10", unit: "µg/m³", digits: 0 },
  { key: "dust", name: "黄砂", unit: "µg/m³", digits: 0 },
  { key: "aod", name: "AOD", unit: "", digits: 2 },
] as const;

const MEASURED = [
  { key: "pm2_5", name: "PM2.5", unit: "µg/m³", digits: 0 },
  { key: "ox", name: "オキシダント", unit: "ppm", digits: 3 },
  { key: "spm", name: "SPM", unit: "mg/m³", digits: 3 },
  { key: "no2", name: "NO2", unit: "ppm", digits: 3 },
  { key: "so2", name: "SO2", unit: "ppm", digits: 3 },
] as const;

export function camsRows(hours: AirHour[], usual: Record<string, UsualItem | null> | undefined): HeatRow[] {
  return CAMS.map((c) => ({ ...c, values: byHour(hours, (h) => h.h, (h) => h[c.key]), usual: usual?.[c.key] ?? null }));
}

export function measuredRows(hours: MeasuredHour[], usual: Record<string, UsualItem | null> | undefined): HeatRow[] {
  return MEASURED.map((c) => ({ ...c, values: byHour(hours, (h) => h.hour - 1, (h) => h[c.key]), usual: usual?.[c.key] ?? null }));
}

/** 値のあるいちばん遅い時（無ければ null）。 */
export function lastHour(rows: HeatRow[]): number | null {
  let last: number | null = null;
  for (const r of rows)
    r.values.forEach((v, h) => {
      if (v != null) last = last == null ? h : Math.max(last, h);
    });
  return last;
}

interface DayStats {
  n: number;
  mean: number | null;
  max: number | null;
}
export const dayStats = (values: (number | null)[]): DayStats => {
  const v = values.filter(finite);
  return { n: v.length, mean: v.length ? v.reduce((a, x) => a + x, 0) / v.length : null, max: v.length ? Math.max(...v) : null };
};

const daily = (s: DayStats, limit: number) =>
  s.mean == null ? "" : s.n < DAY ? "（1日分そろっていないので、この日の日平均は参考）" : `（この日の日平均は${s.mean > limit ? "基準を超えています" : "基準の内側"}）`;
const hourlyOk = (s: DayStats, limit: number, digits: number) =>
  s.max == null ? "" : s.max > limit ? `（1時間値が ${fmt(limit, digits)} を超えた時間があります）` : `（${s.n < DAY ? `取得できた ${s.n}時間の` : ""}1時間値はどれも ${fmt(limit, digits)} 以下）`;

export interface Note {
  name: string;
  about: string;
  standard: string;
}

/** 基準と用語（畳んだ欄に出す）。実測の行が無ければ CAMS の項目だけ。 */
export function notes(cams: HeatRow[], measured: HeatRow[] | null): Note[] {
  const c = Object.fromEntries(cams.map((r) => [r.key, dayStats(r.values)]));
  const m = measured ? Object.fromEntries(measured.map((r) => [r.key, dayStats(r.values)])) : null;
  const pmWho = m ? `CAMS${daily(c.pm2_5, 35) || "（値なし）"}、実測${daily(m.pm2_5, 35) || "（値なし）"}。` : `CAMS${daily(c.pm2_5, 35) || "（値なし）"}。`;
  const out: Note[] = [
    { name: "PM2.5", about: "直径 2.5 µm 以下のとても小さな粒子。", standard: `環境基準は 1日平均 35 µg/m³ 以下。${pmWho}` },
    { name: "PM10", about: "直径 10 µm 以下の粒子（PM2.5 も含む）。", standard: "日本の基準は SPM（mg/m³）で決まっていて、PM10 の基準はありません。" },
    { name: "黄砂", about: "大陸から運ばれる砂の粒子（CAMS の dust）。", standard: "気象庁は黄砂の強さを見通し（視程）で伝えていて、µg/m³ の目安はありません。" },
    { name: "AOD", about: "エアロゾルの光学的厚さ（550 nm）。空気中の粒子で光がどれだけ弱まるか。大きいほど空がかすむ。単位なし。", standard: "基準はありません。" },
  ];
  if (m) {
    const no2 =
      m.no2.mean == null
        ? ""
        : m.no2.n < DAY
          ? "（1日分そろっていないので、この日の日平均は参考）"
          : `（この日の日平均は${m.no2.mean > 0.06 ? "ゾーンを超えています" : m.no2.mean >= 0.04 ? "ゾーンの内" : "ゾーンより下"}）`;
    out.push(
      {
        name: "オキシダント",
        about: "光化学オキシダント。日差しで排気ガスなどから生まれるオゾンなど。昼に増えやすい。",
        standard: "環境基準は 8時間値（オゾンとして 0.07 ppm 以下）で、1時間値とは比べません。注意報の目安は 1時間値 0.12 ppm 以上。",
      },
      { name: "SPM", about: "浮遊粒子状物質。直径 10 µm 以下の粒子の重さ。", standard: `環境基準は 1日平均 0.10 mg/m³ 以下${daily(m.spm, 0.1)}、かつ1時間値 0.20 mg/m³ 以下${hourlyOk(m.spm, 0.2, 2)}。` },
      { name: "NO2", about: "二酸化窒素。車や工場の燃焼から出る気体。", standard: `環境基準は 1日平均 0.04〜0.06 ppm のゾーン内か、それ以下${no2}。` },
      { name: "SO2", about: "二酸化硫黄。石炭・石油などの硫黄分の燃焼から出る気体。", standard: `環境基準は 1日平均 0.04 ppm 以下${daily(m.so2, 0.04)}、かつ1時間値 0.1 ppm 以下${hourlyOk(m.so2, 0.1, 1)}。` },
    );
  }
  return out;
}
