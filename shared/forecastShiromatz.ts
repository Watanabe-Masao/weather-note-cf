// 予報の履歴 (#250, R2): one month of one office from shiromatz/Japan-Meteorological-Agency-Weather-Forecast
// (CC BY-SA 4.0) — JMA's forecast JSON (https://www.jma.go.jp/bosai/forecast/data/forecast/{office}.json)
// flattened to CSV rows, a few times a day — read into the same issues and values as the telegrams
// (shared/forecastXml.ts), so the two can stand side by side and be compared.
//
// How the rows read (FH-04 / FH-05, the JSON beside the telegrams of 2026-11-17):
//  - A reportDatetime holds the 府県天気予報 (VPFD51) and, at 11時 and 17時, the 週間天気予報 (VPFW50).
//    Their rows are told apart by what they carry: a 週間 row has 天気 by code only (no words), its
//    code and 降水確率 in one row, or the 週間 temperatures (tempMin …); a 府県天気予報 row has 天気 in
//    words, the 6-hour 降水確率 alone, or one 気温.
//  - 府県天気予報: 天気 (the sentence, as the telegram's DetailForecast) for the rest of today, then
//    days; 降水確率 for 6 hours; 気温 at 09時 is 日中の最高気温 (9 hours), at 00時 of the day issued
//    the day's 最高気温, at 00時 of a later day 朝の最低気温 (9 hours) — as the telegram's TimeDefines.
//  - 週間: a day each; an empty value is JMA's 「値なし」 (the first day's 降水確率 and 信頼度, …).
//  - The columns were renamed in the record (weather → weathers, pop → pops, …): both are read.
// Values keep JMA's type names as the telegram parser does, so a value read here and the same value
// read from a telegram compare as one. 出典：気象庁の予報（shiromatz の記録、CC BY-SA 4.0）。

import type { ForecastEntry, ForecastIssue } from "./forecastXml";

export const SHIROMATZ_PARSER = 1;
export const SHIROMATZ_SOURCE = "shiromatz";
export const SHIROMATZ_REPO = "shiromatz/Japan-Meteorological-Agency-Weather-Forecast";

/** The later months' column names, as the earlier months name them. */
const PLURAL: Record<string, string> = {
  weatherCodes: "weatherCode",
  weathers: "weather",
  winds: "wind",
  waves: "wave",
  pops: "pop",
  temps: "temp",
  tempsMin: "tempMin",
  tempsMax: "tempMax",
  tempsMinUpper: "tempMinUpper",
  tempsMaxUpper: "tempMaxUpper",
  tempsMinLower: "tempMinLower",
  tempsMaxLower: "tempMaxLower",
  reliabilities: "reliability",
};

/** A CSV text into rows of named fields (quoted or not, as the record has both). */
export function readCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  // The plural names of later months are read as the singular of earlier ones.
  const names = (head ?? []).map((h) => PLURAL[h] ?? h);
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(names.map((n, i) => [n, r[i] ?? ""])));
}

const H = 3_600_000;
const later = (iso: string, ms: number) => new Date(Date.parse(iso) + ms + 9 * H).toISOString().slice(0, 19) + "+09:00";
const nextMidnight = (iso: string) => `${later(iso.slice(0, 10) + "T00:00:00+09:00", 24 * H)}`;
const DAY = ["今日", "明日", "明後日"];
const dayIndex = (issued: string, at: string) => Math.round((Date.parse(at.slice(0, 10) + "T00:00:00+09:00") - Date.parse(issued.slice(0, 10) + "T00:00:00+09:00")) / (24 * H));

type Row = Record<string, string>;
const isWeekly = (r: Row) =>
  ["tempMin", "tempMax", "tempMinUpper", "tempMaxUpper", "tempMinLower", "tempMaxLower", "reliability"].some((k) => r[k]) ||
  (r.weatherCode !== "" && r.weatherCode != null && !r.weather) ||
  // The first day of the 週間 temperatures: a station row with nothing (値なし).
  (/^\d{5}$/.test(r.areaCode) && !r.temp);

function entry(r: Row, x: Partial<ForecastEntry> & Pick<ForecastEntry, "element" | "validFrom" | "validTo" | "period" | "jmaType">): ForecastEntry {
  return {
    place: r.areaCode,
    placeName: r.areaName,
    placeType: /^\d{5}$/.test(r.areaCode) ? "station" : "area",
    label: null,
    value: null,
    unit: null,
    lower: null,
    upper: null,
    condition: null,
    ...x,
  };
}

/** A value or JMA's 「値なし」 for an empty field. */
const valued = (v: string | undefined) => (v ? { value: v, condition: null } : { value: null, condition: "値なし" });
const num = (v: string | undefined) => (v ? Number(v) : null);

function shortEntries(r: Row, issued: string, out: ForecastEntry[]) {
  const at = r.timeDefine;
  if (r.weather || r.weatherCode) {
    // The first is the rest of the day issued (今日 / 今夜), then whole days.
    const today = dayIndex(issued, at) === 0;
    const to = nextMidnight(at);
    const period = today ? `PT${Math.round((Date.parse(to) - Date.parse(at)) / H)}H` : "P1D";
    const label = today && Number(issued.slice(11, 13)) >= 17 ? "今夜" : (DAY[dayIndex(issued, at)] ?? null);
    const base = { validFrom: at, validTo: to, period, label };
    if (r.weather) out.push(entry(r, { ...base, element: "weather_text", jmaType: "天気の文", value: r.weather }));
    if (r.weatherCode) out.push(entry(r, { ...base, element: "weather_code", jmaType: "天気予報用テロップ番号", value: r.weatherCode }));
  }
  if (r.pop !== undefined && r.pop !== "" && !r.weatherCode)
    out.push(entry(r, { element: "pop", jmaType: "６時間降水確率", validFrom: at, validTo: later(at, 6 * H), period: "PT6H", value: r.pop, unit: "%" }));
  if (r.temp) {
    const d = dayIndex(issued, at);
    const hour = at.slice(11, 13);
    const word = DAY[d] ?? null;
    const t =
      hour === "09"
        ? { element: "temp_max" as const, jmaType: "日中の最高気温", validTo: later(at, 9 * H), period: "PT9H", label: word && `${word}日中` }
        : d === 0
          ? { element: "temp_max" as const, jmaType: "最高気温", validTo: later(at, 24 * H), period: "PT24H", label: word }
          : { element: "temp_min" as const, jmaType: "朝の最低気温", validTo: later(at, 9 * H), period: "PT9H", label: word && `${word}朝` };
    out.push(entry(r, { ...t, validFrom: at, value: r.temp, unit: "℃" }));
  }
}

function weeklyEntries(r: Row, out: ForecastEntry[]) {
  const at = r.timeDefine;
  const day = { validFrom: at, validTo: later(at, 24 * H), period: "P1D" };
  if (/^\d{5}$/.test(r.areaCode)) {
    out.push(entry(r, { ...day, element: "temp_min", jmaType: "最低気温", unit: "℃", ...valued(r.tempMin), lower: num(r.tempMinLower), upper: num(r.tempMinUpper) }));
    out.push(entry(r, { ...day, element: "temp_max", jmaType: "最高気温", unit: "℃", ...valued(r.tempMax), lower: num(r.tempMaxLower), upper: num(r.tempMaxUpper) }));
    return;
  }
  out.push(entry(r, { ...day, element: "weather_code", jmaType: "天気予報用テロップ番号", ...valued(r.weatherCode) }));
  out.push(entry(r, { ...day, element: "pop", jmaType: "日降水確率", unit: "%", ...valued(r.pop) }));
  out.push(entry(r, { ...day, element: "reliability", jmaType: "信頼度階級", ...valued(r.reliability) }));
}

/**
 * The record has an issue again each time it read the JSON while that issue was the latest (the 17時
 * 週間 is read again at 21時 and at 05時): the same values once. Two that disagree are said, the first kept.
 */
function once(entries: ForecastEntry[]): { entries: ForecastEntry[]; problems: string[] } {
  const seen = new Map<string, ForecastEntry>();
  const problems = new Set<string>();
  for (const e of entries) {
    const k = entryKey(e);
    const before = seen.get(k);
    if (!before) seen.set(k, e);
    else if (entrySays(before) !== entrySays(e)) problems.add(`同じ発表で値が違う：${k}`);
  }
  return { entries: [...seen.values()], problems: [...problems] };
}

/** One month's CSV of one office into its issues: a 府県天気予報 and, when it has one, a 週間天気予報 per reportDatetime. */
export function parseShiromatzCsv(text: string, office: string): ForecastIssue[] {
  const groups = new Map<string, { short: ForecastEntry[]; weekly: ForecastEntry[] }>();
  for (const r of readCsv(text)) {
    const issued = r.reportDatetime;
    if (!issued || !r.timeDefine || !r.areaCode) continue;
    const g = groups.get(issued) ?? { short: [], weekly: [] };
    groups.set(issued, g);
    if (isWeekly(r)) weeklyEntries(r, g.weekly);
    else shortEntries(r, issued, g.short);
  }
  const issues: ForecastIssue[] = [];
  for (const [issuedAt, g] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const base = { office, title: null, issuedAt, targetAt: null, infoType: "発表", headline: null };
    if (g.short.length) issues.push({ ...base, kind: "VPFD51", ...once(g.short) });
    if (g.weekly.length) issues.push({ ...base, kind: "VPFW50", ...once(g.weekly) });
  }
  return issues;
}

/** The id an issue read from the record goes by (one per office, kind and time issued). */
export const shiromatzIssueId = (t: Pick<ForecastIssue, "office" | "kind" | "issuedAt">) => `${SHIROMATZ_SOURCE}:${t.office}:${t.kind}:${t.issuedAt}`;

/** Where an entry stands: the place, the item, JMA's type and the time it speaks of. */
function entryKey(e: ForecastEntry) {
  return [e.place, e.element, e.jmaType, e.validFrom, e.validTo, e.period].join("|");
}
/** What an entry says: its value and range, and whether JMA gave none (other notes, such as 雨 or a label, are wording). */
function entrySays(e: ForecastEntry) {
  return JSON.stringify([e.value, e.lower, e.upper, e.condition === "値なし"]);
}

export interface Comparison {
  same: number;
  /** The record's values that the telegram has otherwise, as "key: telegram → record". */
  differ: string[];
  /** The record's values the telegram does not have at all. */
  missing: string[];
}

/**
 * The record against the telegram of the same issue (R5-2, R2-6): every value the record has is looked
 * for in the telegram. The telegram has more (the summary 天気, 3-hour values …); those are not counted.
 */
export function compareWithTelegram(record: ForecastEntry[], telegram: ForecastEntry[]): Comparison {
  const byKey = new Map(telegram.map((e) => [entryKey(e), e]));
  const out: Comparison = { same: 0, differ: [], missing: [] };
  for (const e of record) {
    const t = byKey.get(entryKey(e));
    if (!t) out.missing.push(entryKey(e));
    else if (entrySays(t) === entrySays(e)) out.same++;
    else out.differ.push(`${entryKey(e)}: ${entrySays(t)} → ${entrySays(e)}`);
  }
  return out;
}
