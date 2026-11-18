// 月の計算（3D天球の土台、2026-11-18）：月の高度・方位、月の出・南中・月の入り、月齢・輝面比（照らされている割合）。
// 計算は Astronomy Engine（MIT、2.1.19）。月の位置は難しいので自前では作らない。国立天文台の暦（各地のこよみ）と
// 照らし合わせるテスト：test/data/moon.test.ts（高知 2026年11月、出入り・南中は2分以内、方位は1°以内）。
// 時刻は分（その日の 0:00 JST から）。出・入りが無い日（月の出入りは毎日約50分ずつ遅れ、ひと月に1回ずつ無い日がある）は
// null で、計算できなかったのとは分ける（none：その日に無い）。

import { AstroTime, Body, Equator, GeoMoon, Horizon, Illumination, MoonPhase, NextMoonQuarter, Observer, SearchHourAngle, SearchMoonPhase, SearchMoonQuarter, SearchRiseSet } from "astronomy-engine";

const DAY_MS = 86_400_000;
const startOf = (date: string) => Date.parse(`${date}T00:00:00+09:00`);
const minutesIn = (date: string, d: Date) => (d.getTime() - startOf(date)) / 60_000;

/** 月の高さ（°、大気差を入れた見かけ）と方位（°、北0・東90） at a moment (ms). */
export function moonPosition(ms: number, lat: number, lon: number): { altitude: number; azimuth: number } {
  const obs = new Observer(lat, lon, 0);
  const t = new AstroTime(new Date(ms));
  const eq = Equator(Body.Moon, t, obs, true, true);
  const h = Horizon(t, obs, eq.ra, eq.dec, "normal");
  return { altitude: h.altitude, azimuth: h.azimuth };
}

export type MoonEvent = { at: number; azimuth: number } | null;

/**
 * その日（JST）の月の出・南中・月の入り：分（0:00 から）と方位、南中は高さ。その日に無ければ null。
 * 出・入りは月の上の縁が地平線（大気差あり）に来る時、南中は真南（時角 0）。
 */
export function moonTimes(date: string, lat: number, lon: number): { rise: MoonEvent; transit: (MoonEvent & { altitude: number }) | null; set: MoonEvent } {
  const obs = new Observer(lat, lon, 0);
  const start = new AstroTime(new Date(startOf(date)));
  const within = (d: Date | undefined | null) => d != null && d.getTime() < startOf(date) + DAY_MS;
  const event = (dir: 1 | -1): MoonEvent => {
    const r = SearchRiseSet(Body.Moon, obs, dir, start, 1);
    if (!r || !within(r.date)) return null;
    return { at: minutesIn(date, r.date), azimuth: moonPosition(r.date.getTime(), lat, lon).azimuth };
  };
  const tr = SearchHourAngle(Body.Moon, obs, 0, start);
  const transit = within(tr.time.date) ? { at: minutesIn(date, tr.time.date), azimuth: tr.hor.azimuth, altitude: tr.hor.altitude } : null;
  return { rise: event(1), transit, set: event(-1) };
}

/**
 * 月齢（日、直前の新月から）・輝面比（0〜1、照らされて見える割合）・位相角（°、0＝満月側…180＝新月側）at a moment.
 * 月齢は国立天文台の表と同じく、その時刻での値（表は正午）。
 */
export function moonPhase(ms: number): { age: number; illuminated: number; phaseAngle: number } {
  const t = new AstroTime(new Date(ms));
  const prevNew = SearchMoonPhase(0, t.AddDays(-30), 30);
  const age = prevNew ? (ms - prevNew.date.getTime()) / DAY_MS : NaN;
  const il = Illumination(Body.Moon, t);
  return { age, illuminated: il.phase_fraction, phaseAngle: il.phase_angle };
}

/** 4つの月相（新月・上弦・満月・下弦）：ある時刻から後の count 個（時刻は ms）。 */
export function moonQuarters(fromMs: number, count: number): { kind: 0 | 1 | 2 | 3; at: number }[] {
  const out: { kind: 0 | 1 | 2 | 3; at: number }[] = [];
  let q = SearchMoonQuarter(new Date(fromMs));
  for (let i = 0; i < count; i++) {
    out.push({ kind: q.quarter as 0 | 1 | 2 | 3, at: q.time.date.getTime() });
    q = NextMoonQuarter(q);
  }
  return out;
}
export const QUARTER_NAME = ["新月", "上弦", "満月", "下弦"] as const;

const AU_KM = 149_597_870.7;
const MOON_RADIUS_KM = 1737.4;
/** 地球の中心から月の中心までの距離（km）と、見かけの大きさ（直径、°）。 */
export function moonDistance(ms: number): { km: number; diameter: number } {
  const v = GeoMoon(new Date(ms));
  const km = Math.hypot(v.x, v.y, v.z) * AU_KM;
  return { km, diameter: (2 * Math.asin(MOON_RADIUS_KM / km) * 180) / Math.PI };
}

/**
 * 月の形の名前：太陽からの離角（0〜360°、MoonPhase）で8つ（新月・上弦・満月・下弦はその前後 6° 以内）、
 * 月齢（四捨五入）で昔からの呼び名があればそれも（三日月・十三夜・十六夜・立待月・居待月・寝待月・更待月）。
 */
export function moonShapeName(ms: number): { shape: string; old: string | null } {
  const e = MoonPhase(new Date(ms));
  const near = (c: number) => Math.abs(((e - c + 540) % 360) - 180) <= 6;
  const shape = near(0) || near(360) ? "新月" : near(90) ? "上弦の月" : near(180) ? "満月" : near(270) ? "下弦の月" : e < 90 ? "三日月形（満ちていく）" : e < 180 ? "満ちていく丸い月" : e < 270 ? "欠けていく丸い月" : "細い月（欠けていく）";
  const age = Math.round(moonPhase(ms).age);
  const OLD: Record<number, string> = { 2: "三日月", 12: "十三夜", 15: "十六夜", 16: "立待月", 17: "居待月", 18: "寝待月", 19: "更待月" };
  return { shape, old: OLD[age] ?? null };
}
