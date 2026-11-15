// T-01 (#222): the small pieces of the check, kept apart so they can be tested.

import type { DayType } from "./day-types";

/** A type's mark on the calendar: its sky's colour, and filled (warm), ringed (cool) or a dot (neither). */
export const markOf = (t: Pick<DayType, "sky" | "warm">) => `${t.sky}/${t.warm ?? "plain"}`;

/** A type's name without the warmth added to tell two of the same name apart (「晴れ（24℃）」→「晴れ」). */
export const baseName = (name: string) => name.replace(/（[^）]*）$/, "");

/** YYYY-MM moved by n months. */
export const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/** Every month from `from` to `to`, both included. */
export const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m);
  return out;
};
