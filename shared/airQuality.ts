import type { Usual } from "./airUsual";

// 空気質の画面とサーバーで共有する形（2026-11-25）。/api/air（CAMS のモデルの値）と /api/air-measured
// （そらまめくんの実測。11/25 渡辺さん：商用利用でないのでそのまま使ってよい → だれにでも）。

export interface AirHour {
  /** 時刻（0〜23、その時ちょうどの値）。 */
  h: number;
  pm2_5: number | null;
  pm10: number | null;
  dust: number | null;
  aod: number | null;
}

export interface AirResponse {
  v: 1;
  station: string;
  date: string;
  /** "past"：終わった日の値（airQuality.ts）。"forecast"：今日と先の日の、いちばん新しい予測（終わった日の値がまだ無い昨日も）。 */
  kind: "past" | "forecast";
  hours: AirHour[];
  /** 値を取った時刻（その日の行のうちいちばん新しい取得、ISO、無ければ null）。モデルの計算の時刻ではない。 */
  fetchedAt: string | null;
  /** fetchedAt より前の取得の値のままの時間の数（新しい応答で欠けた時間は前の値を残すため）。 */
  olderHours?: number;
  /** ふだん（手前30日の分位、Weather Note の集計）。 */
  usual?: Usual;
  source: "Open-Meteo（CAMS）";
}

export interface MeasuredHour {
  /** その1時間の終わりの時（1〜24。1 は 0〜1時の値）。 */
  hour: number;
  pm2_5: number | null;
  ox: number | null;
  spm: number | null;
  no2: number | null;
  so2: number | null;
  wd: string | null;
  ws: number | null;
  /** その時間の値を最後に書いた時刻（ISO）。 */
  fetchedAt: string;
}

export interface MeasuredResponse {
  v: 1;
  station: string;
  name: string;
  date: string;
  hours: MeasuredHour[];
  /** いちばん新しい取得の時刻（ISO、無ければ null）。 */
  checkedAt: string | null;
  /** ふだん（手前30日の分位、Weather Note の集計）。 */
  usual?: Usual;
  source: "環境省 大気汚染物質広域監視システム（そらまめくん）";
}

/** 比較の空気（11/25）：1日ごとのまとめ。/api/air-days。値の無い日は数を 0 にして値は null。 */
export interface AirDay {
  date: string;
  /** "past"：終わった日の値。"forecast"：予測（今日と先の日、終わった日の値がまだ無い昨日も）。"none"：CAMS の値が無い日。 */
  kind: "past" | "forecast" | "none";
  /** PM2.5（CAMS）の、値のある時間の平均と、その時間の数。 */
  pmMean: number | null;
  pmHours: number;
  /** 黄砂（CAMS）のいちばん多い値と時刻、値のある時間の数。 */
  dustMax: number | null;
  dustMaxH: number | null;
  dustHours: number;
  /** 介良局の PM2.5 の実測（速報値）の平均と、その時間の数（そらまめくんの地点が無ければ 0）。 */
  measuredMean: number | null;
  measuredHours: number;
}

export interface AirDaysResponse {
  v: 1;
  station: string;
  from: string;
  to: string;
  days: AirDay[];
}
