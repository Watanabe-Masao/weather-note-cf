// 材料 (docs/engineering-principles.md 1–4): the record and the forecast in one shape. A value is
// there (a number) or not (null) — never filled in — and a value that is not there says why.
// Where it came from travels with it.

import type { Quality, WeatherRow } from "../../../shared/types";
import { HOUR_FIRST, HOUR_LAST } from "./constants";
import { DAY_FIELDS, type DayField, type FieldDef, HOUR_FIELDS, type HourField } from "./fields";

/** 記録 (measured) or 予報 (forecast). */
export type Kind = "record" | "forecast";

interface Origin {
  station: string;
  date: string;
  kind: Kind;
  /** Who gave the values ("JMA", "JMA-amedas", "JMA-recent", "Open-Meteo"). */
  provider: string;
  /** 速報: the values may still change (AMeDAS before the tables are published). */
  provisional: boolean;
}

/**
 * Why a material is not there (principles 2). A failed fetch never reaches the core: it arrives as
 * no row at all.
 * - notProvided: the source has no such column (アメダスの速報に最大瞬間風速はない)
 * - unpublished: the column exists, the value is not out yet
 * - blank: an empty cell that the table does not explain — JMA's hourly 日照 is empty both at
 *   night (not measured) and for an hour not out yet. The material cannot tell which; whether it
 *   is night is for an estimate that knows the sun (never "blank means 0")
 * - notObserved: 欠測, or no value
 * - rejected: there is a number, but its quality keeps it out (資料不足値, or no quality mark)
 */
export type Absence = "notProvided" | "unpublished" | "blank" | "notObserved" | "rejected";

export interface Material<F extends string> extends Origin {
  /** A number, or null exactly when `absent` names the field. */
  values: Record<F, number | null>;
  absent: Partial<Record<F, Absence>>;
  /** Fields whose value is 準正常値: kept, but named so a reader can leave them out. */
  rough: F[];
}

export interface MaterialHour extends Material<HourField> {
  /** JMA's hour: n covers (n−1):00–n:00, 1–24. */
  hour: number;
}

export type MaterialDay = Material<DayField>;

/** Whether a wire value goes into the material, by JMA's quality mark (principles 4). */
export function admits(q: Quality | undefined): "yes" | "rough" | "no" {
  switch (q) {
    case "normal":
    case "none": // 現象なし: measured, and it was 0 (the parser already made it 0)
      return "yes";
    case "partial":
      return "rough";
    default: // insufficient, missing, or no mark at all
      return "no";
  }
}

/**
 * Why a field is not taken, in this order (principles 4):
 * 1. the row has no such column → notProvided
 * 2. the source says it is not out yet → unpublished, even if a number is there: a value the source
 *    has not published is not a value yet (the two never meet in JMA's parser; the rule is for a
 *    row that says both)
 * 3. a number whose quality keeps it out → rejected
 * 4. an empty cell the table does not explain → blank; anything else → notObserved
 */
function absence(row: WeatherRow, f: FieldDef, hourly: boolean, isNumber: boolean): Absence {
  if (!(f.wire in row)) return "notProvided";
  if (row.unpublished?.includes(f.wire)) return "unpublished";
  if (isNumber) return "rejected";
  if (hourly && f.blankAmbiguous && row.raw?.[f.wire] === "") return "blank";
  return "notObserved";
}

function read<F extends string>(row: WeatherRow, fields: readonly (FieldDef & { id: F })[], hourly: boolean) {
  const values = {} as Record<F, number | null>;
  const absent: Partial<Record<F, Absence>> = {};
  const rough: F[] = [];
  for (const f of fields) {
    const v = row[f.wire];
    const isNumber = typeof v === "number" && Number.isFinite(v);
    const ok = admits(row.quality?.[f.wire]);
    if (isNumber && ok !== "no" && !row.unpublished?.includes(f.wire)) {
      values[f.id] = v;
      if (ok === "rough") rough.push(f.id);
    } else {
      values[f.id] = null;
      absent[f.id] = absence(row, f, hourly, isNumber);
    }
  }
  return { values, absent, rough };
}

function origin(row: WeatherRow, station: string): Origin {
  return {
    station,
    date: row.date,
    kind: row.type === "forecast" ? "forecast" : "record",
    provider: row.provider,
    provisional: row.type === "forecast" ? false : row.provisional === true,
  };
}

/** One hourly row as material; null when the row is not a valid hour. */
export function hourOf(row: WeatherRow, station: string): MaterialHour | null {
  if (!Number.isInteger(row.n) || row.n < HOUR_FIRST || row.n > HOUR_LAST) return null;
  return { ...origin(row, station), hour: row.n, ...read(row, HOUR_FIELDS, true) };
}

/** One daily row as material. */
export function dayOf(row: WeatherRow, station: string): MaterialDay {
  return { ...origin(row, station), ...read(row, DAY_FIELDS, false) };
}
