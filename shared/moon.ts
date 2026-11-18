// 月の計算（3D天球の土台、2026-11-18）：月の高度・方位、月の出・南中・月の入り、月齢・輝面比（照らされている割合）。
// 計算は Astronomy Engine（MIT、2.1.19）。月の位置は難しいので自前では作らない。国立天文台の暦（各地のこよみ）と
// 照らし合わせるテスト：test/data/moon.test.ts（高知 2026年11月、出入り・南中は2分以内、方位は1°以内）。
// 時刻は分（その日の 0:00 JST から）。出・入りが無い日（月の出入りは毎日約50分ずつ遅れ、ひと月に1回ずつ無い日がある）は
// null で、計算できなかったのとは分ける（none：その日に無い）。

import { AstroTime, Body, Equator, Horizon, Illumination, Observer, SearchHourAngle, SearchMoonPhase, SearchRiseSet } from "astronomy-engine";

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
