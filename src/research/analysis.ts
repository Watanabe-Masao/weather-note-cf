// The research analysis that runs inside the app (iPhone only, no computer): the consenting
// people's reports, read from the server into memory, turned into aggregates. Nothing here is
// stored on the device. Pure functions, so CI checks the same rules the screen shows.
//
// The rules against re-identification (research/data/README.md):
//   - no row-level data leaves; the screen shows aggregates only, never one person's estimates;
//   - an aggregate may be shared (sent out of the iPhone) only when MIN_PEOPLE or more people are
//     in it — cells with fewer are left out of the shared file.

import { ensembleFromReports, LEARNING_LABELS, type Learning, learningOf, trackRecord } from "../beta/comfort";
import { inputQuality, MAX_LAG_MIN } from "../beta/quality";
import type { Report } from "../beta/reports";

/** The smallest number of people an aggregate may describe when it is shared. */
export const MIN_PEOPLE = 5;

export interface Row {
  researchId: string;
  report: Report;
}

/** One aggregate: a value, and how many people and reports it is made of. */
export interface Cell {
  section: string;
  item: string;
  value: number | string | null;
  people: number;
  reports: number;
}

export interface Analysis {
  people: number;
  reports: number;
  from: string | null;
  to: string | null;
  cells: Cell[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const r3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);

/** People's reports, by research ID (deleted ones left out). */
export function byPerson(rows: Row[]): Map<string, Report[]> {
  const out = new Map<string, Report[]>();
  for (const { researchId, report } of rows) if (!report.deleted) out.set(researchId, [...(out.get(researchId) ?? []), report]);
  return out;
}

/** Counts of something per category: how many reports, and how many people have any. */
function counted(section: string, rows: { who: string; key: string }[]): Cell[] {
  const m = new Map<string, { reports: number; people: Set<string> }>();
  for (const { who, key } of rows) {
    const c = m.get(key) ?? { reports: 0, people: new Set() };
    c.reports++;
    c.people.add(who);
    m.set(key, c);
  }
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, c]) => ({ section, item: key, value: c.reports, people: c.people.size, reports: c.reports }));
}

/**
 * The aggregates. `fitted` gives each person's learning state (the slow part: one model fit per
 * person); the screen runs it a person at a time and passes the results in.
 */
export function analyse(rows: Row[], fitted: Map<string, Learning> = new Map()): Analysis {
  const people = byPerson(rows);
  const live = rows.filter((r) => !r.report.deleted);
  const all = live.length;
  const ats = live.map((r) => r.report.at).sort();
  const nPeople = people.size;
  const cells: Cell[] = [];

  // What the data is.
  cells.push(...counted("尺度の版", live.map((r) => ({ who: r.researchId, key: `版${r.report.scaleVersion ?? 1}` }))));
  cells.push(...counted("予測の版", live.map((r) => ({ who: r.researchId, key: r.report.comfort?.version ?? "（予測なし）" }))));

  // Inputs: quality, and the lag behind the observation (#54: is 120 min right?).
  const q = live.map((r) => ({ who: r.researchId, q: inputQuality(r.report) }));
  cells.push(...counted("気温の状態", q.map(({ who, q }) => ({ who, key: { fixed: "確定", observed: "速報", forecast: "予報", missing: "なし" }[q.status] }))));
  cells.push(...counted("学習に使うか", q.map(({ who, q }) => ({ who, key: q.reason ?? "使う" }))));
  const lagged = q.filter((x) => x.q.lagMin != null && x.q.status !== "forecast");
  const lags = lagged.map((x) => x.q.lagMin as number);
  const lagPeople = new Set(lagged.map((x) => x.who)).size;
  const over = lagged.filter((x) => (x.q.lagMin as number) > MAX_LAG_MIN);
  cells.push(
    { section: "観測の遅れ（分）", item: "中央値", value: median(lags), people: lagPeople, reports: lags.length },
    { section: "観測の遅れ（分）", item: "90%点", value: quantile(lags, 0.9), people: lagPeople, reports: lags.length },
    { section: "観測の遅れ（分）", item: `${MAX_LAG_MIN}分を超えた割合`, value: lags.length ? r3(over.length / lags.length) : null, people: lagPeople, reports: lags.length },
  );

  // How good the predictions made before each answer were (current scale only, MATH-08).
  const records = [...people.entries()].map(([who, list]) => ({ who, rec: trackRecord(list) })).filter((x) => x.rec.n > 0);
  const n = records.reduce((s, x) => s + x.rec.n, 0);
  const pooled = (k: "rps" | "refRps" | "logLoss" | "hit" | "bias" | "mae") => (n ? r3(records.reduce((s, x) => s + (x.rec[k] ?? 0) * x.rec.n, 0) / n) : null);
  const rps = pooled("rps");
  const ref = pooled("refRps");
  const scored = records.length;
  cells.push(
    { section: "予測の成績", item: "RPS（小さいほどよい）", value: rps, people: scored, reports: n },
    { section: "予測の成績", item: "比べる基準の RPS", value: ref, people: scored, reports: n },
    { section: "予測の成績", item: "スキル（0より上なら基準よりよい）", value: rps != null && ref ? r3(1 - rps / ref) : null, people: scored, reports: n },
    { section: "予測の成績", item: "対数損失", value: pooled("logLoss"), people: scored, reports: n },
    { section: "予測の成績", item: "最も確からしい段が当たった割合", value: pooled("hit"), people: scored, reports: n },
    { section: "予測の成績", item: "偏り（答え − 予測の平均）", value: pooled("bias"), people: scored, reports: n },
    { section: "予測の成績", item: "基準よりよかった人", value: records.filter((x) => (x.rec.skill ?? 0) > 0).length, people: scored, reports: n },
    { section: "予測の成績", item: "変化の目印が出ている人", value: records.filter((x) => x.rec.drifting).length, people: scored, reports: n },
  );

  // Calibration of the three sides, pooled (each bin counts the people with a prediction in it).
  const bins = records[0]?.rec.calibration.map((b) => ({ lo: b.lo, hi: b.hi })) ?? [];
  for (const [i, b] of bins.entries()) {
    const inBin = records.map((x) => x.rec.calibration[i]).filter((c) => c.n > 0);
    const m = inBin.reduce((s, c) => s + c.n, 0);
    const label = `${Math.round(b.lo * 100)}〜${Math.round(b.hi * 100)}%`;
    const predicted = m ? r3(inBin.reduce((s, c) => s + (c.predicted ?? 0) * c.n, 0) / m) : null;
    const observed = m ? r3(inBin.reduce((s, c) => s + (c.observed ?? 0) * c.n, 0) / m) : null;
    cells.push({ section: "較正（予測した確率 → 実際）", item: label, value: predicted == null ? null : `${predicted} → ${observed}`, people: inBin.length, reports: m });
  }

  // Learning states, by people (filled in as the fits finish).
  if (fitted.size) cells.push(...counted("学習の段階（人数）", [...fitted.entries()].map(([who, s]) => ({ who, key: LEARNING_LABELS[s] }))).map((c) => ({ ...c, value: c.people })));

  return { people: nPeople, reports: all, from: ats[0] ?? null, to: ats[ats.length - 1] ?? null, cells };
}

/** One person's learning state, as the app would show it to them now (the slow part). */
export function learningStateOf(reports: Report[]): Learning {
  return learningOf(reports, ensembleFromReports(reports)).state;
}

/** Whether a cell may leave the iPhone. */
export const shareable = (c: Cell) => c.people >= MIN_PEOPLE;

/**
 * The aggregates that may be shared, as CSV (BOM, CRLF): only cells of MIN_PEOPLE or more people,
 * and nothing at all while the whole group is smaller.
 */
export function sharedCsv(a: Analysis, madeAt: Date): string | null {
  if (a.people < MIN_PEOPLE) return null;
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = `# Weather Note 研究用の集計（${MIN_PEOPLE}人以上の集計だけ）・${madeAt.toISOString()}・${a.people}人・${a.reports}件`;
  const lines = a.cells.filter(shareable).map((c) => [c.section, c.item, c.value, c.people, c.reports].map(esc).join(","));
  return "﻿" + [head, "section,item,value,people,reports", ...lines].join("\r\n") + "\r\n";
}
