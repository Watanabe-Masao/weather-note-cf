// β②: how it felt, reported by the person, with the weather at that moment attached.
//
// Reports are the person's own records and cannot be fetched again, so they live in their own
// database (not the weather cache): 保存データを消去 never touches them, and the weather data's
// version bumps never rebuild them. Each report carries a snapshot of the station's hour (with
// where each value came from: AMeDAS, JMA or forecast), the 最近の基準 and the differences, so a
// later analysis (M0–M3 of the proposal) needs nothing else. `updatedAt` / `deleted` are kept for
// syncing (β③).

import { type IDBPDatabase, openDB } from "idb";
import { feelOf, type FeelSettings, radiationOf } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";
import { hourOrigin, type Origin } from "../data/authority";
import type { Baseline, Departures } from "./adaptation";

/** The 7-point thermal sensation scale (ASHRAE 55, −3 … +3) in its usual Japanese wording. */
export const SENSATIONS = [
  { value: -3, label: "寒い" },
  { value: -2, label: "涼しい" },
  { value: -1, label: "やや涼しい" },
  { value: 0, label: "どちらでもない" },
  { value: 1, label: "やや暖かい" },
  { value: 2, label: "暖かい" },
  { value: 3, label: "暑い" },
] as const;
export const EXPOSURES = [
  { id: "sun", label: "日なた" },
  { id: "shade", label: "日かげ" },
  { id: "mixed", label: "半々" },
] as const;
export const WINDS = [
  { id: "strong", label: "強い" },
  { id: "weak", label: "弱い" },
  { id: "none", label: "なし" },
] as const;

export type Sensation = (typeof SENSATIONS)[number]["value"];
export type Exposure = (typeof EXPOSURES)[number]["id"];
export type WindFelt = (typeof WINDS)[number]["id"];

/** The station's values for the hour, each with its source. */
export interface Snapshot {
  /** The hour used (JMA hour n = the value at n:00) and its date. */
  date: string;
  hour: number;
  temp: number | null;
  humidity: number | null;
  wind: number | null;
  /** W/m². */
  solar: number | null;
  from: Partial<Record<"temp" | "humidity" | "wind" | "solar", Origin>>;
  /** 日なた温度 / 日かげ温度 for that hour (with the 肌感 settings of the moment). */
  sunTemp: number | null;
  shadeTemp: number | null;
}

export interface Report {
  id: string;
  /** When it was reported (ISO, UTC). */
  at: string;
  station: string;
  sensation: Sensation;
  exposure: Exposure;
  windFelt: WindFelt;
  snapshot: Snapshot | null;
  baseline: (Baseline & { alpha: number }) | null;
  departures: Pick<Departures, "air" | "sun" | "shade"> | null;
  /** For syncing: last change (ms) and a soft delete. */
  updatedAt: number;
  deleted?: boolean;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

/**
 * The station's hour closest before `hour` that has a measured or forecast temperature, and its
 * values with their sources. Today's hours mix AMeDAS and forecast; each row says which it is.
 */
export function snapshotOf(rows: WeatherRow[] | null, hour: number, feel: FeelSettings): Snapshot | null {
  if (!rows?.length) return null;
  const row = [...rows]
    .filter((r) => r.n <= hour && num(r.temp) != null)
    .sort((a, b) => b.n - a.n)[0];
  if (!row) return null;
  // Each saved hour carries its own source (正本管理); today's observed hours are AMeDAS otherwise.
  const own = hourOrigin(row, { kind: "variable", source: row.type === "forecast" ? "forecast" : "current" });
  const fieldFrom = (k: string): Origin => ((row.origin as Record<string, Origin> | undefined)?.[k] ?? own);
  const solar = radiationOf(row);
  const forecast = row.type === "forecast";
  return {
    date: row.date,
    hour: row.n,
    temp: num(row.temp),
    humidity: num(row.humidity),
    wind: num(row.wind),
    solar: solar == null ? null : Math.round(solar),
    from: {
      temp: fieldFrom("temp"),
      humidity: fieldFrom("humidity"),
      wind: fieldFrom("wind"),
      ...(solar != null ? { solar: fieldFrom(num(row.solar) != null ? "solar" : "radiation") } : {}),
    },
    sunTemp: round1(feelOf(row.temp, row.humidity, row.wind, forecast, { ...feel, sun: true }, solar)),
    shadeTemp: round1(feelOf(row.temp, row.humidity, row.wind, forecast, { ...feel, sun: false }, solar)),
  };
}

/** The hour (1–24) in Japan for a moment. */
export function jstHourOf(ms: number): number {
  const h = new Date(ms + 9 * 3_600_000).getUTCHours();
  return h === 0 ? 24 : h;
}

// ---- CSV ---------------------------------------------------------------------------------------

const COLUMNS = [
  "at_jst",
  "station",
  "sensation",
  "sensation_label",
  "exposure",
  "wind_felt",
  "obs_date",
  "obs_hour",
  "temp",
  "humidity",
  "wind",
  "solar_w_m2",
  "temp_from",
  "humidity_from",
  "wind_from",
  "solar_from",
  "sun_temp",
  "shade_temp",
  "baseline",
  "baseline_alpha",
  "baseline_forecast_mixed",
  "dep_air",
  "dep_sun",
  "dep_shade",
  "id",
] as const;

const cell = (v: unknown) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** ISO time in Japan without the zone letter ("2026-11-11T20:31:05+09:00"). */
export function jstIso(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 19);
  return `${d}+09:00`;
}

/** One row per report (deleted ones left out), oldest first, with a BOM so Excel reads Japanese. */
export function toCsv(reports: Report[]): string {
  const live = reports.filter((r) => !r.deleted).sort((a, b) => (a.at < b.at ? -1 : 1));
  const lines = live.map((r) =>
    [
      jstIso(r.at),
      r.station,
      r.sensation,
      SENSATIONS.find((s) => s.value === r.sensation)?.label,
      r.exposure,
      r.windFelt,
      r.snapshot?.date,
      r.snapshot?.hour,
      r.snapshot?.temp,
      r.snapshot?.humidity,
      r.snapshot?.wind,
      r.snapshot?.solar,
      r.snapshot?.from.temp,
      r.snapshot?.from.humidity,
      r.snapshot?.from.wind,
      r.snapshot?.from.solar,
      r.snapshot?.sunTemp,
      r.snapshot?.shadeTemp,
      r.baseline?.value,
      r.baseline?.alpha,
      r.baseline ? (r.baseline.forecastMixed ? 1 : 0) : null,
      r.departures?.air,
      r.departures?.sun,
      r.departures?.shade,
      r.id,
    ]
      .map(cell)
      .join(","),
  );
  return "﻿" + [COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
}

// ---- storage -----------------------------------------------------------------------------------

const DB = "weather-note-reports";
const STORE = "reports";

export interface ReportStore {
  all(): Promise<Report[]>;
  put(r: Report): Promise<void>;
  /** Soft delete (kept for syncing). */
  remove(id: string): Promise<void>;
  /** Remove every report from this device. */
  wipe(): Promise<void>;
}

let opened: Promise<IDBPDatabase> | null = null;
const db = () =>
  (opened ??= openDB(DB, 1, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: "id" });
    },
  }));

/** Reports in IndexedDB; in memory when IndexedDB is not available (private browsing). */
export function reportStore(): ReportStore {
  const memory = new Map<string, Report>();
  const safe = async <T>(fn: (d: IDBPDatabase) => Promise<T>, fallback: () => T): Promise<T> => {
    try {
      return await fn(await db());
    } catch {
      return fallback();
    }
  };
  return {
    all: () => safe((d) => d.getAll(STORE) as Promise<Report[]>, () => [...memory.values()]),
    put: (r) => safe(async (d) => void (await d.put(STORE, r)), () => void memory.set(r.id, r)),
    remove: (id) =>
      safe(
        async (d) => {
          const r = (await d.get(STORE, id)) as Report | undefined;
          if (r) await d.put(STORE, { ...r, deleted: true, updatedAt: Date.now() });
        },
        () => {
          const r = memory.get(id);
          if (r) memory.set(id, { ...r, deleted: true, updatedAt: Date.now() });
        },
      ),
    wipe: () => safe((d) => d.clear(STORE), () => memory.clear()),
  };
}

/** A new report id (random, no personal information in it). */
export const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
