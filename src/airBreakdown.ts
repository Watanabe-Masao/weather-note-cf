// 空気の質の内訳（2026-11-25 渡辺さん「内訳の詳細画面」→ 空気の質の全項目）：CAMS のモデルの値（PM2.5・PM10・黄砂・AOD、
// だれでも）と、そらまめくんの実測（PM2.5・光化学オキシダント・SPM・NO2・SO2・風、管理者だけ）を項目ごとに。
//
// 決まり（design-system 4.0a、thread-rules）：
// - 誰の値か（CAMS の予測／モデルの値、実測の速報値）と、基準（環境省）を分けて書く。
// - 環境基準は決まった集計（日平均・1時間値・8時間値）とだけ比べる。1日そろっていない日平均は「取得できた N時間の平均」とし、
//   内側・外側は言わない。1時間値の基準は、取得できた時間についてだけ言う。
// - 光化学オキシダントの環境基準は 8時間値（オゾンとして 0.07 ppm 以下）なので、1時間値とは比べない。並べるのは大気汚染防止法の
//   注意報の目安（1時間値 0.12 ppm 以上）だけ。
// - PM10・黄砂・AOD には日本の µg/m³ の基準が無い：多い・少ないは言わない。
// 出典：環境省「大気汚染に係る環境基準」（https://www.env.go.jp/kijun/taiki.html）、「微小粒子状物質による大気の汚染に係る環境基準」。
import type { AirHour, MeasuredHour } from "../shared/airQuality";
import { SECTORS } from "../shared/windDirection";

const DAY = 24;
const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export interface Point {
  /** 横軸の時（0〜23）。 */
  x: number;
  v: number;
}

export interface BreakdownItem {
  key: string;
  name: string;
  unit: string;
  /** 1行の説明（何の値か）。 */
  about: string;
  points: Point[];
  /** 小数の桁。 */
  digits: number;
  /** 基準・目安と、その読み（無ければ null）。 */
  standard: string | null;
  /** グラフの上端の下限（基準の値。小さな値が上端に張りつかないよう、基準のある項目は基準の高さまでを描く）。 */
  scaleTop?: number;
  /** 1時間の平均の値か（実測。x はその1時間の始まりの時で、「x時台」と読む）。CAMS はその時ちょうどの値。 */
  span?: boolean;
}

export interface Stats {
  n: number;
  mean: number | null;
  max: Point | null;
  last: Point | null;
}

export function stats(points: Point[]): Stats {
  const max = points.reduce<Point | null>((a, p) => (a == null || p.v > a.v ? p : a), null);
  return {
    n: points.length,
    mean: points.length ? points.reduce((a, p) => a + p.v, 0) / points.length : null,
    max,
    last: points.length ? points[points.length - 1] : null,
  };
}

export const fmt = (v: number, digits: number) => (digits ? v.toFixed(digits) : String(Math.round(v)));

/** 日平均の基準：24時間そろったときだけ内側・外側を言う（値そのものは上の行に出ているので繰り返さない）。 */
function dailyMean(s: Stats, limit: number, label: string): string {
  if (s.mean == null) return `${label}。`;
  if (s.n < DAY) return `${label}。1日分そろっていないので、日平均の基準は参考です。`;
  return `${label}。この日の日平均は${s.mean > limit ? "基準を超えています" : "基準の内側です"}。`;
}

/** 1時間値の基準：取得できた時間についてだけ言う。 */
function hourly(s: Stats, limit: number, digits: number): string {
  if (!s.max) return "";
  const over = s.max.v > limit;
  const all = s.n < DAY ? `取得できた ${s.n}時間` : "24時間";
  return over ? `1時間値は ${s.max.x}時台に ${fmt(s.max.v, digits)} で、${fmt(limit, digits)} を超えました。` : `${all}の1時間値はどれも ${fmt(limit, digits)} 以下です。`;
}

/** CAMS（モデルの値）の4項目。 */
export function camsItems(hours: AirHour[]): BreakdownItem[] {
  const pts = (k: "pm2_5" | "pm10" | "dust" | "aod") => hours.filter((h) => finite(h[k])).map((h) => ({ x: h.h, v: h[k] as number }));
  const pm = pts("pm2_5");
  return [
    {
      key: "pm25",
      scaleTop: 35,
      name: "PM2.5",
      unit: "µg/m³",
      about: "直径 2.5 µm 以下のとても小さな粒子。",
      points: pm,
      digits: 0,
      standard: dailyMean(stats(pm), 35, "環境省の環境基準は 1日平均 35 µg/m³ 以下"),
    },
    {
      key: "pm10",
      name: "PM10",
      unit: "µg/m³",
      about: "直径 10 µm 以下の粒子（PM2.5 も含む）。",
      points: pts("pm10"),
      digits: 0,
      standard: "日本の環境基準は浮遊粒子状物質（SPM、mg/m³）で決まっていて、PM10 の µg/m³ の基準はありません。",
    },
    {
      key: "dust",
      name: "黄砂",
      unit: "µg/m³",
      about: "大陸から運ばれる砂の粒子（CAMS の dust）。",
      points: pts("dust"),
      digits: 0,
      standard: "気象庁は黄砂の強さを見通し（視程）で伝えていて、µg/m³ の目安はありません。",
    },
    {
      key: "aod",
      name: "AOD",
      unit: "",
      about: "エアロゾルの光学的厚さ（550 nm）。空気中の粒子で光がどれだけ弱まるか。大きいほど空がかすむ。単位はありません。",
      points: pts("aod"),
      digits: 2,
      standard: null,
    },
  ];
}

/** 実測（そらまめくん）の項目。時はその1時間の終わり（1〜24）なので、横軸はその1時間の始まり（0〜23、「x時台」）にする。 */
export function measuredItems(hours: MeasuredHour[]): BreakdownItem[] {
  const pts = (k: "pm2_5" | "ox" | "spm" | "no2" | "so2" | "ws") => hours.filter((h) => finite(h[k])).map((h) => ({ x: h.hour - 1, v: h[k] as number }));
  const pm = pts("pm2_5");
  const spm = pts("spm");
  const no2 = pts("no2");
  const so2 = pts("so2");
  const ox = pts("ox");
  const sOx = stats(ox);
  const sNo2 = stats(no2);
  const no2Zone =
    sNo2.mean == null
      ? ""
      : sNo2.n < DAY
        ? "1日分そろっていないので、日平均の基準は参考です。"
        : `この日の日平均は${sNo2.mean > 0.06 ? "ゾーンを超えています" : sNo2.mean >= 0.04 ? "ゾーンの内です" : "ゾーンより下です"}。`;
  return [
    {
      key: "pm25",
      scaleTop: 35,
      name: "PM2.5",
      unit: "µg/m³",
      about: "直径 2.5 µm 以下のとても小さな粒子。",
      points: pm,
      digits: 0,
      span: true,
      standard: dailyMean(stats(pm), 35, "環境基準は 1日平均 35 µg/m³ 以下"),
    },
    {
      key: "ox",
      scaleTop: 0.12,
      name: "光化学オキシダント",
      unit: "ppm",
      about: "日差しで排気ガスなどから生まれるオゾンなど。昼の日差しが強いと増える。",
      points: ox,
      digits: 3,
      span: true,
      standard: `環境基準は 8時間値（オゾンとして 0.07 ppm 以下）なので、1時間値とは比べません。注意報の目安は 1時間値 0.12 ppm 以上です${sOx.max ? `（この日のいちばん高い1時間値は ${fmt(sOx.max.v, 3)}）` : ""}。`,
    },
    {
      key: "spm",
      scaleTop: 0.2,
      name: "浮遊粒子状物質（SPM）",
      unit: "mg/m³",
      about: "直径 10 µm 以下の粒子の重さ（日本の基準の決め方）。",
      points: spm,
      digits: 3,
      span: true,
      standard: `${dailyMean(stats(spm), 0.1, "環境基準は 1日平均 0.10 mg/m³ 以下、かつ1時間値 0.20 mg/m³ 以下")}${hourly(stats(spm), 0.2, 2)}`,
    },
    {
      key: "no2",
      scaleTop: 0.06,
      name: "二酸化窒素（NO2）",
      unit: "ppm",
      about: "車や工場の燃焼から出る気体。",
      points: no2,
      digits: 3,
      span: true,
      standard: `環境基準は 1日平均が 0.04〜0.06 ppm のゾーン内か、それ以下。${no2Zone}`,
    },
    {
      key: "so2",
      scaleTop: 0.1,
      name: "二酸化硫黄（SO2）",
      unit: "ppm",
      about: "石炭・石油などの硫黄分の燃焼から出る気体。",
      points: so2,
      digits: 3,
      span: true,
      standard: `${dailyMean(stats(so2), 0.04, "環境基準は 1日平均 0.04 ppm 以下、かつ1時間値 0.1 ppm 以下")}${hourly(stats(so2), 0.1, 1)}`,
    },
    {
      key: "ws",
      name: "風速",
      unit: "m/s",
      about: "測定局の風（風向はいちばん新しい時間の16方位）。",
      points: pts("ws"),
      digits: 1,
      span: true,
      standard: null,
    },
  ];
}

const EN = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** そらまめくんの風向（N・NNE … CALM）を日本語の16方位に（読めなければそのまま）。 */
export const windWord = (wd: string) => (/^calm$/i.test(wd) ? "静穏" : (SECTORS[EN.indexOf(wd.toUpperCase())] ?? wd));

/** いちばん新しい風向と、その時（その1時間の終わり）。無ければ null。 */
export function lastWind(hours: MeasuredHour[]): { word: string; hour: number } | null {
  const h = [...hours].reverse().find((x) => x.wd);
  return h ? { word: windWord(h.wd!), hour: h.hour } : null;
}
