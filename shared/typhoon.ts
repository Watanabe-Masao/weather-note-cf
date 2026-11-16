// 台風の進路 (#220): JMA's RSMC Tokyo best track (bst_all.zip, the format of e_format_bst.html), read
// and set against a station: on which days (日本時間) the station lay inside a typhoon's 強風域 (the
// 30-knot wind, about 15 m/s) or 暴風域 (50 knots, about 25 m/s). The track is analysed every six
// hours (sometimes three); between two analyses the centre and the radii are drawn straight, hour by hour.
//
// A radius is given as its longest (with a direction) and its shortest. The area is the circle JMA
// draws (2026-11-16, #220): when the wind leans to one side, JMA moves the circle's centre off the
// typhoon's — its diameter the longest plus the shortest, its centre moved (longest − shortest) / 2
// toward the longest ("offset", 気象庁「台風の大きさと強さ」). Two others are kept to see how much the
// shape moves the days: the radius rising smoothly from the shortest to the longest ("ellipse"), and
// the longest all round ("circle"). TY-01 found ellipse and circle 28% apart, so the shape was chosen.
//
// Used by the month review (台風の日, from a compact copy of the track: public/data/typhoon-tracks.json,
// built by scripts/typhoon-tracks.ts) and by the check that chose the shape (research/typhoon, TY-01).
// 出典：気象庁 RSMC Tokyo ベストトラック。強風域・暴風域に入ったかの判定は Weather Note による。

export interface TrackPoint {
  /** UTC, ms. */
  t: number;
  grade: number;
  lat: number;
  lon: number;
  pressure: number | null;
  /** knots */
  wind: number | null;
  /** 50 kt (暴風) and 30 kt (強風) radii, km; dir = bearing of the longest (null = all round). */
  r50: Radius | null;
  r30: Radius | null;
  landfall: boolean;
}
export interface Radius {
  long: number;
  short: number;
  dir: number | null;
}
export interface Storm {
  /** International number yyNN: NN is the typhoon's number in Japan (台風◯号). */
  id: string;
  year: number;
  number: number;
  name: string;
  points: TrackPoint[];
}

const NM_KM = 1.852;
/** Direction codes 1–8 (NE…N) as bearings; 9 = all round; 0 = no radius. */
const BEARING: Record<string, number | null> = { "1": 45, "2": 90, "3": 135, "4": 180, "5": 225, "6": 270, "7": 315, "8": 0, "9": null };

const col = (line: string, from: number, to: number) => line.padEnd(80).slice(from - 1, to).trim();
const intOr = (s: string) => (s === "" ? null : Number(s));

function radius(dir: string, long: string, short: string): Radius | null {
  const l = intOr(long);
  if (dir === "" || dir === "0" || l == null || l === 0) return null;
  const s = intOr(short) ?? l;
  return { long: l * NM_KM, short: s * NM_KM, dir: BEARING[dir] ?? null };
}

/** The best track's text: header lines (66666) each followed by their data lines. */
export function parseBestTrack(text: string): Storm[] {
  const out: Storm[] = [];
  let cur: Storm | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    if (raw.startsWith("66666")) {
      const id = col(raw, 7, 10);
      const yy = Number(id.slice(0, 2));
      cur = { id, year: yy > 50 ? 1900 + yy : 2000 + yy, number: Number(id.slice(2)), name: col(raw, 31, 50), points: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const time = col(raw, 1, 8);
    const yy = Number(time.slice(0, 2));
    const t = Date.UTC(yy > 50 ? 1900 + yy : 2000 + yy, Number(time.slice(2, 4)) - 1, Number(time.slice(4, 6)), Number(time.slice(6, 8)));
    cur.points.push({
      t,
      grade: Number(col(raw, 14, 14)),
      lat: Number(col(raw, 16, 18)) / 10,
      lon: Number(col(raw, 20, 23)) / 10,
      pressure: intOr(col(raw, 25, 28)),
      wind: intOr(col(raw, 34, 36)),
      r50: radius(col(raw, 42, 42), col(raw, 43, 46), col(raw, 48, 51)),
      r30: radius(col(raw, 53, 53), col(raw, 54, 57), col(raw, 59, 62)),
      landfall: col(raw, 72, 72) !== "",
    });
  }
  return out;
}

const R_EARTH = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance (km) and the bearing from the first point to the second (degrees, 0 = N). */
export function distanceBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  const km = 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  return { km, bearing: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 };
}

export type Shape = "offset" | "ellipse" | "circle";
/** The radius toward a bearing ("ellipse" and "circle"; "offset" is not a radius from the centre). */
export function radiusToward(r: Radius, bearing: number, shape: Exclude<Shape, "offset">): number {
  if (shape === "circle" || r.dir == null) return r.long;
  return r.short + ((r.long - r.short) * (1 + Math.cos(rad(bearing - r.dir)))) / 2;
}

/** The point `km` from (lat, lon) toward `bearing` (degrees), on the sphere. */
export function destination(lat: number, lon: number, bearing: number, km: number) {
  const d = km / R_EARTH;
  const b = rad(bearing);
  const p1 = rad(lat);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = rad(lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: (p2 * 180) / Math.PI, lon: (l2 * 180) / Math.PI };
}

/** Whether the station lies inside the area the radius gives, around a centre at (lat, lon). */
export function inside(r: Radius, lat: number, lon: number, sLat: number, sLon: number, shape: Shape): boolean {
  if (shape !== "offset") {
    const { km, bearing } = distanceBearing(lat, lon, sLat, sLon);
    return km <= radiusToward(r, bearing, shape);
  }
  if (r.dir == null) return distanceBearing(lat, lon, sLat, sLon).km <= r.long;
  const c = destination(lat, lon, r.dir, (r.long - r.short) / 2);
  return distanceBearing(c.lat, c.lon, sLat, sLon).km <= (r.long + r.short) / 2;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
function lerpRadius(a: Radius | null, b: Radius | null, f: number): Radius | null {
  if (!a && !b) return null;
  // A radius that starts or ends between two analyses grows from (or shrinks to) nothing.
  const z = { long: 0, short: 0, dir: (a ?? b)!.dir };
  const p = a ?? z;
  const q = b ?? z;
  const long = lerp(p.long, q.long, f);
  return long > 0 ? { long, short: lerp(p.short, q.short, f), dir: f < 0.5 ? p.dir : q.dir } : null;
}

/** The track hour by hour (UTC ms), straight between analyses. */
export function hourly(points: TrackPoint[]): TrackPoint[] {
  const out: TrackPoint[] = [];
  const H = 3_600_000;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const steps = Math.max(1, Math.round((b.t - a.t) / H));
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      out.push({
        t: a.t + k * H,
        grade: f < 0.5 ? a.grade : b.grade,
        lat: lerp(a.lat, b.lat, f),
        lon: lerp(a.lon, b.lon, f),
        pressure: a.pressure != null && b.pressure != null ? lerp(a.pressure, b.pressure, f) : (a.pressure ?? b.pressure),
        wind: a.wind != null && b.wind != null ? lerp(a.wind, b.wind, f) : (a.wind ?? b.wind),
        r50: lerpRadius(a.r50, b.r50, f),
        r30: lerpRadius(a.r30, b.r30, f),
        landfall: a.landfall && k === 0,
      });
    }
  }
  if (points.length) out.push(points[points.length - 1]);
  return out;
}

export interface TyphoonDay {
  /** 日本時間 YYYY-MM-DD */
  date: string;
  storm: Pick<Storm, "id" | "year" | "number" | "name">;
  /** Inside the 強風域 / 暴風域 at some hour of the day. */
  gale: boolean;
  violent: boolean;
  /** The nearest the centre came that day (km), and its pressure then (hPa). */
  nearestKm: number;
  pressure: number | null;
}

const jstDate = (t: number) => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);

/**
 * The days a storm came within `withinKm` of the station, with whether the station lay inside its
 * 強風域 / 暴風域. Only tropical stages count (grades 2–5, 9): an extratropical low (6) is no typhoon.
 */
export function typhoonDays(storm: Storm, lat: number, lon: number, shape: Shape = "offset", withinKm = 500): TyphoonDay[] {
  const days = new Map<string, TyphoonDay>();
  for (const p of hourly(storm.points)) {
    if (p.grade === 6) continue;
    const { km } = distanceBearing(p.lat, p.lon, lat, lon);
    const gale = p.r30 != null && inside(p.r30, p.lat, p.lon, lat, lon, shape);
    const violent = p.r50 != null && inside(p.r50, p.lat, p.lon, lat, lon, shape);
    if (km > withinKm && !gale) continue;
    const date = jstDate(p.t);
    const d = days.get(date) ?? { date, storm: { id: storm.id, year: storm.year, number: storm.number, name: storm.name }, gale: false, violent: false, nearestKm: Infinity, pressure: null };
    d.gale ||= gale;
    d.violent ||= violent;
    if (km < d.nearestKm) {
      d.nearestKm = km;
      d.pressure = p.pressure;
    }
    days.set(date, d);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---- the compact copy the app reads (public/data/typhoon-tracks.json) ------------------------------

/**
 * One analysis as numbers: hours since 1970 (UTC), grade, lat×10, lon×10, pressure (0 = none), and
 * the 30-kt and 50-kt radii as [longest km, shortest km, bearing (−1 = all round)] (empty = none).
 */
export type CompactPoint = [number, number, number, number, number, number[], number[]];
export interface CompactStorm {
  /** year, number (台風◯号), name */
  y: number;
  n: number;
  name: string;
  p: CompactPoint[];
}
export interface CompactTracks {
  v: 1;
  /** 出典 and when it was built (UTC ISO). */
  source: string;
  built: string;
  storms: CompactStorm[];
}

const H = 3_600_000;
const packRadius = (r: Radius | null) => (r ? [Math.round(r.long), Math.round(r.short), r.dir ?? -1] : []);
const unpackRadius = (a: number[]): Radius | null => (a.length ? { long: a[0], short: a[1], dir: a[2] < 0 ? null : a[2] } : null);

/**
 * The storms the app needs, small: tropical stages only kept where they matter (a storm is kept
 * whole when any of its points comes within `nearKm` of the box around Japan, so its hours can be filled).
 */
export function compactTracks(storms: Storm[], built: string, box = { lat: [20, 50], lon: [120, 155] }): CompactTracks {
  const near = (p: TrackPoint) => p.lat >= box.lat[0] && p.lat <= box.lat[1] && p.lon >= box.lon[0] && p.lon <= box.lon[1];
  return {
    v: 1,
    source: "気象庁 RSMC Tokyo ベストトラック",
    built,
    storms: storms
      .filter((s) => s.points.some((p) => p.grade !== 6 && near(p)))
      .map((s) => ({
        y: s.year,
        n: s.number,
        name: s.name,
        p: s.points.map((p): CompactPoint => [Math.round(p.t / H), p.grade, Math.round(p.lat * 10), Math.round(p.lon * 10), p.pressure ?? 0, packRadius(p.r30), packRadius(p.r50)]),
      })),
  };
}

/** The compact copy back as storms (wind and landfall are not kept). */
export function expandTracks(c: CompactTracks): Storm[] {
  return c.storms.map((s) => ({
    id: `${String(s.y % 100).padStart(2, "0")}${String(s.n).padStart(2, "0")}`,
    year: s.y,
    number: s.n,
    name: s.name,
    points: s.p.map(([t, grade, lat, lon, pressure, r30, r50]) => ({
      t: t * H,
      grade,
      lat: lat / 10,
      lon: lon / 10,
      pressure: pressure || null,
      wind: null,
      r30: unpackRadius(r30),
      r50: unpackRadius(r50),
      landfall: false,
    })),
  }));
}

/** Every typhoon day of the storms at a station, by date (日本時間), one storm a day (the nearer). */
export function typhoonDaysAt(storms: Storm[], lat: number, lon: number, from: string, to: string): Map<string, TyphoonDay> {
  const out = new Map<string, TyphoonDay>();
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  for (const s of storms) {
    if (s.year < y0 - 1 || s.year > y1) continue;
    for (const d of typhoonDays(s, lat, lon)) {
      if (d.date < from || d.date > to) continue;
      const had = out.get(d.date);
      // Two storms on one day: the one whose area held the station, else the nearer.
      const rank = (x: TyphoonDay) => (x.violent ? 2 : x.gale ? 1 : 0);
      if (!had || rank(d) > rank(had) || (rank(d) === rank(had) && d.nearestKm < had.nearestKm)) out.set(d.date, d);
    }
  }
  return out;
}

/**
 * The last day (JST) the best track covers: its newest storm's last analysis. JMA adds a season's
 * storms some months after (the copy of 28 October 2026 ends at 17号), so a later typhoon is not in
 * it yet — "no typhoon day" after this date means "not known yet".
 */
export function tracksEnd(storms: Storm[]): string | null {
  let t = -Infinity;
  for (const s of storms) for (const p of s.points) if (p.t > t) t = p.t;
  return Number.isFinite(t) ? new Date(t + 9 * 3_600_000).toISOString().slice(0, 10) : null;
}
