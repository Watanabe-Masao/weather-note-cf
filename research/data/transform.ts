// #45: the research export, turned into the analysis tables. Pure functions (no DuckDB, no
// network), so the same rules are tested in CI and used by build.ts.
//
// The export is what /api/admin/research gives: consenting people's live reports under their
// research IDs, and the list of withdrawals (consent taken back, account deleted).

import { inputQuality, observedAt } from "../../src/beta/quality";
import type { Report } from "../../src/beta/reports";

export const SCHEMA_VERSION = 1;

export interface Export {
  datasetId: string;
  exportedAt: number;
  rows: { researchId: string; report: Report }[];
  withdrawn: { researchId: string; at: number; reason: string }[];
  /** Research IDs already removed from this file (purged after a later withdrawal). */
  purged?: string[];
  /** Reports removed from this file because a later export no longer had them (deleted). */
  trimmed?: number;
}

/** The table definitions (DuckDB SQL). Types, keys and what may be missing are fixed here. */
export const TABLES: Record<string, string> = {
  datasets: `CREATE TABLE datasets (
    dataset_id VARCHAR PRIMARY KEY, exported_at TIMESTAMPTZ NOT NULL, schema_version INTEGER NOT NULL,
    hash VARCHAR NOT NULL, n_reports INTEGER NOT NULL, n_people INTEGER NOT NULL, n_purged INTEGER NOT NULL, n_trimmed INTEGER NOT NULL)`,
  sensation_reports: `CREATE TABLE sensation_reports (
    dataset_id VARCHAR NOT NULL, report_id VARCHAR NOT NULL, research_id VARCHAR NOT NULL,
    reported_at TIMESTAMPTZ NOT NULL, sensation TINYINT NOT NULL, scale_version TINYINT NOT NULL,
    exposure VARCHAR, wind_felt VARCHAR, sky VARCHAR, opened_at TIMESTAMPTZ, notified_at TIMESTAMPTZ,
    trainable BOOLEAN NOT NULL, excluded_reason VARCHAR,
    thermal_preference VARCHAR, drink_preference VARCHAR, preference_version TINYINT,
    PRIMARY KEY (dataset_id, report_id))`,
  weather_snapshots: `CREATE TABLE weather_snapshots (
    dataset_id VARCHAR NOT NULL, report_id VARCHAR NOT NULL, observed_at TIMESTAMPTZ, lag_min INTEGER,
    status VARCHAR NOT NULL, quality_flags VARCHAR NOT NULL,
    temp DOUBLE, humidity DOUBLE, wind DOUBLE, solar DOUBLE, sun_temp DOUBLE, shade_temp DOUBLE,
    temp_from VARCHAR, humidity_from VARCHAR, wind_from VARCHAR, solar_from VARCHAR,
    baseline DOUBLE, transform VARCHAR, retrieved_at TIMESTAMPTZ,
    PRIMARY KEY (dataset_id, report_id))`,
  prediction_snapshots: `CREATE TABLE prediction_snapshots (
    dataset_id VARCHAR NOT NULL, report_id VARCHAR NOT NULL, model_version VARCHAR NOT NULL, learning_state VARCHAR,
    p0 DOUBLE NOT NULL, p1 DOUBLE NOT NULL, p2 DOUBLE NOT NULL, p3 DOUBLE NOT NULL, p4 DOUBLE NOT NULL, p5 DOUBLE NOT NULL, p6 DOUBLE NOT NULL,
    mode TINYINT NOT NULL, expected DOUBLE NOT NULL, mu DOUBLE, h DOUBLE, z DOUBLE, z_lo DOUBLE, z_hi DOUBLE,
    mu_lo DOUBLE, mu_hi DOUBLE, sd_answer DOUBLE, sd_param DOUBLE, n_reports INTEGER, predicted_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (dataset_id, report_id))`,
  model_runs: `CREATE TABLE model_runs (
    run_id VARCHAR PRIMARY KEY, dataset_id VARCHAR NOT NULL, code_commit VARCHAR NOT NULL, model_version VARCHAR NOT NULL,
    seed INTEGER, started_at TIMESTAMPTZ NOT NULL, settings VARCHAR NOT NULL)`,
  parameter_estimates: `CREATE TABLE parameter_estimates (
    run_id VARCHAR NOT NULL, research_id VARCHAR NOT NULL, model_id VARCHAR NOT NULL, parameter VARCHAR NOT NULL,
    estimate DOUBLE NOT NULL, lower DOUBLE, upper DOUBLE, weight DOUBLE NOT NULL, n INTEGER NOT NULL)`,
  evaluation_results: `CREATE TABLE evaluation_results (
    run_id VARCHAR NOT NULL, research_id VARCHAR NOT NULL, metric VARCHAR NOT NULL, value DOUBLE, sample_count INTEGER NOT NULL)`,
};

type Cell = string | number | boolean | null;
export type Rows = Record<string, Cell[][]>;

const iso = (v: string | number | undefined | null) => (v == null ? null : new Date(v).toISOString());

/**
 * Removes withdrawn people from an export (and from any older export, before it is analysed
 * again): a withdrawal reaches every copy that left the server.
 */
export function purge(ex: Export, withdrawn: { researchId: string }[]): Export {
  const gone = new Set(withdrawn.map((w) => w.researchId));
  const kept = ex.rows.filter((r) => !gone.has(r.researchId));
  if (kept.length === ex.rows.length) return ex;
  const removed = [...new Set(ex.rows.filter((r) => gone.has(r.researchId)).map((r) => r.researchId))];
  return { ...ex, rows: kept, purged: [...new Set([...(ex.purged ?? []), ...removed])] };
}

/**
 * Trims an older export to the newest one (#55): the newest export is what the server holds now,
 * so a report or a person missing from it (deleted, withdrawn, account gone) leaves the older
 * copy too. Only the newest complete export may be used as `latest`.
 */
export function trimTo(old: Export, latest: Export): Export {
  const now = new Set(latest.rows.map((r) => `${r.researchId}/${r.report.id}`));
  const kept = old.rows.filter((r) => now.has(`${r.researchId}/${r.report.id}`));
  if (kept.length === old.rows.length) return old;
  const people = new Set(kept.map((r) => r.researchId));
  const gone = [...new Set(old.rows.map((r) => r.researchId))].filter((id) => !people.has(id));
  const removedReports = old.rows.filter((r) => people.has(r.researchId)).length - kept.length;
  return { ...old, rows: kept, purged: [...new Set([...(old.purged ?? []), ...gone])], trimmed: (old.trimmed ?? 0) + removedReports };
}

/** A report without anything that ties it to the account (#55; the server already leaves it out). */
export function anonymous(report: Report): Report {
  const { owner: _owner, ...rest } = report;
  return rest as Report;
}

/** The rows of every table for one export. */
export function tablesOf(ex: Export, hash: string): Rows {
  const live = ex.rows.filter((r) => !r.report.deleted);
  const reports: Cell[][] = [];
  const weather: Cell[][] = [];
  const predictions: Cell[][] = [];
  for (const { researchId, report: r } of live) {
    const q = inputQuality(r);
    reports.push([ex.datasetId, r.id, researchId, iso(r.at), r.sensation, r.scaleVersion ?? 1, r.exposure ?? null, r.windFelt ?? null, r.sky ?? null, iso(r.openedAt), iso(r.notifiedAt), q.trainable, q.reason, r.thermalPreference ?? null, r.drinkPreference ?? null, r.preferenceVersion ?? null]);
    const s = r.snapshot;
    weather.push([
      ex.datasetId,
      r.id,
      s ? iso(observedAt(s.date, s.hour) + (s.minute ?? 0) * 60_000) : null,
      q.lagMin,
      q.status,
      q.flags.join(";"),
      s?.temp ?? null,
      s?.humidity ?? null,
      s?.wind ?? null,
      s?.solar ?? null,
      s?.sunTemp ?? null,
      s?.shadeTemp ?? null,
      s?.from.temp ?? null,
      s?.from.humidity ?? null,
      s?.from.wind ?? null,
      s?.from.solar ?? null,
      r.baseline?.value ?? null,
      s?.transform ?? null,
      iso(s?.retrievedAt),
    ]);
    const c = r.comfort;
    if (c)
      predictions.push([
        ex.datasetId,
        r.id,
        c.version ?? "comfort-1",
        c.learning ?? null,
        ...c.probs,
        c.mode,
        c.expected,
        c.state?.mu ?? null,
        c.state?.h ?? null,
        c.z ?? null,
        c.zInterval?.[0] ?? null,
        c.zInterval?.[1] ?? null,
        c.muInterval?.[0] ?? null,
        c.muInterval?.[1] ?? null,
        c.spread?.answer ?? null,
        c.spread?.param ?? null,
        c.n ?? null,
        iso(c.at || r.at),
      ]);
  }
  return {
    datasets: [[ex.datasetId, iso(ex.exportedAt), SCHEMA_VERSION, hash, live.length, new Set(live.map((r) => r.researchId)).size, ex.purged?.length ?? 0, ex.trimmed ?? 0]],
    sensation_reports: reports,
    weather_snapshots: weather,
    prediction_snapshots: predictions,
  };
}
