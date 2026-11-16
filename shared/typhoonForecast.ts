// 近づいている台風 (#220): JMA's typhoon information as its own pages publish it (防災情報の JSON:
// bosai/typhoon/data/targetTc.json, then {TC}/forecast.json and {TC}/specifications.json), read and
// set against a station. Nothing here forecasts: the areas are JMA's own — the 強風域 and 暴風域 now,
// and the 暴風警戒域 ahead — and the station is only looked up in them. Moving or filling in a
// forecast would be a forecast of our own (気象業務法 第17条), so the figures are shown as JMA gives them.
//
// The JSON is not documented for outside use and may change; anything that does not read as
// expected is no typhoon, never an error on the screen. 出典：気象庁「台風情報」。

import { destination, distanceBearing } from "./typhoon";

export interface Circle {
  lat: number;
  lon: number;
  km: number;
}

export interface TyphoonNow {
  tc: string;
  /** 台風◯号 (the last two digits of JMA's typhoonNumber yyNN). */
  number: number;
  name: string;
  /** 台風・熱帯低気圧 …, and its 大きさ・強さ when JMA gives them ("-" is none). */
  category: string;
  scale: string | null;
  intensity: string | null;
  /** When JMA issued it, JST ISO. */
  issued: string;
  /** The analysis: where the centre is now. */
  at: { lat: number; lon: number; location: string | null; course: string | null; speedKmh: number | null };
  pressure: number | null;
  /** m/s */
  wind: number | null;
  gust: number | null;
  /** 強風域 and 暴風域 now (JMA's circles; the 暴風域 is absent when there is none). */
  gale: Circle | null;
  storm: Circle | null;
  /**
   * 暴風警戒域 ahead: JMA's circles in time; the area is the hull between them. JMA gives the whole
   * area with every forecast time (the same arcs each time), so it is one area, not one per time.
   */
  warning: Circle[];
  /** The forecast times: the 予報円's centre and radius (km), as JMA gives them. */
  ahead: { validtime: string; hours: number; center: [number, number] | null; circleKm: number | null }[];
}

type J = Record<string, unknown>;
const obj = (v: unknown): J | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numOr = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && v !== "-" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v !== "-" && v !== "" ? v : null);
const latLon = (v: unknown): [number, number] | null => {
  const a = arr(v);
  return a.length >= 2 && numOr(a[0]) != null && numOr(a[1]) != null ? [Number(a[0]), Number(a[1])] : null;
};

/** The circles of an area drawn as arcs ([[lat, lon], radius m, [from°, to°]]), one per centre. */
function circlesOfArcs(area: unknown): Circle[] {
  const out: Circle[] = [];
  for (const a of arr(obj(area)?.arc)) {
    const [c, r] = arr(a);
    const ll = latLon(c);
    const m = numOr(r);
    if (!ll || m == null) continue;
    if (!out.some((x) => x.lat === ll[0] && x.lon === ll[1])) out.push({ lat: ll[0], lon: ll[1], km: m / 1000 });
  }
  return out;
}

/** One typhoon from its two JSON files; null when they do not read as expected. */
export function parseTyphoon(tc: string, forecast: unknown, spec: unknown): TyphoonNow | null {
  const f = arr(forecast);
  const s = arr(spec);
  const title = obj(s.find((e) => obj(e)?.part === "title") ?? f.find((e) => obj(e)?.part === "title"));
  const now = obj(s.find((e) => numOr(obj(e)?.advancedHours) === 0));
  const fNow = obj(f.find((e) => numOr(obj(e)?.advancedHours) === 0));
  const pos = latLon(obj(now?.position)?.deg) ?? latLon(fNow?.center);
  if (!title || !pos) return null;
  const number = Number(String(title.typhoonNumber ?? "").slice(-2));
  const gale = obj(fNow?.galeWarningArea);
  const galeCenter = latLon(gale?.center);
  const galeM = numOr(gale?.radius);
  const stormNow = circlesOfArcs(fNow?.stormWarningArea);
  const later = f.map(obj).filter((e): e is J => !!e && (numOr(e.advancedHours) ?? 0) > 0);
  const warning: Circle[] = [];
  for (const e of later)
    for (const c of circlesOfArcs(e.stormWarningArea)) if (!warning.some((x) => x.lat === c.lat && x.lon === c.lon)) warning.push(c);
  const ahead = later.map((e) => {
    const r = numOr(obj(e.probabilityCircle)?.radius);
    return { validtime: str(obj(e.validtime)?.JST) ?? "", hours: numOr(e.advancedHours) ?? 0, center: latLon(e.center), circleKm: r == null ? null : r / 1000 };
  });
  const wind = obj(now?.maximumWind);
  return {
    tc,
    number: Number.isFinite(number) ? number : 0,
    name: str(obj(title.name)?.jp) ?? "",
    category: str(obj(now?.category)?.jp) ?? str(obj(title.category)?.jp) ?? "台風",
    scale: str(now?.scale),
    intensity: str(now?.intensity),
    issued: str(obj(title.issue)?.JST) ?? "",
    at: { lat: pos[0], lon: pos[1], location: str(now?.location), course: str(now?.course), speedKmh: numOr(obj(now?.speed)?.["km/h"]) },
    pressure: numOr(now?.pressure),
    wind: numOr(obj(obj(wind?.sustained))?.["m/s"]),
    gust: numOr(obj(obj(wind?.gust))?.["m/s"]),
    gale: galeCenter && galeM != null ? { lat: galeCenter[0], lon: galeCenter[1], km: galeM / 1000 } : null,
    storm: stormNow[0] ?? null,
    warning,
    ahead,
  };
}

const inCircle = (c: Circle, lat: number, lon: number) => distanceBearing(c.lat, c.lon, lat, lon).km <= c.km;

/**
 * Inside the hull of two circles: the circles along the line between them, their radii drawn
 * straight (the hull of two discs is exactly that). Looked at in 1% steps.
 */
function inHull(a: Circle, b: Circle, lat: number, lon: number): boolean {
  const { km, bearing } = distanceBearing(a.lat, a.lon, b.lat, b.lon);
  for (let i = 0; i <= 100; i++) {
    const f = i / 100;
    const c = destination(a.lat, a.lon, bearing, km * f);
    if (distanceBearing(c.lat, c.lon, lat, lon).km <= a.km + (b.km - a.km) * f) return true;
  }
  return false;
}

export interface StationOnTyphoon {
  /** Inside the 強風域 / 暴風域 now. */
  gale: boolean;
  storm: boolean;
  /** Inside the 暴風警戒域 (JMA's, up to its last forecast time). */
  warning: boolean;
  /** How far the centre is now (km). */
  km: number;
}

/** Where the station stands in JMA's areas for this typhoon. */
export function stationOnTyphoon(t: TyphoonNow, lat: number, lon: number): StationOnTyphoon {
  const cs = t.warning;
  const warning = cs.some((c) => inCircle(c, lat, lon)) || cs.some((c, i) => i > 0 && inHull(cs[i - 1], c, lat, lon));
  return {
    gale: !!t.gale && inCircle(t.gale, lat, lon),
    storm: !!t.storm && inCircle(t.storm, lat, lon),
    warning,
    km: distanceBearing(t.at.lat, t.at.lon, lat, lon).km,
  };
}

/** Whether a typhoon is worth a card at the station: in an area now or ahead, or its centre within 1000 km. */
export const typhoonConcerns = (s: StationOnTyphoon) => s.gale || s.storm || s.warning || s.km <= 1000;
