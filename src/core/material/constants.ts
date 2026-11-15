// 材料の決まりの数 (docs/engineering-principles.md 5): numbers fixed by the data's own conventions,
// named with their basis. Not parameters: nothing fits or changes them.

/** JMA's hourly tables number the hours 1–24: hour n covers (n−1):00–n:00, and 0:00 is hour 24 of
 *  the day before (気象庁 時別値の表). */
export const HOUR_FIRST = 1;
export const HOUR_LAST = 24;
