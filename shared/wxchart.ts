// 天気図 (#249): which surface weather chart (日本周辺) a day can show, and from where. Read from JMA's
// own places as found in WX-01/02 (research/wxchart):
//   実況 (quick): PNG every 3 hours (3〜21時), www.data.jma.go.jp/yoho/data/wxchart/quick/, kept from
//     2024-10; names in UTC (`SPAS_COLOR_yyyyMMddHHmm.png` in the UTC month's folder);
//   保存用天気図: one-page PDFs at 9時・21時, from 2022-12 (added about three months late);
//   日々の天気図: a month's 9時 charts in one PDF, from 2002-01 (also about three months late);
//   before that: the National Diet Library's collection (viewing only).
//   予想天気図 (24・48時間後): only the latest issue, listed in www.jma.go.jp/bosai/weather_map/data/list.json.
// 出典：気象庁ホームページ（公共データ利用規約 第1.0版）.

import { addDays } from "./dates";

const DATA = "https://www.data.jma.go.jp/yoho/data";
/** The first day the 3-hourly PNGs are kept for (WX-02: 2024-09 and before are gone). */
export const QUICK_FROM = "2024-10-01";
/** 保存用天気図 (PDF, 9時・21時) are kept from this day (WX-02). */
export const ARCHIVE_FROM = "2022-12-01";
/** 日々の天気図 (a month's 9時 charts in one PDF) begin with this month. */
export const HIBITEN_FROM = "2002-01-01";
/** The National Diet Library's weather charts, 1883-03 〜 2022-09 (viewing only). */
export const NDL_URL = "https://dl.ndl.go.jp/pid/12896309";
export const CHART_HOURS = [3, 6, 9, 12, 15, 18, 21] as const;
export const CREDIT = "気象庁ホームページより";

/** A day and an hour in Japan time, as JMA's UTC name stamp (yyyyMMddHHmm) and its UTC month (yyyyMM). */
function utcStamp(date: string, hour: number): { stamp: string; month: string } {
  const d = hour >= 9 ? date : addDays(date, -1);
  const h = (hour + 15) % 24;
  const stamp = `${d.replaceAll("-", "")}${String(h).padStart(2, "0")}00`;
  return { stamp, month: stamp.slice(0, 6) };
}

/** The 3-hourly 実況 chart of a day and hour (Japan time). */
export const quickChartUrl = (date: string, hour: number) => {
  const { stamp, month } = utcStamp(date, hour);
  return `${DATA}/wxchart/quick/${month}/SPAS_COLOR_${stamp}.png`;
};

/** The 保存用天気図 PDF of a day at 9時 or 21時 (Japan time). */
export const archiveChartUrl = (date: string, hour: 9 | 21) => {
  const { stamp } = utcStamp(date, hour);
  return `${DATA}/wxchart/archive/${stamp.slice(0, 4)}_${stamp.slice(4, 6)}/PDFDATA/JSMAP/Js_${stamp.slice(0, 10)}.pdf`;
};

/** The month's 日々の天気図 PDF. */
export const hibitenUrl = (date: string) => `${DATA}/hibiten/${date.slice(0, 4)}/${date.slice(2, 4)}${date.slice(5, 7)}.pdf`;

export type DayChart =
  | { kind: "quick"; charts: { hour: number; url: string }[] }
  | { kind: "archive"; pdfs: { hour: 9 | 21; url: string }[] }
  | { kind: "hibiten"; url: string; day: number }
  | { kind: "ndl"; url: string }
  | { kind: "forecast" }
  | { kind: "none" };

/** What a day has: the 3-hourly charts, a PDF to open, the library, or (ahead of today) a forecast chart. */
export function dayChart(date: string, today: string): DayChart {
  if (date > today) return { kind: "forecast" };
  if (date >= QUICK_FROM) return { kind: "quick", charts: CHART_HOURS.map((hour) => ({ hour, url: quickChartUrl(date, hour) })) };
  if (date >= ARCHIVE_FROM) return { kind: "archive", pdfs: ([9, 21] as const).map((hour) => ({ hour, url: archiveChartUrl(date, hour) })) };
  if (date >= HIBITEN_FROM) return { kind: "hibiten", url: hibitenUrl(date), day: Number(date.slice(8)) };
  if (date >= "1883-03-01") return { kind: "ndl", url: NDL_URL };
  return { kind: "none" };
}

/** One 予想天気図 as listed: its picture, when it was drawn from (base) and the time it shows (valid), Japan time ISO. */
export interface ForecastChart {
  url: string;
  hours: 24 | 48;
  base: string;
  valid: string;
}

const BOSAI = "https://www.jma.go.jp/bosai/weather_map/data/png";
const stampIso = (s: string) => {
  const t = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)) + 9 * 3_600_000;
  return new Date(t).toISOString().slice(0, 16).replace("Z", "") + "+09:00";
};

/**
 * The 予想天気図 in JMA's list (bosai weather_map list.json: `near.ft24` / `near.ft48`), named like
 * `…_C_010000_20261116120000_MET_CHT_JCIfsas24_…png` (the base time in UTC).
 */
export function forecastCharts(list: unknown): ForecastChart[] {
  const near = (list as { near?: Record<string, unknown> } | null)?.near;
  const out: ForecastChart[] = [];
  for (const hours of [24, 48] as const) {
    const names = near?.[`ft${hours}`];
    const name = Array.isArray(names) ? names[names.length - 1] : null;
    const m = typeof name === "string" ? name.match(/_C_\d+_(\d{14})_MET_CHT_JCIfsas(24|48)_/) : null;
    if (!m || !/^[\w.-]+$/.test(name as string)) continue;
    const base = stampIso(m[1]);
    const valid = new Date(Date.parse(base) + hours * 3_600_000 + 9 * 3_600_000).toISOString().slice(0, 16) + "+09:00";
    out.push({ url: `${BOSAI}/${name}`, hours, base, valid });
  }
  return out;
}
