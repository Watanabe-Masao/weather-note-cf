// Reads the JMA past-weather tables (www.data.jma.go.jp/obd/stats/etrn).
// Daily tables: one page per month. Hourly tables: one page per day.

import type { Quality, Station, WeatherRow } from "../../shared/types";

const text = (s: string): string =>
  s
    .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, "")
    .trim();

const TEXT_KEY = /Weather|weather|direction/;
// "--" means the phenomenon did not occur: no rain, no sunshine, no snow.
const ZERO_WHEN_DASH = new Set(["rain", "rainHour", "sun", "snow", "snowDepth"]);
// Hourly columns that are blank by design (no sun at night; snow only noted when it is observed).
const NIGHT_BLANK = new Set(["sun", "radiation", "snow", "snowDepth"]);

export interface ParsedRow {
  n: number;
  raw: Record<string, string>;
  quality: Record<string, Quality>;
  unpublished: string[];
  [field: string]: unknown;
}

/** Parse the "tablefix1" table of a daily or hourly page into rows keyed by day / hour. */
export function parseTable(html: string, hourly = false): ParsedRow[] {
  const table = html.match(/<table[^>]*id=['"]tablefix1['"][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) throw new Error("気象庁の表を読み取れませんでした。時間をおいて再取得してください。");
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((x) => x[1]);
  const heads = rows.filter((x) => /<th\b/i.test(x));

  // Expand rowspan/colspan headers into one label per column.
  const grid: string[][] = Array.from({ length: heads.length }, () => []);
  heads.forEach((r, y) => {
    let x = 0;
    for (const c of r.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi)) {
      while (grid[y][x] != null) x++;
      const rs = +(c[1].match(/rowspan=['"]?(\d+)/)?.[1] ?? 1);
      const cs = +(c[1].match(/colspan=['"]?(\d+)/)?.[1] ?? 1);
      for (let dy = 0; dy < rs && y + dy < grid.length; dy++)
        for (let dx = 0; dx < cs; dx++) grid[y + dy][x + dx] = text(c[2]);
      x += cs;
    }
  });
  const width = Math.max(...grid.map((x) => x.length));
  const labels = Array.from({ length: width }, (_, i) => [...new Set(grid.map((r) => r[i] ?? ""))].join(" "));
  const find = (...rs: RegExp[]) => labels.findIndex((l) => rs.every((r) => r.test(l)));

  const map: Record<string, number> = hourly
    ? {
        temp: find(/気温/),
        rain: find(/降水/),
        humidity: find(/湿度/),
        wind: find(/風速/),
        sun: find(/日照/),
        pressure: find(/気圧/, /海面/),
        dew: find(/露点/),
        radiation: find(/日射/),
        snow: find(/降雪/),
        snowDepth: find(/積雪/),
        direction: find(/風向/, /風向$/),
        weather: find(/^天気/),
      }
    : {
        temp: find(/気温/, /平均/),
        max: find(/気温/, /最高/),
        min: find(/気温/, /最低/),
        rain: find(/降水/, /合計/),
        humidity: find(/湿度/, /平均/),
        humidityMin: find(/湿度/, /最小/),
        wind: find(/風向・風速/, /平均/),
        windMax: find(/最大風速/, /風速$/),
        gust: find(/最大瞬間風速/, /風速$/),
        sun: find(/日照/),
        pressure: find(/気圧/, /海面/),
        rainHour: find(/降水/, /1時間/),
        snow: find(/降雪/),
        snowDepth: find(/最深積雪/),
        dayWeather: find(/天気概況/, /昼/),
        nightWeather: find(/天気概況/, /夜/),
      };
  if (map.temp < 0 || map.rain < 0)
    throw new Error("気象庁の表の形式が変わりました。列の対応を確認する必要があります。");

  const out: ParsedRow[] = [];
  for (const r of rows) {
    if (/<th\b/i.test(r)) continue;
    const cells = [...r.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => text(c[1]));
    const n = +cells[0];
    if (!Number.isInteger(n) || n < 1 || n > (hourly ? 24 : 31)) continue;
    const row: ParsedRow = { n, raw: {}, quality: {}, unpublished: [] };
    for (const [key, i] of Object.entries(map)) {
      const raw = i < 0 ? "" : cells[i] ?? "";
      row.raw[key] = raw;
      if (TEXT_KEY.test(key)) {
        row[key] = /^(|×|\/\/\/|--)$/u.test(raw) ? null : raw;
        continue;
      }
      // Hourly sunshine and radiation are blank at night by design, not unpublished.
      if (i >= 0 && raw === "" && !(hourly && NIGHT_BLANK.has(key))) row.unpublished.push(key);
      const num = raw === "--" && ZERO_WHEN_DASH.has(key) ? 0 : parseFloat(raw);
      row[key] = Number.isFinite(num) ? num : null;
      const q: Quality = raw.includes("]")
        ? "insufficient"
        : raw.includes(")")
          ? "partial"
          : raw === "--"
            ? "none"
            : row[key] == null
              ? "missing"
              : "normal";
      row.quality[key] = q;
    }
    out.push(row);
  }
  return out;
}

export function tableUrl(station: Station, year: number, month: number, day?: number): string {
  const kind = day ? "hourly" : "daily";
  return (
    `https://www.data.jma.go.jp/obd/stats/etrn/view/${kind}_s1.php?` +
    `prec_no=${station.precNo}&block_no=${station.blockNo}&year=${year}&month=${month}&day=${day ?? ""}&view=`
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

export async function fetchDailyMonth(station: Station, month: string, today: string, signal?: AbortSignal) {
  const [y, m] = month.split("-").map(Number);
  const source = tableUrl(station, y, m);
  const r = await fetch(source, { signal: signal ?? AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`気象庁への接続に失敗しました（${r.status}）。`);
  const rows: WeatherRow[] = parseTable(await r.text())
    .map((row) => ({ ...row, date: `${y}-${pad(m)}-${pad(row.n)}`, type: "actual" as const, provider: "JMA" }))
    .filter((row) => row.date < today);
  return { rows, source };
}

export async function fetchHourlyDay(station: Station, day: string, signal?: AbortSignal) {
  const [y, m, d] = day.split("-").map(Number);
  const source = tableUrl(station, y, m, d);
  const r = await fetch(source, { signal: signal ?? AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`気象庁への接続に失敗しました（${r.status}）。`);
  const rows: WeatherRow[] = parseTable(await r.text(), true).map((row) => ({
    ...row,
    date: day,
    type: "actual" as const,
    provider: "JMA",
  }));
  return { rows, source };
}
