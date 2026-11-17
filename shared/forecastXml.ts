// 予報の履歴 (#250, R1-7): JMA's forecast telegrams (防災情報XML, kept as issued by
// worker/src/forecastArchive.ts) read into one issue and its values:
//   VPFD51 府県天気予報（Ｒ１）  — by area (区域): 天気 (its summary and its sentence) and its code for 今日・明日・明後日, the 6-hour
//                                 降水確率, the 3-hour 卓越天気; by station (地点): 朝の最低気温,
//                                 日中の最高気温, 最高気温, the 3-hour 気温.
//   VPFW50 府県週間天気予報    — by area: 天気 and its code, 日降水確率, 信頼度 (A/B/C) for 7 days; by
//                                 station: 最高・最低気温 with their 予測範囲 (lower / upper).
//   VPFG50 府県天気概況        — the text (本文).
// Every value keeps the time it speaks of (valid_from and valid_to, from the telegram's TimeDefine),
// its unit and its period, so values of different periods are never taken for one another (a 6-hour
// 降水確率 is not a day's). A value JMA gives as 「値なし」 is kept as null with that note: the item is
// in the telegram but has no value (R5-1「項目なし」), not a value that was lost. Anything that does
// not read is said (`problems`), never guessed. The telegram itself is never changed: when this
// parser changes, FORECAST_XML_PARSER goes up and the kept XML is read again (N-5).
// The form is FH-04's reading of the telegrams of 2026-11 (#250). 出典：気象庁（防災情報XML）。

export const FORECAST_XML_PARSER = 1;

export type ForecastElement =
  | "weather" // the weather in words, as JMA writes it (くもり時々晴れ)
  | "weather_text" // the weather as JMA's sentence (雨　時々　くもり　所により…), as the forecast page and JSON give it
  | "weather_code" // 天気予報用テロップ番号 (200 …)
  | "weather_3h" // ３時間内卓越天気
  | "pop" // 降水確率 (%), 6-hour or daily by `period`
  | "temp_max" // 最高気温 (℃): 日中 (9–18時) or the day's by `period` and `jmaType`
  | "temp_min" // 最低気温 (℃): 朝 (0–9時) or the day's
  | "temp" // ３時間毎気温 (℃), at an instant
  | "reliability" // 信頼度 A / B / C (週間)
  | "overview"; // 天気概況の本文

export interface ForecastEntry {
  /** The area's or the station's code (390010, 74182 …) and name, and which of the two it is. */
  place: string;
  placeName: string;
  placeType: "area" | "station";
  element: ForecastElement;
  /** The time spoken of (JST ISO), and its end (equal for an instant). */
  validFrom: string;
  validTo: string;
  /** The length as JMA gives it (PT6H, P1D, PT9H …); "" for an instant. */
  period: string;
  /** JMA's own name for the time (今日, 明日朝, １２時から１８時まで …), when it gives one. */
  label: string | null;
  /** The value as written (numbers as their digits); null when JMA gives none. */
  value: string | null;
  unit: string | null;
  /** 予測範囲 (週間の気温): the lower and upper ends. */
  lower: number | null;
  upper: number | null;
  /** JMA's type of the value (日中の最高気温, ６時間降水確率 …), and its condition (値なし, 雨 …). */
  jmaType: string;
  condition: string | null;
}

export interface ForecastIssue {
  kind: string;
  office: string;
  title: string | null;
  issuedAt: string;
  targetAt: string | null;
  /** 発表 / 訂正 / 取消 */
  infoType: string | null;
  headline: string | null;
  entries: ForecastEntry[];
  problems: string[];
}

const first = (xml: string, tag: string) => new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(xml)?.[1]?.trim() || null;
const blocks = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => ({ attrs: m[1], body: m[2] }));
const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;
/** jmx_eb elements, self-closing (値なし) or not. */
const values = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<jmx_eb:${tag}\\b([^>]*?)(?:/>|>([^<]*)</jmx_eb:${tag}>)`, "g"))].map((m) => ({
    attrs: m[1],
    text: m[2]?.trim() ?? "",
  }));

/** P1D, PT13H, PT6H … → milliseconds (null when it does not read). */
function durationMs(d: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d);
  if (!m || d === "P" || d === "PT") return null;
  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 60_000;
}

/** A JST ISO time `ms` later, written as JMA writes it (+09:00). */
function later(iso: string, ms: number): string {
  const t = Date.parse(iso) + ms;
  return new Date(t + 9 * 3_600_000).toISOString().slice(0, 19) + "+09:00";
}

interface TimeDef {
  from: string;
  to: string;
  period: string;
  label: string | null;
}

function timeDefines(body: string, problems: string[]): Map<string, TimeDef> {
  const out = new Map<string, TimeDef>();
  for (const { attrs, body: t } of blocks(body, "TimeDefine")) {
    const id = attr(attrs, "timeId");
    const from = first(t, "DateTime");
    if (!id || !from) {
      problems.push("時刻の定義が読めない");
      continue;
    }
    const period = first(t, "Duration") ?? "";
    const ms = period ? durationMs(period) : 0;
    if (ms == null) problems.push(`期間が読めない：${period}`);
    out.set(id, { from, to: later(from, ms ?? 0), period, label: first(t, "Name") });
  }
  return out;
}

/** The JMA types read, and the element each becomes. Anything else (風, 波, 平年値 …) is left in the XML. */
const ELEMENT: Record<string, ForecastElement> = {
  天気: "weather",
  基本天気: "weather",
  天気予報用テロップ番号: "weather_code",
  "６時間降水確率": "pop",
  日降水確率: "pop",
  信頼度階級: "reliability",
  日中の最高気温: "temp_max",
  最高気温: "temp_max",
  朝の最低気温: "temp_min",
  最低気温: "temp_min",
  気温: "temp",
};

/** The value elements (jmx_eb) read in each Property, by the Property's Type. */
const PROPERTY: Record<string, string[]> = {
  天気: ["Weather", "WeatherCode"],
  降水確率: ["ProbabilityOfPrecipitation"],
  信頼度: ["ReliabilityClass"],
  日中の最高気温: ["Temperature"],
  最高気温: ["Temperature"],
  朝の最低気温: ["Temperature"],
  最低気温: ["Temperature"],
  最高気温予測範囲: ["Temperature"],
  最低気温予測範囲: ["Temperature"],
  "３時間内卓越天気": ["Weather"],
  "３時間毎気温": ["Temperature"],
};

function readTimeSeries(ts: string, problems: string[], out: ForecastEntry[]) {
  const times = timeDefines(ts, problems);
  for (const { body: item } of blocks(ts, "Item")) {
    const area = /<(Area|Station)>\s*<Name>([^<]*)<\/Name>\s*<Code>([^<]*)<\/Code>/.exec(item);
    if (!area) {
      problems.push("区域・地点が読めない");
      continue;
    }
    const where = { place: area[3], placeName: area[2], placeType: area[1] === "Area" ? ("area" as const) : ("station" as const) };
    // 予測範囲 come as their own Properties; they are set onto the value of the same type and time.
    const ranges: { base: string; end: "lower" | "upper"; ref: string; v: number | null }[] = [];
    for (const { body: prop } of blocks(item, "Property")) {
      const type = first(prop, "Type") ?? "";
      const tags = PROPERTY[type];
      if (!tags) continue;
      // 天気 in 府県天気予報 also carries DetailForecast: its sentence is read (weather_text, the words JMA's
      // forecast page and JSON show), its word-by-word parts are not.
      for (const { attrs, body: part } of blocks(prop, "WeatherForecastPart")) {
        const ref = attr(attrs, "refID") ?? "";
        const time = times.get(ref);
        const sentence = /^\s*<Sentence>([^<]*)<\/Sentence>/.exec(part)?.[1]?.trim();
        if (!time || !sentence) {
          problems.push(`${type}：文が読めない`);
          continue;
        }
        out.push({ ...where, element: "weather_text", validFrom: time.from, validTo: time.to, period: time.period, label: time.label, value: sentence, unit: null, lower: null, upper: null, jmaType: "天気の文", condition: null });
      }
      const parts = prop.replace(/<DetailForecast>[\s\S]*?<\/DetailForecast>/g, "");
      for (const tag of tags)
        for (const v of values(parts, tag)) {
          const jmaType = attr(v.attrs, "type") ?? "";
          const ref = attr(v.attrs, "refID") ?? "";
          const time = times.get(ref);
          if (!time) {
            problems.push(`${type}：時刻 ${ref} がない`);
            continue;
          }
          const condition = attr(v.attrs, "condition");
          const n = v.text === "" ? null : Number(v.text);
          const range = /^(最[高低]気温)予測範囲（(上|下)端）$/.exec(jmaType);
          if (range) {
            ranges.push({ base: range[1], end: range[2] === "上" ? "upper" : "lower", ref, v: n != null && Number.isFinite(n) ? n : null });
            continue;
          }
          // ３時間内卓越天気 is 天気 by type; it is told apart by its Property.
          const element = type === "３時間内卓越天気" ? "weather_3h" : ELEMENT[jmaType];
          if (!element) {
            problems.push(`読まない種類：${jmaType}`);
            continue;
          }
          const unit = attr(v.attrs, "unit");
          out.push({
            ...where,
            element,
            validFrom: time.from,
            validTo: time.to,
            period: time.period,
            label: time.label,
            value: v.text === "" ? null : v.text,
            unit: unit === "度" ? "℃" : unit,
            lower: null,
            upper: null,
            jmaType,
            condition,
          });
          (out[out.length - 1] as ForecastEntry & { ref?: string }).ref = ref;
        }
    }
    for (const r of ranges) {
      const target = out.find(
        (e) => (e as ForecastEntry & { ref?: string }).ref === r.ref && e.place === where.place && e.jmaType === r.base,
      );
      if (target) target[r.end] = r.v;
      else problems.push(`${r.base}予測範囲：値がない`);
    }
  }
}

/** `kind`: the telegram's code (VPFD51 …) and `office` (390000 …), from its name in the feed. */
export function parseForecastXml(xml: string, kind: string, office: string): ForecastIssue {
  const problems: string[] = [];
  const head = /<Head\b[\s\S]*?<\/Head>/.exec(xml)?.[0] ?? "";
  const issuedAt = first(head, "ReportDateTime");
  if (!issuedAt) throw new Error("ReportDateTime がない");
  const entries: ForecastEntry[] = [];
  const body = /<Body\b[\s\S]*<\/Body>/.exec(xml)?.[0] ?? "";
  const infoType = first(head, "InfoType");
  if (kind === "VPFG50") {
    const area = /<TargetArea\b[^>]*>\s*<Name>([^<]*)<\/Name>\s*<Code>([^<]*)<\/Code>/.exec(body);
    const text = /<Text\b[^>]*type="本文"[^>]*>([\s\S]*?)<\/Text>/.exec(body)?.[1]?.trim() ?? null;
    if (text)
      entries.push({
        place: area?.[2] ?? office,
        placeName: area?.[1] ?? "",
        placeType: "area",
        element: "overview",
        validFrom: issuedAt,
        validTo: issuedAt,
        period: "",
        label: null,
        value: text,
        unit: null,
        lower: null,
        upper: null,
        jmaType: "本文",
        condition: null,
      });
    else if (infoType !== "取消") problems.push("本文がない");
  } else {
    for (const { attrs, body: mi } of blocks(body, "MeteorologicalInfos")) {
      const type = attr(attrs, "type");
      if (type !== "区域予報" && type !== "地点予報") continue; // 平年値 are not forecasts
      for (const { body: ts } of blocks(mi, "TimeSeriesInfo")) readTimeSeries(ts, problems, entries);
    }
    if (!entries.length && infoType !== "取消") problems.push("予報の値がない");
  }
  for (const e of entries) delete (e as ForecastEntry & { ref?: string }).ref;
  const headlineText = first(/<Headline>[\s\S]*?<\/Headline>/.exec(head)?.[0] ?? "", "Text");
  return {
    kind,
    office,
    title: first(head, "Title"),
    issuedAt,
    targetAt: first(head, "TargetDateTime"),
    infoType,
    headline: headlineText,
    entries,
    problems: [...new Set(problems)],
  };
}
