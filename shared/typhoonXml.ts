// 当時の発表 (#220): JMA's 台風解析・予報情報（5日予報）, the XML telegram VPTW60 (防災情報XML,
// PULL型), read into the times it speaks of. Its head carries when JMA issued it (ReportDateTime)
// and the typhoon (TyphoonNamePart: Number yyNN, Name, NameKana, Remark); each MeteorologicalInfo is
// one time — the analysis (実況, 推定) or a forecast (予報 12・24…時間後) — with the centre, the
// pressure, the wind, and its areas: 暴風域 and 強風域 at the analysis, 予報円 and 暴風警戒域 ahead.
// A radius is given as a direction and its length in 海里 (two when the wind leans: the longest and
// the shortest), as the best track gives it (shared/typhoon.ts Radius).
//
// The form is TY-02's reading of the telegrams of 2026 (#220). Anything that does not read is left
// out and said (`problems`), never guessed. 出典：気象庁（防災情報XML）。

export const TYPHOON_XML_PARSER = 1;

export interface XmlRadius {
  /** km; the longest and the shortest (equal when 全域), and the bearing of the longest (null = 全域). */
  long: number;
  short: number;
  dir: number | null;
}
export interface XmlCircle {
  lat: number;
  lon: number;
  radius: XmlRadius;
}
export interface XmlTime {
  /** 実況 / 推定 / 予報 … as JMA names it, and the time it speaks of (JST ISO). */
  part: string;
  validAt: string;
  /** Hours ahead of the analysis (0 for 実況・推定). */
  hours: number;
  typhoonClass: string | null;
  lat: number | null;
  lon: number | null;
  location: string | null;
  pressure: number | null;
  /** knots, as the telegram gives them first (m/s follows in the same telegram). */
  windKt: number | null;
  gustKt: number | null;
  /** At the analysis: 暴風域 and 強風域. Ahead: 暴風警戒域 and 予報円 (its radius is the 70% circle). */
  storm: XmlCircle | null;
  gale: XmlCircle | null;
  warning: XmlCircle | null;
  probability: XmlCircle | null;
}
export interface XmlTelegram {
  kind: string;
  issuedAt: string;
  targetAt: string | null;
  infoType: string | null;
  /** yyNN */
  number: string | null;
  name: string | null;
  nameKana: string | null;
  remark: string | null;
  times: XmlTime[];
  problems: string[];
}

const NM_KM = 1.852;
const BEARING: Record<string, number> = {
  北: 0,
  北東: 45,
  東: 90,
  南東: 135,
  南: 180,
  南西: 225,
  西: 270,
  北西: 315,
};

const first = (xml: string, tag: string) =>
  new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(xml)?.[1]?.trim() ||
  null;
const num = (s: string | null | undefined) =>
  s != null && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : null;
const blocks = (xml: string, tag: string) =>
  [
    ...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g")),
  ].map((m) => ({ attrs: m[1], body: m[2] }));
const attr = (attrs: string, name: string) =>
  new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;

/** "+29.2+151.0/" → [29.2, 151.0] */
function coordinate(s: string | null): [number, number] | null {
  const m = s ? /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(s.trim()) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** The point of a circle (BasePoint, 中心位置（度）) and its radius from the Axes. */
function circle(
  body: string,
  fallback: [number, number] | null,
): XmlCircle | null {
  const base =
    [...body.matchAll(/<(?:jmx_eb:)?BasePoint\b([^>]*)>([^<]*)</g)].find((m) =>
      /度/.test(attr(m[1], "type") ?? ""),
    )?.[2] ?? null;
  const at = coordinate(base) ?? fallback;
  const axes = blocks(body, "(?:jmx_eb:)?Axis").map(({ body: a }) => {
    const dirM = /<(?:jmx_eb:)?Direction\b([^>]*)>([^<]*)</.exec(a);
    const dirText = (
      dirM?.[2] ||
      attr(dirM?.[1] ?? "", "condition") ||
      ""
    ).trim();
    // The radius in 海里 (the telegram also gives km; one unit is enough).
    const r = [...a.matchAll(/<(?:jmx_eb:)?Radius\b([^>]*)>([^<]*)</g)].find(
      (m) => attr(m[1], "unit") === "海里",
    );
    return { dir: dirText, nm: num(r?.[2]) };
  });
  const sized = axes.filter((x) => x.nm != null && x.nm > 0);
  if (!at || !sized.length) return null;
  const longest = sized.reduce((a, b) => (b.nm! > a.nm! ? b : a));
  const shortest = sized.reduce((a, b) => (b.nm! < a.nm! ? b : a));
  return {
    lat: at[0],
    lon: at[1],
    radius: {
      long: longest.nm! * NM_KM,
      short: shortest.nm! * NM_KM,
      dir:
        sized.length > 1 && longest.dir in BEARING
          ? BEARING[longest.dir]
          : null,
    },
  };
}

function windOf(body: string, type: RegExp): number | null {
  const w = [
    ...body.matchAll(/<(?:jmx_eb:)?WindSpeed\b([^>]*)>([^<]*)</g),
  ].find(
    (m) =>
      type.test(attr(m[1], "type") ?? "") && attr(m[1], "unit") === "ノット",
  );
  return num(w?.[2]);
}

/** Hours ahead from 「予報　１２時間後」 (full-width digits as JMA writes them). */
function hoursOf(part: string): number {
  const half = part.replace(/[０-９]/g, (d) =>
    String.fromCharCode(d.charCodeAt(0) - 0xfee0),
  );
  return num(/(\d+)\s*時間後/.exec(half)?.[1]) ?? 0;
}

/** `kind`: the telegram's code (VPTW60 …), from its name in the feed. */
export function parseTyphoonXml(xml: string, kind = "VPTW60"): XmlTelegram {
  const problems: string[] = [];
  const head = /<Head\b[\s\S]*?<\/Head>/.exec(xml)?.[0] ?? "";
  const body = /<Body\b[\s\S]*?<\/Body>/.exec(xml)?.[0] ?? "";
  if (!head) problems.push("Head がない");
  const issuedAt = first(head, "ReportDateTime") ?? "";
  if (!issuedAt) problems.push("発表時刻（ReportDateTime）がない");
  const namePart =
    /<TyphoonNamePart\b[\s\S]*?<\/TyphoonNamePart>/.exec(body)?.[0] ?? "";
  const times: XmlTime[] = [];
  for (const info of blocks(body, "MeteorologicalInfo")) {
    const dt = /<DateTime\b([^>]*)>([^<]*)</.exec(info.body);
    const part = attr(dt?.[1] ?? "", "type") ?? "";
    const validAt = dt?.[2]?.trim() ?? "";
    if (!validAt) {
      problems.push("時刻（DateTime）のない MeteorologicalInfo");
      continue;
    }
    const center =
      /<CenterPart\b[\s\S]*?<\/CenterPart>/.exec(info.body)?.[0] ?? "";
    const centerAt = coordinate(
      [...center.matchAll(/<(?:jmx_eb:)?Coordinate\b([^>]*)>([^<]*)</g)].find(
        (m) => /度/.test(attr(m[1], "type") ?? ""),
      )?.[2] ?? null,
    );
    const prob =
      /<ProbabilityCircle\b[\s\S]*?<\/ProbabilityCircle>/.exec(center)?.[0] ??
      "";
    const probability = prob ? circle(prob, null) : null;
    // The centre of a forecast time is its 予報円's.
    const at =
      centerAt ??
      (probability
        ? ([probability.lat, probability.lon] as [number, number])
        : null);
    const pressure = [
      ...center.matchAll(/<(?:jmx_eb:)?Pressure\b([^>]*)>([^<]*)</g),
    ].find((m) => attr(m[1], "unit") === "hPa")?.[2];
    let storm: XmlCircle | null = null;
    let warning: XmlCircle | null = null;
    for (const w of blocks(info.body, "WarningAreaPart")) {
      const kind = attr(w.attrs, "type") ?? "";
      const c = circle(w.body, at);
      if (/暴風警戒域/.test(kind)) warning = c;
      else if (/暴風域/.test(kind)) storm = c;
    }
    let gale: XmlCircle | null = null;
    for (const a of blocks(info.body, "Area")) {
      for (const c of blocks(a.body, "(?:jmx_eb:)?Circle")) {
        if (/強風域/.test(attr(c.attrs, "type") ?? ""))
          gale = circle(c.body, at);
      }
    }
    times.push({
      part,
      validAt,
      hours: hoursOf(part),
      typhoonClass: first(info.body, "(?:jmx_eb:)?TyphoonClass"),
      lat: at?.[0] ?? null,
      lon: at?.[1] ?? null,
      location: first(center, "Location"),
      pressure: num(pressure),
      windKt: windOf(info.body, /最大風速/),
      gustKt: windOf(info.body, /最大瞬間風速/),
      storm,
      gale,
      warning,
      probability,
    });
  }
  if (!times.length)
    problems.push("時刻ごとの情報（MeteorologicalInfo）がない");
  return {
    kind,
    issuedAt,
    targetAt: first(head, "TargetDateTime"),
    infoType: first(head, "InfoType"),
    number: first(namePart, "Number"),
    name: first(namePart, "Name"),
    nameKana: first(namePart, "NameKana"),
    remark: first(namePart, "Remark"),
    times,
    problems,
  };
}
