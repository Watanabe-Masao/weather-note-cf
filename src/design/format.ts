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
  // The difference of the values as shown (each rounded first), so the numbers on screen add up:
  // 22.1 and 21.3 give +0.8, not the +0.7 of the unrounded 22.14 and 21.36.
  const d = +(+x.toFixed(digits) - +y.toFixed(digits)).toFixed(digits);
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
  // 2.5 only where it stays a round label (0.25, 25, 250): at units it would read 1022.5.
  const steps = [1, 2, 2.5, 5, 10].map((m) => m * mag).filter((x) => mag !== 1 || Number.isInteger(x));
  const step = steps.find((x) => x >= raw) ?? 10 * mag;
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = a; t <= b + step / 1000; t += step) ticks.push(+t.toFixed(6));
  return { lo: a, hi: b, ticks };
}

/** Axis tick labels: whole numbers without decimals ("15", not "15.0"); halves keep one. */
export const tickLabel = (t: number) => (Number.isInteger(t) ? String(t) : t.toFixed(Math.abs(t) < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, ""));

/** Width (px) of a chart's y-axis column for these tick labels at the 10 px numeric font, with its gap. */
export const axisWidth = (labels: string[]) => Math.max(28, 10 + Math.max(0, ...labels.map((l) => l.length)) * 6.2);

/** The line's name: a shared start said once (気圧最高 / 気圧最低 → 気圧 最高/最低). */
export function lineLabel(labels: string[]): string {
  if (labels.length < 2) return labels[0] ?? "";
  let n = 0;
  while (n < labels[0].length && labels.every((l) => l[n] === labels[0][n])) n++;
  // Keep each remainder a word of two letters at least (気圧最 高/低 reads badly: 気圧 最高/最低).
  while (n > 0 && labels.some((l) => l.length - n < 2)) n--;
  if (n === 0 || labels.some((l) => l.length === n)) return labels.join("/");
  return `${labels[0].slice(0, n)} ${labels.map((l) => l.slice(n)).join("/")}`;
}

/** "10時間41分" from minutes, rounded to the minute first (never 9時間60分). */
export function hoursMinutes(min: number): string {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}時間${String(m % 60).padStart(2, "0")}分`;
}

/**
 * Words for a narrow column: a break allowed only before the last word (日差しの｜明るさ, とても｜明るい,
 * 日の出前後の｜空), as U+200B; with word-break: keep-all nothing else breaks.
 */
export const phraseBreak = (v: string) => v.replace(/(明るさ|明るい|まぶしい|暗い|空)$/, "\u200b$1");
