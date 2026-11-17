// 予報の履歴 (R6) の実績：アプリが今読んでいる気象庁の値（日の表と1時間ごとの表）を、予報と見比べる形にする。
// 1時間ごとの値は「その時刻までの1時間」（13時の値は 12〜13時）。区間は「始まりを含み終わりを含まない」で
// 数える（要件 R4）。気温は毎正時の値なので、日中 9〜18時の最高・朝 0〜9時の最低は毎正時の値から数える。

import type { WeatherRow } from "../../../shared/types";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface ActualHour {
  /** 1〜24（気象庁の表の「時」。h の値は h−1 時〜h 時） */
  h: number;
  precip: number | null;
  temp: number | null;
  wx: string | null;
}
export interface ActualDay {
  max: number | null;
  min: number | null;
  hours: ActualHour[];
}

/** 日の表の行と1時間ごとの表の行から。予報の行（まだ来ていない時間）は入れない：実績だけ。 */
export function actualOf(day: WeatherRow | null | undefined, hours: WeatherRow[] | null | undefined): ActualDay | null {
  const obs = (hours ?? []).filter((r) => r.type !== "forecast");
  const actualDay = day && day.type !== "forecast" ? day : null;
  if (!actualDay && !obs.length) return null;
  return {
    max: num(actualDay?.max),
    min: num(actualDay?.min),
    hours: obs
      .map((r) => ({
        h: r.n,
        precip: num(r.rain),
        temp: num(r.temp),
        // 予報の天気を借りた時間（正本管理）は、見たものではないので出さない。
        wx: typeof r.weather === "string" && r.weather && (r.origin as Record<string, string> | undefined)?.weather !== "forecast" ? r.weather : null,
      }))
      .sort((a, b) => a.h - b.h),
  };
}

/**
 * 予報と同じ範囲の気温の実績（要件 R4「気温の範囲」）。府県天気予報：日中 9〜18時の最高・朝 0〜9時の最低を
 * 毎正時の値から（0時の値は前の日の24時の値）。週間：0〜24時（日最高・日最低）。そろわなければ null。
 */
export function rangedTemps(kind: string, a: ActualDay | null, prev: ActualDay | null): { max: number | null; min: number | null } {
  if (!a) return { max: null, min: null };
  if (kind !== "VPFD51") return { max: a.max, min: a.min };
  const at = (from: number, to: number) => {
    const t = [...(from === 0 ? (prev?.hours ?? []).filter((x) => x.h === 24) : []), ...a.hours.filter((x) => x.h >= Math.max(from, 1) && x.h <= to)]
      .map((x) => x.temp)
      .filter((v): v is number => v != null);
    return t.length === to - from + 1 ? t : null;
  };
  const day = at(9, 18);
  const morning = at(0, 9);
  return { max: day ? Math.max(...day) : null, min: morning ? Math.min(...morning) : null };
}
