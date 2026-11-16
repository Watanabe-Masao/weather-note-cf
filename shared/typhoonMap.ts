// 台風の詳細 (#220): what the typhoon sheet draws and says, kept apart from the screen so it can be
// tested — the map's projection (km around the station), the coast cut to the view, the station's
// hours inside a typhoon's areas (the best track or the telegrams, shared/typhoon.ts), and, for each
// announcement kept, the hours JMA's 暴風警戒域 held the station. Nothing is forecast here: JMA's
// circles are read as given, and between two of its forecast times the circle is drawn straight
// (the band JMA draws between them).
// 出典：気象庁（ベストトラック／防災情報XML）、地図：Natural Earth。

import {
  destination,
  distanceBearing,
  hourly,
  inside,
  type Storm,
} from "./typhoon";
import type { XmlCircle } from "./typhoonXml";

const KM_DEG = 111.2;
const H = 3_600_000;

/** A flat map in km around a point (equirectangular at its latitude: true enough over 2000 km). */
export function projection(lat0: number, lon0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180) * KM_DEG;
  return (lat: number, lon: number): [number, number] => [
    (lon - lon0) * k,
    -(lat - lat0) * KM_DEG,
  ];
}
export type Project = ReturnType<typeof projection>;

export interface Coast {
  v: 1;
  source: string;
  /** Each ring: lon, lat ×100, flat. */
  rings: number[][];
}

/** The coast as one SVG path (km), only the rings that reach into the view (a box in km). */
export function coastPath(
  coast: Coast,
  project: Project,
  view: { x: number; y: number; w: number; h: number },
): string {
  let d = "";
  for (const r of coast.rings) {
    const pts: [number, number][] = [];
    let near = false;
    for (let i = 0; i < r.length; i += 2) {
      const p = project(r[i + 1] / 100, r[i] / 100);
      if (
        p[0] > view.x - 50 &&
        p[0] < view.x + view.w + 50 &&
        p[1] > view.y - 50 &&
        p[1] < view.y + view.h + 50
      )
        near = true;
      pts.push(p);
    }
    if (near)
      d += `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`;
  }
  return d;
}

/** The station inside an area: 0 outside, 1 the 強風域, 2 the 暴風域. */
export type AreaLevel = 0 | 1 | 2;

export interface StormHour {
  /** UTC ms */
  t: number;
  lat: number;
  lon: number;
  pressure: number | null;
  km: number;
  level: AreaLevel;
  /** JMA's circles at that hour (the offset circle: its centre and radius, km). */
  gale: { lat: number; lon: number; km: number } | null;
  storm: { lat: number; lon: number; km: number } | null;
}

const circleOf = (
  r: { long: number; short: number; dir: number | null } | null,
  lat: number,
  lon: number,
) => {
  if (!r) return null;
  const c =
    r.dir == null
      ? { lat, lon }
      : destination(lat, lon, r.dir, (r.long - r.short) / 2);
  return { lat: c.lat, lon: c.lon, km: (r.long + r.short) / 2 };
};

/** The storm hour by hour (tropical stages only), with where the station stood. */
export function stormHours(
  storm: Storm,
  lat: number,
  lon: number,
): StormHour[] {
  return hourly(storm.points)
    .filter((p) => p.grade !== 6)
    .map((p) => ({
      t: p.t,
      lat: p.lat,
      lon: p.lon,
      pressure: p.pressure,
      km: distanceBearing(p.lat, p.lon, lat, lon).km,
      level: (p.r50 && inside(p.r50, p.lat, p.lon, lat, lon, "offset")
        ? 2
        : p.r30 && inside(p.r30, p.lat, p.lon, lat, lon, "offset")
          ? 1
          : 0) as AreaLevel,
      gale: circleOf(p.r30, p.lat, p.lon),
      storm: circleOf(p.r50, p.lat, p.lon),
    }));
}

/** The hours worth choosing on the map: into the 強風域, into the 暴風域, the nearest, out again. */
export function keyHours(hours: StormHour[]): { t: number; why: string }[] {
  if (!hours.length) return [];
  const out = new Map<number, string>();
  const firstGale = hours.find((h) => h.level >= 1);
  const firstStorm = hours.find((h) => h.level === 2);
  const nearest = hours.reduce((a, b) => (b.km < a.km ? b : a));
  const lastIn = [...hours].reverse().find((h) => h.level >= 1);
  // A day before it came near, so the map starts with the typhoon on its way.
  const before = hours.find((h) => h.t >= (firstGale ?? nearest).t - 24 * H);
  if (before && before.t < (firstGale ?? nearest).t) out.set(before.t, "前日");
  if (firstGale) out.set(firstGale.t, "強風域に入った");
  if (firstStorm) out.set(firstStorm.t, "暴風域に入った");
  if (!out.has(nearest.t)) out.set(nearest.t, "いちばん近い");
  if (lastIn && lastIn.t !== firstGale?.t) out.set(lastIn.t + H, "域を出た");
  return [...out].sort((a, b) => a[0] - b[0]).map(([t, why]) => ({ t, why }));
}

/** An announcement kept (a telegram, as /api/typhoon-telegrams gives it). */
export interface Announcement {
  issuedAt: string;
  times: {
    part: string;
    validAt: string;
    hours: number;
    lat: number | null;
    lon: number | null;
    storm: XmlCircle | null;
    gale: XmlCircle | null;
    warning: XmlCircle | null;
    probability: XmlCircle | null;
  }[];
}

/** The drawn circle of a telegram's area (its point, and the offset of two radii when given). */
export function drawnCircle(
  c: XmlCircle | null,
): { lat: number; lon: number; km: number } | null {
  if (!c) return null;
  const r = c.radius;
  const at =
    r.dir == null || r.long === r.short
      ? { lat: c.lat, lon: c.lon }
      : destination(c.lat, c.lon, r.dir, (r.long - r.short) / 2);
  return { lat: at.lat, lon: at.lon, km: (r.long + r.short) / 2 };
}

/**
 * The hours (UTC ms, on the hour) an announcement's 暴風警戒域 held the station: each forecast time's
 * circle, and between two of them the circle drawn straight hour by hour (the band between them).
 */
export function warningHours(
  a: Announcement,
  lat: number,
  lon: number,
): number[] {
  const cs = a.times
    .filter((x) => x.hours > 0 && x.warning)
    .map((x) => ({ t: Date.parse(x.validAt), c: drawnCircle(x.warning)! }))
    .filter((x) => Number.isFinite(x.t))
    .sort((p, q) => p.t - q.t);
  const out: number[] = [];
  const inC = (c: { lat: number; lon: number; km: number }) =>
    distanceBearing(c.lat, c.lon, lat, lon).km <= c.km;
  for (let i = 0; i < cs.length; i++) {
    const a0 = cs[i];
    const b0 = cs[i + 1];
    if (!b0) {
      if (inC(a0.c)) out.push(Math.round(a0.t / H) * H);
      break;
    }
    const steps = Math.max(1, Math.round((b0.t - a0.t) / H));
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      const c = {
        lat: a0.c.lat + (b0.c.lat - a0.c.lat) * f,
        lon: a0.c.lon + (b0.c.lon - a0.c.lon) * f,
        km: a0.c.km + (b0.c.km - a0.c.km) * f,
      };
      if (inC(c)) out.push(Math.round((a0.t + k * H) / H) * H);
    }
  }
  return out;
}

/** Where the station stood at the announcement's own analysis: 0 / 強風域 1 / 暴風域 2. */
export function analysisLevel(
  a: Announcement,
  lat: number,
  lon: number,
): AreaLevel {
  const now = a.times.find((x) => x.hours === 0);
  if (!now) return 0;
  const at = (c: XmlCircle | null) => {
    const d = drawnCircle(c);
    return !!d && distanceBearing(d.lat, d.lon, lat, lon).km <= d.km;
  };
  return at(now.storm) ? 2 : at(now.gale) ? 1 : 0;
}

/**
 * The announcements worth a line: each one whose word for the station differs from the one before
 * (when the 暴風警戒域 held it, and where it stood then), the latest kept too. Oldest first.
 */
export function announcementLines(
  list: Announcement[],
  lat: number,
  lon: number,
) {
  const sorted = [...list].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
  const lines: { a: Announcement; hours: number[]; level: AreaLevel }[] = [];
  let last = "";
  sorted.forEach((a, i) => {
    const hours = warningHours(a, lat, lon);
    const level = analysisLevel(a, lat, lon);
    const key = `${level}:${hours.length ? `${hours[0]}-${hours[hours.length - 1]}` : "-"}`;
    if (key !== last || i === sorted.length - 1)
      lines.push({ a, hours, level });
    last = key;
  });
  return lines;
}
