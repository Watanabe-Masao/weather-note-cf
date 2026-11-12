// The research analysis that runs inside the app (iPhone only, no computer): the consenting
// people's reports, read from the server into memory, turned into aggregates. Nothing here is
// stored on the device. Pure functions, so CI checks the same rules the screen shows.
//
// The rules against re-identification (research/data/README.md):
//   - no row-level data leaves; the screen shows aggregates only, never one person's estimates;
//   - an aggregate may be shared (sent out of the iPhone) only when MIN_PEOPLE or more people are
//     in it — cells with fewer are left out of the shared file.

import { ensembleFromReports, LEARNING_LABELS, type Learning, observationsOf, predictComfort, referenceProbs, rps as rpsOf, trackRecord } from "../beta/comfort";
import { fitPreference, type PrefObs, predictPreference, PREF_RULES, prefRps, preferenceObservations, type PreferenceKind } from "../beta/preferenceModel";
import { inputQuality, MAX_LAG_MIN } from "../beta/quality";
import { DRINK_PREFERENCES, type Report, SCALE_VERSION, THERMAL_PREFERENCES } from "../beta/reports";

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
 * Each person's learning state as of their latest report: saved with the report's prediction, so
 * nothing is refitted here (refitting took ~0.7 s a person; #60).
 */
export function latestLearning(people: Map<string, Report[]>): Map<string, Learning> {
  const out = new Map<string, Learning>();
  for (const [who, list] of people) {
    const last = [...list].filter((r) => r.comfort?.learning).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    if (last) out.set(who, last.comfort!.learning!);
  }
  return out;
}

/** The aggregates (fast: no model is fitted). */
export function analyse(rows: Row[]): Analysis {
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
  // Two averages side by side (#62): by report (people who report a lot weigh more) and by
  // person (each person counts once, whatever they reported).
  const pooled = (k: "rps" | "refRps" | "logLoss" | "hit" | "bias" | "mae") => (n ? r3(records.reduce((s, x) => s + (x.rec[k] ?? 0) * x.rec.n, 0) / n) : null);
  const perPerson = (k: "rps" | "refRps" | "logLoss" | "hit" | "bias" | "mae" | "skill") => {
    const vs = records.map((x) => x.rec[k]).filter((v): v is number => v != null);
    return vs.length ? r3(vs.reduce((a, b) => a + b, 0) / vs.length) : null;
  };
  const rps = pooled("rps");
  const ref = pooled("refRps");
  const scored = records.length;
  const both = (item: string, byReport: number | null, byPerson: number | null): Cell[] => [
    { section: "予測の成績", item: `${item}・件数で平均`, value: byReport, people: scored, reports: n },
    { section: "予測の成績", item: `${item}・人ごとに平均`, value: byPerson, people: scored, reports: n },
  ];
  cells.push(
    ...both("RPS（小さいほどよい）", rps, perPerson("rps")),
    ...both("比べる基準の RPS", ref, perPerson("refRps")),
    ...both("スキル（0より上なら基準よりよい）", rps != null && ref ? r3(1 - rps / ref) : null, perPerson("skill")),
    ...both("対数損失", pooled("logLoss"), perPerson("logLoss")),
    ...both("最も確からしい段が当たった割合", pooled("hit"), perPerson("hit")),
    ...both("偏り（答え − 予測の平均）", pooled("bias"), perPerson("bias")),
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
    cells.push({ section: "較正（予測した確率 → 実際・件数で平均）", item: label, value: predicted == null ? null : `${predicted} → ${observed}`, people: inBin.length, reports: m });
  }

  // The two optional questions (#63 P2): answers, how often skipped, and by the side of the feeling.
  const asked = live.filter((r) => r.report.preferenceVersion != null);
  if (asked.length) {
    const label = (list: readonly { id: string; label: string }[], id: string | undefined) => (id ? (list.find((x) => x.id === id)?.label ?? id) : "（未回答）");
    cells.push(...counted("どう感じたいか", asked.map((r) => ({ who: r.researchId, key: label(THERMAL_PREFERENCES, r.report.thermalPreference) }))));
    cells.push(...counted("飲み物の温度", asked.map((r) => ({ who: r.researchId, key: label(DRINK_PREFERENCES, r.report.drinkPreference) }))));
    const side = (y: number) => (y < 0 ? "寒い側" : y === 0 ? "ちょうどよい" : "暑い側");
    cells.push(
      ...counted(
        "感じ方 × どう感じたいか（答えた記録）",
        asked.filter((r) => r.report.thermalPreference).map((r) => ({ who: r.researchId, key: `${side(r.report.sensation)}・${label(THERMAL_PREFERENCES, r.report.thermalPreference)}` })),
      ),
      ...counted(
        "感じ方 × 飲み物の温度（答えた記録）",
        asked.filter((r) => r.report.drinkPreference).map((r) => ({ who: r.researchId, key: `${side(r.report.sensation)}・${label(DRINK_PREFERENCES, r.report.drinkPreference)}` })),
      ),
    );
  }

  // Learning states, by people, as of each person's latest report.
  const learning = latestLearning(people);
  cells.push(...counted("学習の段階（最後の記録の時点・人数）", [...learning.entries()].map(([who, s]) => ({ who, key: LEARNING_LABELS[s] }))).map((c) => ({ ...c, value: c.people, reports: c.people })));


  // Predictions by model version (as made at sending; different periods, so only a first look, #54).
  const byVersion = new Map<string, { who: string; rps: number; ref: number }[]>();
  for (const [who, list] of people) {
    const same = list.filter((r) => (r.scaleVersion ?? 1) === SCALE_VERSION && r.comfort).sort((a, b) => (a.at < b.at ? -1 : 1));
    same.forEach((r, i) => {
      const v = r.comfort!.version ?? "comfort-1";
      const earlier = same.slice(0, i).map((x) => x.sensation as number);
      byVersion.set(v, [...(byVersion.get(v) ?? []), { who, rps: rpsOf(r.comfort!.probs, r.sensation), ref: rpsOf(referenceProbs(earlier), r.sensation) }]);
    });
  }
  for (const [v, list] of [...byVersion.entries()].sort()) {
    const m = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const r = m(list.map((x) => x.rps));
    const ref = m(list.map((x) => x.ref));
    cells.push({ section: "予測の版ごとの成績（送信時の予測。期間が違うので参考）", item: `${v}・RPS / 基準 / スキル`, value: `${r3(r)} / ${r3(ref)} / ${r3(1 - r / ref)}`, people: new Set(list.map((x) => x.who)).size, reports: list.length });
  }

  // 7-step calibration as six cumulative probabilities P(Y ≤ k) (#53: the end steps have few
  // answers, the cumulative form uses them all and matches the RPS).
  const cum: { who: string; p: number; hit: number }[] = [];
  for (const [who, list] of people)
    for (const r of list)
      if (r.comfort && (r.scaleVersion ?? 1) === SCALE_VERSION) {
        // Saved probabilities are rounded: normalised, so the cumulative ones end at 1.
        const total = r.comfort.probs.reduce((a, b) => a + b, 0) || 1;
        let c = 0;
        for (let k = 0; k < 6; k++) {
          c = Math.min(1, c + r.comfort.probs[k] / total);
          cum.push({ who, p: c, hit: r.sensation <= k - 3 ? 1 : 0 });
        }
      }
  for (const [lo, hi] of [[0, 0.1], [0.1, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.0001]] as const) {
    const inBin = cum.filter((x) => x.p >= lo && x.p < hi);
    if (!inBin.length) continue;
    const m = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    cells.push({ section: "7段の較正（P(答え ≤ k) の予測 → 実際・件数で平均）", item: `${Math.round(lo * 100)}〜${Math.round(Math.min(hi, 1) * 100)}%`, value: `${r3(m(inBin.map((x) => x.p)))} → ${r3(m(inBin.map((x) => x.hit)))}`, people: new Set(inBin.map((x) => x.who)).size, reports: inBin.length });
  }

  // The preference models, judged in time order (#68): each answer predicted from the earlier ones
  // only, once there are enough (PREF_RULES.minFitEff). Before (weather only) and with the feeling
  // are reported apart.
  for (const kind of ["thermal", "drink"] as PreferenceKind[]) {
    const ev = preferenceTimeSeries([...people.entries()], kind);
    if (!ev.n) continue;
    const name = kind === "thermal" ? "どう感じたいか" : "飲み物の温度";
    cells.push(
      { section: `選好モデルの時系列評価：${name}（RPS、小さいほどよい）`, item: "基準（それまでの答えの割合）", value: r3(ev.ref), people: ev.people, reports: ev.n },
      { section: `選好モデルの時系列評価：${name}（RPS、小さいほどよい）`, item: "回答前の予測（天気だけ）", value: r3(ev.before), people: ev.people, reports: ev.n },
      { section: `選好モデルの時系列評価：${name}（RPS、小さいほどよい）`, item: "温冷感も使う予測（答えた後。回答前の成績ではない）", value: r3(ev.withFeeling), people: ev.people, reports: ev.n },
    );
  }

  return { people: nPeople, reports: all, from: ats[0] ?? null, to: ats[ats.length - 1] ?? null, cells };
}

/** Whether a cell may leave the iPhone. */
export const shareable = (c: Cell) => c.people >= MIN_PEOPLE;

/**
 * The cells that may leave the iPhone (review 2026-11-12). A cell under MIN_PEOPLE stays, and so
 * does what would give it back by subtraction: when a section hides exactly one cell, the next
 * smallest is hidden too (the totals minus the rest would show it), and a cross table goes out
 * only whole (its margins are shared elsewhere). Sharing again later can still show a newcomer by
 * difference: share rarely, and only what is needed.
 */
export function sharedCells(a: Analysis): Set<Cell> {
  const out = new Set<Cell>();
  for (const section of new Set(a.cells.map((c) => c.section))) {
    const cells = a.cells.filter((c) => c.section === section);
    const hidden = cells.filter((c) => !shareable(c));
    if (section.includes("×")) {
      if (!hidden.length) cells.forEach((c) => out.add(c));
      continue;
    }
    const shown = cells.filter(shareable);
    if (hidden.length === 1 && shown.length) {
      const smallest = [...shown].sort((x, y) => x.people - y.people || x.reports - y.reports)[0];
      shown.splice(shown.indexOf(smallest), 1);
    }
    shown.forEach((c) => out.add(c));
  }
  return out;
}

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
  const ok = sharedCells(a);
  const lines = a.cells.filter((c) => ok.has(c)).map((c) => [c.section, c.item, c.value, c.people, c.reports].map(esc).join(","));
  return "﻿" + [head, "section,item,value,people,reports", ...lines].join("\r\n") + "\r\n";
}

/** Each answer of one question predicted from the same person's earlier answers only (no leak). */
export function preferenceTimeSeries(people: [string, Report[]][], kind: PreferenceKind) {
  let n = 0;
  let ref = 0;
  let before = 0;
  let withFeeling = 0;
  const who = new Set<string>();
  for (const [id, list] of people) {
    const sorted = [...list].sort((a, b) => (a.at < b.at ? -1 : 1));
    const all = preferenceObservations(sorted, kind);
    for (const o of all) {
      // The earlier answers as they were then: weights from the reports before this one only
      // (a later report in a row would change them; review 2026-11-12).
      const prev: PrefObs[] = preferenceObservations(
        sorted.filter((r) => Date.parse(r.at) < o.t),
        kind,
      );
      if (prev.reduce((s, x) => s + x.w, 0) < PREF_RULES.minFitEff || new Set(prev.map((x) => x.k)).size < 2) continue;
      const freq = [-1, 0, 1].map((k) => (prev.filter((x) => x.k === k).length + 1) / (prev.length + 3)) as [number, number, number];
      const fb = fitPreference(prev, { withFeeling: false, halfLifeDays: null, now: o.t });
      const fy = fitPreference(prev, { withFeeling: true, halfLifeDays: null, now: o.t });
      ref += prefRps(freq, o.k);
      before += prefRps(predictPreference(fb, o, 60).probs, o.k);
      withFeeling += prefRps(predictPreference(fy, o, 60).probs, o.k);
      n++;
      who.add(id);
    }
  }
  return { n, people: who.size, ref: n ? ref / n : null, before: n ? before / n : null, withFeeling: n ? withFeeling / n : null };
}

/**
 * comfort-3 against comfort-4 on the same reports (#54): each of a person's latest `lastN`
 * reports predicted from their earlier reports only, fitted both ways (comfort-3: every report
 * the same weight; comfort-4: reports in a row weigh less). Slow (two full fits per report), so
 * the screen runs it a person at a time on request.
 */
export function compareSettings(list: Report[], lastN = 10): { n: number; rps3: number; rps4: number; ref: number } {
  const live = list.filter((r) => !r.deleted && (r.scaleVersion ?? 1) === SCALE_VERSION).sort((a, b) => (a.at < b.at ? -1 : 1));
  let n = 0;
  let s3 = 0;
  let s4 = 0;
  let sr = 0;
  for (let i = Math.max(3, live.length - lastN); i < live.length; i++) {
    const prev = live.slice(0, i);
    const r = live[i];
    const out: number[] = [];
    for (const weighted of [false, true]) {
      const ens = ensembleFromReports(prev, weighted);
      const x = observationsOf([r], ens.alpha, false)[0];
      if (!x) break;
      out.push(rpsOf(predictComfort(ens, x, Date.parse(r.at)).probs, r.sensation));
    }
    if (out.length < 2) continue;
    s3 += out[0];
    s4 += out[1];
    sr += rpsOf(referenceProbs(prev.map((x) => x.sensation as number)), r.sensation);
    n++;
  }
  return { n, rps3: n ? s3 / n : NaN, rps4: n ? s4 / n : NaN, ref: n ? sr / n : NaN };
}
