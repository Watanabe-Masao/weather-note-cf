// 予報の履歴 R6 の見本：forecast_issues / forecast_entries の行から、画面に出すものを決める（見本だけの仮の決まり）。
// 本体に入れるときは、ここで決めたことを要件（R5-1・R6）と照らして shared/ に移す。

export interface IssueRow {
  issue_id: string;
  source: string; // jma-xml / shiromatz
  office: string;
  kind: string; // VPFD51 / VPFW50
  issued_at: string;
  info_type: string | null; // 発表 / 訂正 / 取消
  revision_of: string | null;
  preferred: number;
  parser: number;
  entries: number;
  problems: string | null;
}
export interface EntryRow {
  issue_id: string;
  place: string;
  place_name: string;
  place_type: string;
  element: string;
  valid_from: string;
  valid_to: string;
  period: string;
  label: string | null;
  value: string | null;
  unit: string | null;
  lower: number | null;
  upper: number | null;
  jma_type: string;
  condition: string | null;
}
export interface FetchLogRow {
  at: string;
  feed: string;
  ok: number;
  entries: number;
  wanted: number;
  added: number;
  left_over: number;
  error: string | null;
}
export interface Scenario {
  id: string;
  label: string;
  issues: IssueRow[];
  entries: EntryRow[];
  fetchLog: FetchLogRow[];
  source?: { repo: string; commit: string; path: string; zipSha256: string; license: string };
  synthetic?: string[];
}

export type Kind = "VPFW50" | "VPFD51";
export const KIND_NAME: Record<Kind, string> = { VPFW50: "週間天気予報", VPFD51: "府県天気予報" };
export const KIND_SHORT: Record<Kind, string> = { VPFW50: "週間", VPFD51: "府県" };

/** 自前の電文が正本になった日（R1）。これより前の空きは shiromatz の記録にない＝未取得（R2-10）。 */
export const OWN_FROM = "2026-11-10";

/**
 * 天気予報用テロップ番号 → 気象庁の天気の名前（この見本のデータに出てくる番号だけ）。
 * アプリにはまだこの表がない：週間の天気は電文には言葉（基本天気）があるが、shiromatz の記録には番号しかない。
 */
export const TELOP: Record<string, string> = {
  "100": "晴れ",
  "101": "晴れ時々くもり",
  "102": "晴れ一時雨",
  "110": "晴れ後時々くもり",
  "111": "晴れ後くもり",
  "112": "晴れ後一時雨",
  "200": "くもり",
  "201": "くもり時々晴れ",
  "202": "くもり一時雨",
  "203": "くもり時々雨",
  "211": "くもり後晴れ",
  "212": "くもり後一時雨",
  "214": "くもり後雨",
  "300": "雨",
  "302": "雨時々止む",
  "311": "雨後晴れ",
  "313": "雨後くもり",
};
/** WeatherIcon（skyOf）は漢字の 晴・曇・雨 で読むので、名前をその形にして渡す。 */
export const skyText = (name: string | null) => (name ? name.replace(/くもり/g, "曇").replace(/晴れ/g, "晴") : null);

const H = 3_600_000;
export const jstDate = (iso: string) => new Date(Date.parse(iso) + 9 * H).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 24 * H).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / (24 * H));
export const hourOf = (iso: string) => Number(iso.slice(11, 13));
const WD = ["日", "月", "火", "水", "木", "金", "土"];
export const weekday = (date: string) => WD[new Date(`${date}T00:00:00Z`).getUTCDay()];
export const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
export const issueLabel = (iso: string) => `${md(jstDate(iso))} ${hourOf(iso)}時`;
export const leadLabel = (n: number) => (n === 0 ? "当日" : n === 1 ? "前日" : `${n}日前`);

/** 1つの値の状態：値／気象庁が値を出していない（値なし）／発表にその項目がない（項目なし）。 */
export type V =
  | { s: "value"; v: number | string; lower?: number | null; upper?: number | null; entry: EntryRow }
  | { s: "none"; entry: EntryRow } // 値なし（項目はあり、値がない）
  | { s: "absent" }; // 項目なし（この発表にない）

export interface DayValues {
  weather: (V & { name?: string | null; sentence?: string | null; partial?: string | null }) | V;
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
  notIssued: "取得は成功しているのに、この回の発表がない：気象庁から出ていない（R5-3 の「届かない」と同じ扱い）",
};

export class Data {
  readonly byIssue = new Map<string, EntryRow[]>();
  readonly copies = new Map<string, IssueRow[]>(); // kind|issued_at
  constructor(readonly sc: Scenario) {
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

  /** 見本で選べる対象日（その日を予報した発表が1つでもある日）。 */
  days(): string[] {
    const set = new Set<string>();
    for (const e of this.sc.entries) if (e.element === "weather_code") set.add(jstDate(e.valid_from));
    const issued = this.sc.issues.map((i) => jstDate(i.issued_at)).sort();
    return [...set].filter((d) => d >= issued[0]).sort();
  }

  /** 対象日 `day` の値を、1つの発表から読む。 */
  valuesFor(issue: IssueRow, day: string): DayValues | null {
    const es = (this.byIssue.get(issue.issue_id) ?? []).filter((e) => jstDate(e.valid_from) === day);
    if (!es.length) return null;
    const pick = (el: string, jma?: string): V => {
      const e = es.find((x) => x.element === el && (!jma || x.jma_type === jma));
      if (!e) return { s: "absent" };
      if (e.value == null) return { s: "none", entry: e };
      const n = Number(e.value);
      return { s: "value", v: Number.isFinite(n) && el !== "reliability" && el !== "weather_code" ? n : e.value, lower: e.lower, upper: e.upper, entry: e };
    };
    const code = pick("weather_code");
    const sentence = es.find((x) => x.element === "weather_text")?.value ?? null;
    const codeEntry = code.s !== "absent" ? code.entry : null;
    const partial = codeEntry && codeEntry.period !== "P1D" ? `${hourOf(codeEntry.valid_from)}時から` : null;
    const weather = code.s === "value" ? { ...code, name: TELOP[String(code.v)] ?? `番号${code.v}`, sentence, partial } : code;
    if (issue.kind === "VPFW50")
      return { weather, popDay: pick("pop", "日降水確率"), pop6: null, max: pick("temp_max", "最高気温"), min: pick("temp_min", "最低気温"), reliability: pick("reliability") };
    const pop6 = [0, 6, 12, 18].map((h) => {
      const e = es.find((x) => x.element === "pop" && hourOf(x.valid_from) === h);
      if (!e) return Date.parse(`${day}T${String(h + 6).padStart(2, "0")}:00:00+09:00`) <= Date.parse(issue.issued_at) ? null : ({ s: "absent" } as V);
      return e.value == null ? ({ s: "none", entry: e } as V) : ({ s: "value", v: Number(e.value), entry: e } as V);
    });
    return { weather, popDay: null, pop6, max: pick("temp_max", "日中の最高気温"), min: pick("temp_min", "朝の最低気温"), reliability: null };
  }

  /** 定時の発表の回（その日を予報しうるもの）。高知の VPFD51 は 5・11・17時、VPFW50 は 11・17時（R5-3）。 */
  private expected(day: string): { kind: Kind; at: string }[] {
    const at = (d: string, h: number) => `${d}T${String(h).padStart(2, "0")}:00:00+09:00`;
    const out: { kind: Kind; at: string }[] = [];
    for (let n = 7; n >= 1; n--) for (const h of [11, 17]) out.push({ kind: "VPFW50", at: at(addDays(day, -n), h) });
    for (const h of [11, 17]) out.push({ kind: "VPFD51", at: at(addDays(day, -2), h) });
    for (const n of [1, 0]) for (const h of [5, 11, 17]) out.push({ kind: "VPFD51", at: at(addDays(day, -n), h) });
    return out;
  }

  private stateOfMissing(at: string): { state: SlotState; failures: FetchLogRow[] } {
    if (jstDate(at) < OWN_FROM) return { state: "missing", failures: [] };
    const t = Date.parse(at);
    const logs = this.sc.fetchLog.filter((l) => Date.parse(l.at) >= t - 30 * 60_000 && Date.parse(l.at) <= t + 60 * 60_000);
    const failures = logs.filter((l) => !l.ok);
    if (failures.length) return { state: "failed", failures };
    if (logs.length) return { state: "notIssued", failures: [] };
    return { state: "missing", failures: [] };
  }

  /** 対象日 `day` の移り変わり：発表の回を時刻の順に。今より先の回は出さない。 */
  slots(day: string, now?: string): Slot[] {
    const last = this.sc.issues.map((i) => i.issued_at).sort().at(-1) ?? "";
    const until = now ?? last;
    const keys = new Map<string, { kind: Kind; at: string; regular: boolean }>();
    for (const x of this.expected(day)) if (x.at <= until) keys.set(`${x.kind}|${x.at}`, { ...x, regular: true });
    // 定時でない発表（臨時の発表や、記録の取り方による回）も、その日を予報していれば入れる。
    for (const i of this.sc.issues) {
      const k = `${i.kind}|${i.issued_at}`;
      if (keys.has(k) || (i.kind !== "VPFD51" && i.kind !== "VPFW50")) continue;
      if (jstDate(i.issued_at) > day || dayDiff(day, jstDate(i.issued_at)) > 7) continue;
      if (this.valuesFor(i, day)) keys.set(k, { kind: i.kind as Kind, at: i.issued_at, regular: false });
    }
    const out: Slot[] = [];
    for (const [key, x] of [...keys].sort(([, a], [, b]) => (a.at === b.at ? (a.kind === "VPFW50" ? -1 : 1) : a.at < b.at ? -1 : 1))) {
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
      out.push({ key, kind: x.kind, at: x.at, regular: x.regular, lead: dayDiff(day, jstDate(x.at)), state, shown, copies, values, changed: new Set(), failures });
    }
    markChanges(out);
    return out;
  }
}

export const sameV = (a: V | null | undefined, b: V | null | undefined) => {
  if (!a || !b || a.s === "absent" || b.s === "absent") return true; // 比べられないものは「変わった」としない
  // 値なし（気象庁が出していない）は「変わった」としない：週間の翌日の値なしは、府県天気予報に任せた印（R5-1）。
  if (a.s === "none" || b.s === "none") return true;
  return a.v === b.v && (a.lower ?? null) === (b.lower ?? null) && (a.upper ?? null) === (b.upper ?? null);
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
      const wp = p.weather.s !== "absent" && "partial" in p.weather ? p.weather.partial : null;
      const wv = v.weather.s !== "absent" && "partial" in v.weather ? v.weather.partial : null;
      if (wp === wv && !sameMain(p.weather, v.weather)) s.changed.add("weather");
      if (!sameMain(p.popDay, v.popDay)) s.changed.add("pop");
      if (p.pop6 && v.pop6) v.pop6.forEach((x, i) => !sameMain(p.pop6![i], x) && s.changed.add(`pop6-${i}`));
      if ([...s.changed].some((c) => c.startsWith("pop6"))) s.changed.add("pop");
      if (!sameMain(p.max, v.max)) s.changed.add("max");
      if (!sameMain(p.min, v.min)) s.changed.add("min");
      if (!sameMain(p.reliability, v.reliability)) s.changed.add("reliability");
    }
    prev[s.kind] = s;
  }
}

const vText = (v: V | null | undefined, unit = "") => (!v || v.s === "absent" ? null : v.s === "none" ? "値なし" : `${v.v}${unit}`);
const weatherName = (s: Slot) => (s.values?.weather.s === "value" ? ((s.values.weather as { name?: string }).name ?? null) : null);

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
      const d = p.values.popDay?.s === "value" && s.values.popDay?.s === "value" ? Math.abs(Number(s.values.popDay.v) - Number(p.values.popDay.v)) : 0;
      rank += d >= 20 ? 6 : 2;
    }
    if (s.kind === "VPFD51") {
      const names = ["0〜6時", "6〜12時", "12〜18時", "18〜24時"];
      const ch = [0, 1, 2, 3].filter((i) => s.changed.has(`pop6-${i}`));
      if (ch.length) {
        parts.push(`降水確率 ${ch.map((i) => `${names[i]} ${vText(p.values!.pop6![i], "%")}→${vText(s.values!.pop6![i], "%")}`).join("・")}`);
        rank += 4;
      }
    }
    for (const k of ["max", "min"] as const)
      if (s.changed.has(k)) {
        const a = p.values[k];
        const b = s.values[k];
        const d = a.s === "value" && b.s === "value" ? Math.abs(Number(b.v) - Number(a.v)) : 0;
        if (d >= 2 || a.s !== b.s) {
          parts.push(`${k === "max" ? "最高" : "最低"} ${vText(a, "℃")}→${vText(b, "℃")}`);
          rank += 3;
        }
      }
    if (!parts.length) continue;
    lines.push({ rank, at: s.at, text: `${leadLabel(s.lead)}（${issueLabel(s.at)}の${KIND_SHORT[s.kind]}）：${parts.join("、")}` });
  }
  return lines
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .map((l) => l.text);
}

export const sourceName = (src: string) => (src === "jma-xml" ? "自前の電文" : src === "shiromatz" ? "shiromatz の記録" : src);
export const sourceShort = (src: string) => (src === "jma-xml" ? "電文" : "記録");

/** 「—」や空欄の理由（押したときに出す。title に頼らない）。 */
export function blanksOf(s: Slot): { item: string; reason: string }[] {
  const v = s.values;
  if (s.state !== "ok" || !v) return [];
  const out: { item: string; reason: string }[] = [];
  const why = (x: V | null | undefined): string | null =>
    x === null ? "対象期間外（この発表より前の時間）" : !x || x.s === "absent" ? "項目なし（この発表にこの項目がない）" : x.s === "none" ? "値なし（気象庁が値を出していない）" : null;
  const add = (item: string, x: V | null | undefined) => {
    const r = why(x);
    if (r) out.push({ item, reason: r });
  };
  add("天気", v.weather);
  if (s.kind === "VPFW50") add("降水確率（1日）", v.popDay);
  else ["0〜6時", "6〜12時", "12〜18時", "18〜24時"].forEach((n, i) => add(`降水確率 ${n}`, v.pop6![i]));
  add(s.kind === "VPFW50" ? "最高気温" : "日中の最高気温", v.max);
  add(s.kind === "VPFW50" ? "最低気温" : "朝の最低気温", v.min);
  if (s.kind === "VPFW50") add("信頼度", v.reliability);
  return out;
}
