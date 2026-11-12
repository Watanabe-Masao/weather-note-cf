// How numbers, units, differences and dates are written — everywhere the same.
// Rules: docs/design-system.md, "数値と日付".

/** Units as they are written (always after the number, small). */
export const UNIT = {
  temp: "℃",
  rain: "mm",
  snow: "cm",
  percent: "%",
  wind: "m/s",
  pressure: "hPa",
  radiation: "MJ/㎡",
  hours: "h",
} as const;

/**
 * Decimals per unit. One exception, on purpose: hourly radiation has two decimals because an hour's
 * value is small (0.5 MJ/㎡); the day's total keeps one.
 */
const DIGITS: Record<string, number> = { "℃": 1, 肌感: 1, mm: 1, cm: 1, "%": 0, "m/s": 1, hPa: 0, "MJ/㎡": 1, h: 1, 時間: 0 };

export const digitsOf = (unit: string, hourly = false) => (hourly && unit === "MJ/㎡" ? 2 : (DIGITS[unit] ?? 1));

export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "19.7", "62", "1016" — or "—" when there is no value. */
export function formatValue(v: unknown, unit: string, hourly = false): string {
  const n = num(v);
  return n == null ? "—" : n.toFixed(digitsOf(unit, hourly));
}

/** Hourly sunshine reads as minutes ("40分"); a day's sunshine as hours. */
export const sunshineMinutes = (h: number | null) => (h == null ? "—" : `${Math.round(h * 60)}分`);

/**
 * Difference a − b with its sign: "+1.2", "−0.4", "±0"; "" when either side is missing.
 * Digits follow the unit (or are given).
 */
export function signedDiff(a: unknown, b: unknown, unitOrDigits: string | number = 1): string {
  const x = num(a);
  const y = num(b);
  if (x == null || y == null) return "";
  const digits = typeof unitOrDigits === "number" ? unitOrDigits : digitsOf(unitOrDigits);
  const d = +(x - y).toFixed(digits);
  return d === 0 ? "±0" : d > 0 ? `+${d.toFixed(digits)}` : `−${Math.abs(d).toFixed(digits)}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export const weekdayOf = (d: string) => WEEKDAYS[new Date(d + "T00:00:00Z").getUTCDay()];

/** "11/9" — month and day without zero padding. */
export const monthDay = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8)}`;

/**
 * "2026/11/9（月）": year when asked (a comparison day in another year, or a header),
 * weekday when asked. Never zero-padded.
 */
export function dateLabel(d: string, { year = false, weekday = true }: { year?: boolean; weekday?: boolean } = {}): string {
  return `${year ? `${d.slice(0, 4)}/` : ""}${monthDay(d)}${weekday ? `（${weekdayOf(d)}）` : ""}`;
}

/** The comparison day carries its year when it is in another year than the target day. */
export const needsYear = (d: string | null, target: string) => !!d && d.slice(0, 4) !== target.slice(0, 4);

/**
 * Round axis ticks: a step of 1, 2, 2.5 or 5 × 10ⁿ so labels read "10 / 15 / 20", never "16.8".
 * Returns the widened range and about `count` ticks inside it.
 */
export function niceTicks(lo: number, hi: number, count = 3): { lo: number; hi: number; ticks: number[] } {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = a; t <= b + step / 1000; t += step) ticks.push(+t.toFixed(6));
  return { lo: a, hi: b, ticks };
}

/** Axis tick labels: whole numbers without decimals ("15", not "15.0"); halves keep one. */
export const tickLabel = (t: number) => (Number.isInteger(t) ? String(t) : t.toFixed(Math.abs(t) < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, ""));
