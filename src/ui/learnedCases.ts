// 答えから比べる材料へ (#206, #207): the person's answers turned into one-step-ahead cases — which
// answers count (this station, today's words), the hour and date each was answered at, the hours of
// that day and the day before (the short history runs across midnight), the days before (the long
// histories), and the place. Pure: the rows come in through two lookups, so it is tested without a
// store (test/data/learned-cases.test.ts).

import { addDays } from "../../shared/dates";
import type { WeatherRow } from "../../shared/types";
import { type Report, SCALE_VERSION } from "../beta/reports";
import { type Case, type CaseInputs, caseInputs, dayOf, hourOf, type Site } from "../core";

/** Days of the long history read before each answer: L2's window (history.long.ema, 60 days). */
export const HISTORY_DAYS = 60;
/** The answer's words −3 … 3 as the seven steps 0 … 6. */
const SENSATION_OFFSET = 3;
const HOURS = 24;
const JST_MS = 9 * 3_600_000;

/** The JMA hour (1–24) and date an answer belongs to: its snapshot's, else from when it was sent. */
export function placeOf(r: Pick<Report, "snapshot" | "at">): { date: string; hour: number } {
  if (r.snapshot) return { date: r.snapshot.date, hour: r.snapshot.hour };
  const jst = new Date(Date.parse(r.at) + JST_MS);
  return { date: jst.toISOString().slice(0, 10), hour: jst.getUTCHours() + 1 };
}

/** The answers that count: this station, today's words (older words are not the same scale). */
export function countedAnswers(reports: readonly Report[], station: string) {
  return reports.filter((r) => r.station === station && (r.scaleVersion ?? 1) === SCALE_VERSION).map((r) => ({ r, ...placeOf(r) }));
}

export interface Lookups {
  hours: (date: string) => readonly WeatherRow[];
  day: (date: string) => WeatherRow | null | undefined;
}

export function casesFromAnswers(
  answers: ReturnType<typeof countedAnswers>,
  station: string,
  look: Lookups,
  site: Site,
  feel: { alpha: number; absorb: number; thresholds: readonly [number, number, number, number, number, number] },
): Case<CaseInputs>[] {
  const hoursOf = (d: string) =>
    Array.from({ length: HOURS }, (_, i) => look.hours(d).find((r) => r.n === i + 1))
      .map((r) => (r ? hourOf(r, station) : null))
      .map((h) => (h && h.date === d ? h : null));
  return answers.map(({ r, date, hour }) => {
    const hours = [...hoursOf(addDays(date, -1)), ...hoursOf(date)];
    const before = Array.from({ length: HISTORY_DAYS }, (_, i) => look.day(addDays(date, -(i + 1)))).map((row) => (row ? dayOf(row, station) : null));
    const place = r.exposure === "sun" || r.exposure === "shade" || r.exposure === "mixed" ? r.exposure : null;
    return { id: r.id, at: Date.parse(r.at), date, answer: r.sensation + SENSATION_OFFSET, inputs: caseInputs(hours, HOURS + hour - 1, before, place, site, feel, feel.thresholds) };
  });
}
