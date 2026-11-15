// 材料の一覧 (docs/engineering-principles.md 3): only what both the record (JMA) and the forecast
// (Open-Meteo) have, for the hour and for the day. Anything else is an estimate or display only.

export interface FieldDef {
  /** The material's name in the core. */
  id: string;
  label: string;
  unit: string;
  /** The key the value has on the wire (WeatherRow). */
  wire: string;
  /** JMA leaves the hourly cell blank at night by design (not measured, not missing). */
  blankAtNight?: true;
}

export const HOUR_FIELDS = [
  { id: "temp", label: "気温", unit: "℃", wire: "temp" },
  { id: "humidity", label: "湿度", unit: "%", wire: "humidity" },
  { id: "wind", label: "風速", unit: "m/s", wire: "wind" },
  { id: "rain", label: "降水量", unit: "mm", wire: "rain" },
  { id: "sunshine", label: "日照時間", unit: "h", wire: "sun", blankAtNight: true },
  { id: "pressure", label: "気圧", unit: "hPa", wire: "pressure" },
] as const satisfies readonly FieldDef[];

export const DAY_FIELDS = [
  { id: "temp", label: "平均気温", unit: "℃", wire: "temp" },
  { id: "max", label: "最高気温", unit: "℃", wire: "max" },
  { id: "min", label: "最低気温", unit: "℃", wire: "min" },
  { id: "humidity", label: "平均湿度", unit: "%", wire: "humidity" },
  { id: "wind", label: "平均風速", unit: "m/s", wire: "wind" },
  { id: "windMax", label: "最大風速", unit: "m/s", wire: "windMax" },
  { id: "gust", label: "最大瞬間風速", unit: "m/s", wire: "gust" },
  { id: "rain", label: "降水量", unit: "mm", wire: "rain" },
  { id: "sunshine", label: "日照時間", unit: "h", wire: "sun" },
  { id: "pressure", label: "気圧", unit: "hPa", wire: "pressure" },
] as const satisfies readonly FieldDef[];

export type HourField = (typeof HOUR_FIELDS)[number]["id"];
export type DayField = (typeof DAY_FIELDS)[number]["id"];
