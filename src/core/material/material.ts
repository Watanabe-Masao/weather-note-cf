// 材料 (docs/engineering-principles.md 1–4): the record and the forecast in one shape. A value is
// there (a number) or not (null) — never filled in. Where it came from travels with it.

import type { Quality, WeatherRow } from "../../../shared/types";
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

export interface Material<F extends string> extends Origin {
  values: Record<F, number | null>;
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

function read<F extends string>(row: WeatherRow, fields: readonly (FieldDef & { id: F })[]) {
  const values = {} as Record<F, number | null>;
  const rough: F[] = [];
  for (const f of fields) {
    const v = row[f.wire];
    const ok = admits(row.quality?.[f.wire]);
    values[f.id] = typeof v === "number" && Number.isFinite(v) && ok !== "no" ? v : null;
    if (values[f.id] != null && ok === "rough") rough.push(f.id);
  }
  return { values, rough };
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
  if (!Number.isInteger(row.n) || row.n < 1 || row.n > 24) return null;
  return { ...origin(row, station), hour: row.n, ...read(row, HOUR_FIELDS) };
}

/** One daily row as material. */
export function dayOf(row: WeatherRow, station: string): MaterialDay {
  return { ...origin(row, station), ...read(row, DAY_FIELDS) };
}
