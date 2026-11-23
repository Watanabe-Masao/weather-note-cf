// 予報の履歴 (#250, R6)：/api/forecast-history の行（forecast_issues / forecast_entries / forecast_fetch_log のまま）
// から、「この日の予報の移り変わり」に出すものを決める。見本（research/forecast-history/sample/model.ts、
// 2026-11-17 に実機で決めた形）から移したもの。決まりは要件 R5-1・R6-1〜13。
//  - 発表の回：定時（府県 5・11・17時、週間 11・17時）と、その日を予報した定時でない発表。7日前〜当日。
//  - 回の状態：発表あり／取り消し／記録なし（未取得）／取れなかった（取得失敗）／届いていない。
//  - 1つの時刻には、数字を持つ予報を1つだけ（両方あれば府県天気予報、R6-10）。
//  - 前の同じ種類の発表から変わった項目（当日の発表は比べない）。

import type { HistoryEntry, HistoryFetchLog, HistoryIssue } from "./forecastHistory";
import { weatherCodeLabel } from "./weatherCode";

export type IssueRow = HistoryIssue;
export type EntryRow = HistoryEntry;
export type FetchLogRow = HistoryFetchLog;
/** 1日分の行（/api/forecast-history の中身）。 */
export interface HistoryRows {
  issues: IssueRow[];
  entries: EntryRow[];
  fetchLog: FetchLogRow[];
}

export type Kind = "VPFW50" | "VPFD51";
export const KIND_NAME: Record<Kind, string> = {
  VPFW50: "週間天気予報",
  VPFD51: "府県天気予報",
};
export const KIND_SHORT: Record<Kind, string> = {
  VPFW50: "週間",
  VPFD51: "府県",
};

/** 自前の電文が正本になった日（R1）。これより前の空きは shiromatz の記録にない＝未取得（R2-10）。 */
export const OWN_FROM = "2026-11-10";

/**
 * 天気の名前は shared/weatherCode.ts の weatherCodeLabel（気象庁の表、画面用の書き方）。表にない番号は推測せず「番号 N」と出す。
 */
/** WeatherIcon（skyOf）は漢字の 晴・曇・雨 で読むので、名前をその形にして渡す。 */
export const skyText = (name: string | null) =>
  name ? name.replace(/くもり/g, "曇").replace(/晴れ/g, "晴") : null;

const H = 3_600_000;
export const jstDate = (iso: string) =>
  new Date(Date.parse(iso) + 9 * H).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 24 * H)
    .toISOString()
    .slice(0, 10);
const dayDiff = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / (24 * H),
  );
export const hourOf = (iso: string) => Number(iso.slice(11, 13));
const WD = ["日", "月", "火", "水", "木", "金", "土"];
export const weekday = (date: string) =>
  WD[new Date(`${date}T00:00:00Z`).getUTCDay()];
export const md = (date: string) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
export const issueLabel = (iso: string) =>
  `${md(jstDate(iso))} ${hourOf(iso)}時`;
export const leadLabel = (n: number) =>
  n === 0 ? "当日" : n === 1 ? "前日" : `${n}日前`;

/** 1つの値の状態：値／気象庁が値を出していない（値なし）／発表にその項目がない（項目なし）。 */
export type V =
  | {
      s: "value";
      v: number | string;
      lower?: number | null;
      upper?: number | null;
      entry: EntryRow;
    }
  | { s: "none"; entry: EntryRow } // 値なし（項目はあり、値がない）
  | { s: "absent" }; // 項目なし（この発表にない）

export interface DayValues {
  weather:
    | (V & {
        name?: string | null;
        sentence?: string | null;
        partial?: string | null;
        /** 府県：3時間ごとの天気（0・3・…・21時から、「３時間内卓越天気」）。自前の電文だけにあり、外部の記録にはない（null）。 */
        wx3?: (string | null)[] | null;
      })
    | V;
  /** 府県：3時間ごとの天気（0・3・…・21時から、「３時間内卓越天気」）。自前の電文だけにあり、外部の記録にはない（null）。 */
  wx3?: (string | null)[] | null;
  /** 週間：日降水確率。 */
  popDay: V | null;
  /** 府県：6時間降水確率（00・06・12・18時から）。発表より前の区切りは null（対象期間外）。 */
  pop6: (V | null)[] | null;
  max: V;
  min: V;
  reliability: V | null;
}

export type SlotState = "ok" | "cancelled" | "missing" | "failed" | "notIssued";
export interface Slot {
  key: string;
  kind: Kind;
  at: string; // 発表時刻
  regular: boolean; // 定時（5・11・17時）
  lead: number; // 何日前の発表か
  state: SlotState;
  shown: IssueRow | null; // choosePreferred が選んだ1本
  copies: IssueRow[]; // 同じ発表のすべて（訂正前・取り消し・外部の記録）
  values: DayValues | null;
  /** 前の同じ種類の発表から変わった項目 */
  changed: Set<string>;
  failures: FetchLogRow[];
}

export const STATE_TEXT: Record<SlotState, string> = {
  ok: "発表あり",
  cancelled: "取り消し",
  missing: "記録なし",
  failed: "取れなかった",
  notIssued: "届いていない",
};
export const STATE_NOTE: Record<SlotState, string> = {
  ok: "",
  cancelled: "気象庁がこの発表を取り消した（取消の電文がある）",
  missing: "この回の取得の記録も発表もない（未取得）",
  failed: "この時間帯の取得に失敗が残り、後の取得でも補えていない（取得失敗）",
  notIssued:
    "取得は成功しているのに、この回の発表がない：気象庁から出ていない（R5-3 の「届かない」と同じ扱い）",
};

export class ForecastHistory {
  readonly byIssue = new Map<string, EntryRow[]>();
  readonly copies = new Map<string, IssueRow[]>(); // kind|issued_at
  constructor(readonly sc: HistoryRows) {
    for (const e of sc.entries) {
      const list = this.byIssue.get(e.issue_id) ?? [];
      list.push(e);
      this.byIssue.set(e.issue_id, list);
    }
    for (const i of sc.issues) {
      const k = `${i.kind}|${i.issued_at}`;
      this.copies.set(k, [...(this.copies.get(k) ?? []), i]);
    }
  }

  /** 対象日 `day` の値を、1つの発表から読む。 */
  valuesFor(issue: IssueRow, day: string): DayValues | null {
    // 3時間ごとの気温（temp）は1日の値ではない（tempPoints が読む）：24時の点が次の日の 0時に入るので、それだけで
    // 「この日を予報した」とはしない。
    const es = (this.byIssue.get(issue.issue_id) ?? []).filter(
      (e) => e.element !== "temp" && jstDate(e.valid_from) === day,
    );
    if (!es.length) return null;
    const pick = (el: string, jma?: string): V => {
      const e = es.find(
        (x) => x.element === el && (!jma || x.jma_type === jma),
      );
      if (!e) return { s: "absent" };
      if (e.value == null) return { s: "none", entry: e };
      const n = Number(e.value);
      return {
        s: "value",
        v:
          Number.isFinite(n) && el !== "reliability" && el !== "weather_code"
            ? n
            : e.value,
        lower: e.lower,
        upper: e.upper,
        entry: e,
      };
    };
    const code = pick("weather_code");
    const sentence =
      es.find((x) => x.element === "weather_text")?.value ?? null;
    const codeEntry = code.s !== "absent" ? code.entry : null;
    const partial =
      codeEntry && codeEntry.period !== "P1D"
        ? `${hourOf(codeEntry.valid_from)}時から`
        : null;
    const weather =
      code.s === "value"
        ? {
            ...code,
            name: weatherCodeLabel(String(code.v)) ?? `番号 ${code.v}`,
            sentence,
            partial,
          }
        : code;
    if (issue.kind === "VPFW50")
      return {
        weather,
        popDay: pick("pop", "日降水確率"),
        pop6: null,
        max: pick("temp_max", "最高気温"),
        min: pick("temp_min", "最低気温"),
        reliability: pick("reliability"),
      };
    const pop6 = [0, 6, 12, 18].map((h) => {
      const e = es.find(
        (x) => x.element === "pop" && hourOf(x.valid_from) === h,
      );
      // 発表の時刻より前に始まる区切り（過ぎた・途中まで過ぎた時間帯）で値が無いのは、対象期間外（null）。
      // 気象庁はその区切りを出さない（11時の発表は 12時からの区切りから）。
      if (!e)
        return Date.parse(
          `${day}T${String(h).padStart(2, "0")}:00:00+09:00`,
        ) < Date.parse(issue.issued_at)
          ? null
          : ({ s: "absent" } as V);
      return e.value == null
        ? ({ s: "none", entry: e } as V)
        : ({ s: "value", v: Number(e.value), entry: e } as V);
    });
    const w3 = es.filter((x) => x.element === "weather_3h");
    const wx3 = w3.length
      ? [0, 3, 6, 9, 12, 15, 18, 21].map(
          (h) => w3.find((x) => hourOf(x.valid_from) === h)?.value ?? null,
        )
      : null;
    return {
      weather,
      wx3,
      popDay: null,
      pop6,
      max: pick("temp_max", "日中の最高気温"),
      min: pick("temp_min", "朝の最低気温"),
      reliability: null,
    };
  }

  /** 定時の発表の回（その日を予報しうるもの）。高知の VPFD51 は 5・11・17時、VPFW50 は 11・17時（R5-3）。 */
  private expected(day: string): { kind: Kind; at: string }[] {
    const at = (d: string, h: number) =>
      `${d}T${String(h).padStart(2, "0")}:00:00+09:00`;
    const out: { kind: Kind; at: string }[] = [];
    for (let n = 7; n >= 1; n--)
      for (const h of [11, 17])
        out.push({ kind: "VPFW50", at: at(addDays(day, -n), h) });
    for (const h of [11, 17])
      out.push({ kind: "VPFD51", at: at(addDays(day, -2), h) });
    for (const n of [1, 0])
      for (const h of [5, 11, 17])
        out.push({ kind: "VPFD51", at: at(addDays(day, -n), h) });
    return out;
  }

  private stateOfMissing(at: string): {
    state: SlotState;
    failures: FetchLogRow[];
  } {
    if (jstDate(at) < OWN_FROM) return { state: "missing", failures: [] };
    const t = Date.parse(at);
    const logs = this.sc.fetchLog.filter(
      (l) =>
        Date.parse(l.at) >= t - 30 * 60_000 &&
        Date.parse(l.at) <= t + 60 * 60_000,
    );
    const failures = logs.filter((l) => !l.ok);
    if (failures.length) return { state: "failed", failures };
    if (logs.length) return { state: "notIssued", failures: [] };
    return { state: "missing", failures: [] };
  }

  /**
   * 対象日 `day` の移り変わり：発表の回を時刻の順に。今（`now`）より先の回は出さない。`now` を渡さないと
   * 最後に記録のある発表までになり、それより後の記録の無い回が並ばない（画面では必ず今を渡す）。
   */
  slots(day: string, now?: string): Slot[] {
    const last =
      this.sc.issues
        .map((i) => i.issued_at)
        .sort()
        .at(-1) ?? "";
    const until = now ?? last;
    const keys = new Map<
      string,
      { kind: Kind; at: string; regular: boolean }
    >();
    for (const x of this.expected(day))
      if (x.at <= until) keys.set(`${x.kind}|${x.at}`, { ...x, regular: true });
    // 定時でない発表（臨時の発表や、記録の取り方による回）も、その日を予報していれば入れる。
    for (const i of this.sc.issues) {
      const k = `${i.kind}|${i.issued_at}`;
      if (keys.has(k) || (i.kind !== "VPFD51" && i.kind !== "VPFW50")) continue;
      // 今より先の発表は、定時でなくても出さない（定時の回と同じ決まり）。
      if (i.issued_at > until) continue;
      if (jstDate(i.issued_at) > day || dayDiff(day, jstDate(i.issued_at)) > 7)
        continue;
      if (this.valuesFor(i, day))
        keys.set(k, { kind: i.kind as Kind, at: i.issued_at, regular: false });
    }
    const out: Slot[] = [];
    for (const [key, x] of [...keys].sort(([, a], [, b]) =>
      a.at === b.at ? (a.kind === "VPFW50" ? -1 : 1) : a.at < b.at ? -1 : 1,
    )) {
      const copies = this.copies.get(key) ?? [];
      const shown = copies.find((c) => c.preferred === 1) ?? null;
      let state: SlotState;
      let failures: FetchLogRow[] = [];
      if (copies.some((c) => c.info_type === "取消")) state = "cancelled";
      else if (shown) state = "ok";
      else ({ state, failures } = this.stateOfMissing(x.at));
      const values = shown ? this.valuesFor(shown, day) : null;
      // 発表はあるのにこの日を言っていない（7日より先など）＝対象期間外：回に入れない（R5-1）。
      if (state === "ok" && !values) continue;
      out.push({
        key,
        kind: x.kind,
        at: x.at,
        regular: x.regular,
        lead: dayDiff(day, jstDate(x.at)),
        state,
        shown,
        copies,
        values,
        changed: new Set(),
        failures,
      });
    }
    markChanges(out);
    return out;
  }
}

export const sameV = (a: V | null | undefined, b: V | null | undefined) => {
  if (!a || !b || a.s === "absent" || b.s === "absent") return true; // 比べられないものは「変わった」としない
  // 値なし（気象庁が出していない）は「変わった」としない：週間の翌日の値なしは、府県天気予報に任せた印（R5-1）。
  if (a.s === "none" || b.s === "none") return true;
  return (
    a.v === b.v &&
    (a.lower ?? null) === (b.lower ?? null) &&
    (a.upper ?? null) === (b.upper ?? null)
  );
};
const sameMain = (a: V | null | undefined, b: V | null | undefined) =>
  !a || !b || a.s !== "value" || b.s !== "value" ? sameV(a, b) : a.v === b.v;

/** 同じ種類の、1つ前の「発表あり」と比べて変わった項目を印す（区切りの違う値は比べない、R2）。 */
function markChanges(slots: Slot[]) {
  const prev: Partial<Record<Kind, Slot>> = {};
  for (const s of slots) {
    if (s.state !== "ok" || !s.values) continue;
    const p = prev[s.kind]?.values;
    // 当日の発表は途中からの値なので、前の発表とは比べない（R6-1 の範囲は7日前〜当日）。
    if (p && s.lead > 0) {
      const v = s.values;
      // 天気は「その日の天気」どうしだけ比べる（当日の発表の「11時から」は区切りが違う）。
      const wp =
        p.weather.s !== "absent" && "partial" in p.weather
          ? p.weather.partial
          : null;
      const wv =
        v.weather.s !== "absent" && "partial" in v.weather
          ? v.weather.partial
          : null;
      if (wp === wv && !sameMain(p.weather, v.weather))
        s.changed.add("weather");
      if (!sameMain(p.popDay, v.popDay)) s.changed.add("pop");
      if (p.pop6 && v.pop6)
        v.pop6.forEach(
          (x, i) => !sameMain(p.pop6![i], x) && s.changed.add(`pop6-${i}`),
        );
      if ([...s.changed].some((c) => c.startsWith("pop6")))
        s.changed.add("pop");
      if (!sameMain(p.max, v.max)) s.changed.add("max");
      if (!sameMain(p.min, v.min)) s.changed.add("min");
      if (!sameMain(p.reliability, v.reliability)) s.changed.add("reliability");
    }
    prev[s.kind] = s;
  }
}

const vText = (v: V | null | undefined, unit = "") =>
  !v || v.s === "absent" ? null : v.s === "none" ? "値なし" : `${v.v}${unit}`;
const weatherName = (s: Slot) =>
  s.values?.weather.s === "value"
    ? ((s.values.weather as { name?: string }).name ?? null)
    : null;

/**
 * R6-2 の一文：実データから決まった形だけで作る（理由は言わない）。同じ種類の中の変化だけを言い、最大3文。
 * 例：「3日前（10/22 11時の週間）：くもり→くもり時々雨、降水確率 50%→70%」
 */
export function summarize(slots: Slot[]): string[] {
  const okSlots = slots.filter((s) => s.state === "ok");
  const lines: { rank: number; text: string; at: string }[] = [];
  const prev: Partial<Record<Kind, Slot>> = {};
  for (const s of okSlots) {
    const p = prev[s.kind];
    prev[s.kind] = s;
    if (!p || !s.changed.size || !s.values || !p.values) continue;
    const parts: string[] = [];
    let rank = 0;
    if (s.changed.has("weather")) {
      parts.push(`${weatherName(p)}→${weatherName(s)}`);
      rank += 10;
    }
    if (s.changed.has("pop") && s.kind === "VPFW50") {
      const a = vText(p.values.popDay, "%");
      const b = vText(s.values.popDay, "%");
      parts.push(`降水確率 ${a}→${b}`);
      const d =
        p.values.popDay?.s === "value" && s.values.popDay?.s === "value"
          ? Math.abs(Number(s.values.popDay.v) - Number(p.values.popDay.v))
          : 0;
      rank += d >= 20 ? 6 : 2;
    }
    if (s.kind === "VPFD51") {
      const names = ["0〜6時", "6〜12時", "12〜18時", "18〜24時"];
      const ch = [0, 1, 2, 3].filter((i) => s.changed.has(`pop6-${i}`));
      if (ch.length) {
        parts.push(
          `降水確率 ${ch.map((i) => `${names[i]} ${vText(p.values!.pop6![i], "%")}→${vText(s.values!.pop6![i], "%")}`).join("・")}`,
        );
        rank += 4;
      }
    }
    for (const k of ["max", "min"] as const)
      if (s.changed.has(k)) {
        const a = p.values[k];
        const b = s.values[k];
        const d =
          a.s === "value" && b.s === "value"
            ? Math.abs(Number(b.v) - Number(a.v))
            : 0;
        if (d >= 2 || a.s !== b.s) {
          parts.push(
            `${k === "max" ? "最高" : "最低"} ${vText(a, "℃")}→${vText(b, "℃")}`,
          );
          rank += 3;
        }
      }
    if (!parts.length) continue;
    lines.push({
      rank,
      at: s.at,
      text: `${leadLabel(s.lead)}（${issueLabel(s.at)}の${KIND_SHORT[s.kind]}）：${parts.join("、")}`,
    });
  }
  return lines
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .map((l) => l.text);
}

export const sourceName = (src: string) =>
  src === "jma-xml"
    ? "自前の電文"
    : src === "shiromatz"
      ? "shiromatz の記録"
      : src;
export const sourceShort = (src: string) =>
  src === "jma-xml" ? "電文" : "記録";

/** 「—」や空欄の理由（押したときに出す。title に頼らない）。 */
export function blanksOf(s: Slot): { item: string; reason: string }[] {
  const v = s.values;
  if (s.state !== "ok" || !v) return [];
  const out: { item: string; reason: string }[] = [];
  const why = (x: V | null | undefined): string | null =>
    x === null
      ? "対象期間外（この発表より前の時間）"
      : !x || x.s === "absent"
        ? "項目なし（この発表にこの項目がない）"
        : x.s === "none"
          ? "値なし（気象庁が値を出していない）"
          : null;
  const add = (item: string, x: V | null | undefined) => {
    const r = why(x);
    if (r) out.push({ item, reason: r });
  };
  add("天気", v.weather);
  if (s.kind === "VPFW50") add("降水確率（1日）", v.popDay);
  else
    ["0〜6時", "6〜12時", "12〜18時", "18〜24時"].forEach((n, i) =>
      add(`降水確率 ${n}`, v.pop6![i]),
    );
  add(s.kind === "VPFW50" ? "最高気温" : "日中の最高気温", v.max);
  add(s.kind === "VPFW50" ? "最低気温" : "朝の最低気温", v.min);
  if (s.kind === "VPFW50") add("信頼度", v.reliability);
  return out;
}

/**
 * その発表が数値（降水確率・気温）を持っているか。府県天気予報の「明後日」は天気だけで、降水確率と気温は
 * 気象庁がもともと出さない（取れなかったのではない）。両方ある時刻で、どちらを主に見せるかに使う。
 */
export function hasNumbers(s: Slot): boolean {
  const v = s.values;
  if (s.state !== "ok" || !v) return false;
  const n = (x: V | null | undefined) => !!x && x.s === "value";
  return (
    n(v.max) || n(v.min) || n(v.popDay) || (v.pop6 ?? []).some((q) => n(q))
  );
}

/** 同じ時刻の発表のうち、主に見せる方：数値を持つ方。両方持っていれば府県天気予報（詳しい方）。 */
export function primaryAt(slots: Slot[], at: string): Slot | null {
  const here = slots.filter((z) => z.at === at);
  return (
    here.find((z) => z.kind === "VPFD51" && hasNumbers(z)) ??
    here.find((z) => z.kind === "VPFW50" && hasNumbers(z)) ??
    here.find((z) => z.state === "ok") ??
    here[0] ??
    null
  );
}

/**
 * 表示の決まり（2026-11-17）：同じ時刻に週間と府県天気予報があるときは、その日を数値で予報している方だけを
 * 出す。週間の翌日分は「値なし」、府県天気予報の明後日分は天気だけなので、数値を持つのはいつも片方
 * （2日前までは週間、前日・当日は府県天気予報に切り替わる）。両方が数値を持つ時刻があれば府県天気予報。
 */
export function oneSource(slots: Slot[]): Slot[] {
  const seen = new Set<string>();
  const out: Slot[] = [];
  for (const s of slots) {
    if (seen.has(s.at)) continue;
    seen.add(s.at);
    const p = primaryAt(slots, s.at);
    if (p) out.push(p);
  }
  return out;
}

const sign = (d: number) => (d > 0 ? `+${d}` : `−${-d}`);

/** 一覧の行の右（R6-11）：前の同じ種類の発表から変わったもの。数字は差で。府県の6時間ごとは「降水」とだけ。 */
export interface Change {
  text: string;
  tone: "hot" | "cold" | "rain" | "plain";
}
export function changesOf(s: Slot, prev: Slot | null): Change[] {
  const v = s.values;
  const p = prev?.values;
  if (!v || !p) return [];
  const out: Change[] = [];
  if (s.changed.has("weather")) out.push({ text: "天気", tone: "plain" });
  if (s.kind === "VPFW50" && s.changed.has("pop")) {
    const a = v.popDay?.s === "value" ? Number(v.popDay.v) : null;
    const b = p.popDay?.s === "value" ? Number(p.popDay.v) : null;
    out.push({ text: a != null && b != null ? `降水 ${sign(a - b)}%` : "降水", tone: "rain" });
  }
  if (s.kind === "VPFD51" && s.changed.has("pop")) out.push({ text: "降水", tone: "rain" });
  for (const k of ["max", "min"] as const) {
    if (!s.changed.has(k)) continue;
    const a = v[k].s === "value" ? Number(v[k].v) : null;
    const b = p[k].s === "value" ? Number(p[k].v) : null;
    out.push({ text: (k === "max" ? "最高" : "最低") + (a != null && b != null ? ` ${sign(a - b)}°` : ""), tone: k === "max" ? "hot" : "cold" });
  }
  if (s.changed.has("reliability") && v.reliability?.s === "value")
    out.push({
      text: `信頼度 ${p.reliability?.s === "value" ? `${String(p.reliability.v)}→` : ""}${String(v.reliability.v)}`,
      tone: "plain",
    });
  return out;
}

/** 比べる相手：前の同じ種類の「発表あり」（1つの時刻に1つにする前の全部の回から）。 */
export function prevOf(all: Slot[], s: Slot): Slot | null {
  const i = all.findIndex((x) => x.key === s.key);
  return (
    all
      .slice(0, i < 0 ? 0 : i)
      .reverse()
      .find((p) => p.kind === s.kind && p.state === "ok" && p.values) ?? null
  );
}

/** 府県天気予報の3時間ごとの気温（地点）：その日の 0〜24時のどこか（24 は次の日の 0時）。 */
export interface TempPoint {
  hour: number;
  v: number;
  entry: EntryRow;
}

/**
 * 1つの発表の、対象日 `day` の3時間ごとの気温（2026-11-23「今日の予報はどうだったか」）。気象庁の値のまま
 * （整数、補間しない）。週間天気予報には無いので空。
 */
export function tempPoints(h: ForecastHistory, issue: IssueRow | null, day: string): TempPoint[] {
  if (!issue || issue.kind !== "VPFD51") return [];
  const start = Date.parse(`${day}T00:00:00+09:00`);
  const out: TempPoint[] = [];
  for (const e of h.byIssue.get(issue.issue_id) ?? []) {
    if (e.element !== "temp" || e.value == null) continue;
    const hour = (Date.parse(e.valid_from) - start) / H;
    const v = Number(e.value);
    if (!Number.isInteger(hour) || hour < 0 || hour > 24 || !Number.isFinite(v)) continue;
    out.push({ hour, v, entry: e });
  }
  return out.sort((a, b) => a.hour - b.hour);
}

/**
 * 時間帯のグラフに重ねる発表：選んだ回（予報の移り変わりで押した回）があればそれ。無ければ、その日の朝5時の
 * 府県天気予報（2026-11-23 渡辺さん「朝5時の発表」）。5時の発表がまだ・無いときは、それより前のいちばん新しい
 * 府県天気予報（前の日の17時など）。`slots` は ForecastHistory.slots(day, now) のすべて（oneSource の前）。
 */
export function tempSlot(slots: Slot[], day: string, picked: string | null): Slot | null {
  if (picked) {
    const s = slots.find((z) => z.key === picked);
    if (s) return s;
  }
  const morning = `${day}T05:00:00+09:00`;
  return [...slots].reverse().find((z) => z.kind === "VPFD51" && z.state === "ok" && !!z.shown && z.at <= morning) ?? null;
}
