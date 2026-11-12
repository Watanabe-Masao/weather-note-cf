// MATH-02: the quality of a report's weather inputs, and whether the report is used for learning.
//
// A report keeps everything it was made with (the snapshot never changes afterwards). From it,
// this decides, the same way every time:
//   - status of the temperature used: 確定 / 速報 (observed) or 予報 (forecast) or missing;
//   - the lag between the observed hour and the moment of the report;
//   - flags: what is unusual about the inputs;
//   - whether the report teaches the model, and if not, why.
// A report left out of learning is still kept, shown and exported, with its reason.

import type { Origin } from "../data/authority";
import type { Report } from "./reports";

/** Observations older than this (minutes before the report) are not taken as "now". */
export const MAX_LAG_MIN = 120;

export type InputStatus = "fixed" | "observed" | "forecast" | "missing";

export interface InputQuality {
  status: InputStatus;
  /** Minutes from the observed hour to the report (null without a snapshot). */
  lagMin: number | null;
  flags: string[];
  /** Used for learning? If not, the reason (Japanese, for people). */
  trainable: boolean;
  reason: string | null;
}

const statusOf = (o: Origin | undefined): InputStatus =>
  o === "jma-fixed" ? "fixed" : o === "jma" || o === "amedas" ? "observed" : o === "forecast" ? "forecast" : "missing";

/** The JST time of the observed hour (JMA hour n = the value at n:00 of the date; 24 = next 0:00). */
export function observedAt(date: string, hour: number): number {
  return Date.parse(`${date}T00:00:00+09:00`) + hour * 3_600_000;
}

export function inputQuality(r: Report): InputQuality {
  const s = r.snapshot;
  if (!s || s.temp == null) return { status: "missing", lagMin: null, flags: ["no-snapshot"], trainable: false, reason: "その時刻の気温がない" };
  const status = statusOf(s.from.temp);
  const lagMin = Math.round((Date.parse(r.at) - observedAt(s.date, s.hour) - (s.minute ?? 0) * 60_000) / 60_000);
  const flags: string[] = [];
  if (status === "forecast") flags.push("temp-forecast");
  if (lagMin > MAX_LAG_MIN) flags.push("stale");
  if (lagMin < -60) flags.push("future");
  if (s.humidity == null) flags.push("humidity-missing");
  if (s.wind == null) flags.push("wind-missing");
  if (s.solar == null) flags.push("solar-missing");
  if (s.from.solar === "forecast") flags.push("solar-lent"); // AMeDAS has no radiation: normal, noted
  const kinds = new Set(Object.values(s.from).map(statusOf));
  if (kinds.has("forecast") && (kinds.has("observed") || kinds.has("fixed"))) flags.push("mixed-sources");
  if (!r.baseline) flags.push("no-baseline");
  if (!r.history?.length) flags.push("no-history");

  const reason =
    status === "forecast"
      ? "気温が予報の値（観測がまだない）"
      : lagMin > MAX_LAG_MIN
        ? `観測が記録より${Math.round(lagMin / 60)}時間以上前`
        : lagMin < -60
          ? "観測の時刻が記録より後"
          : !r.history?.length
            ? "最近の基準の履歴がない"
            : s.sunTemp == null && s.shadeTemp == null
              ? "日なた温度・日かげ温度が計算できない"
              : null;
  return { status, lagMin, flags, trainable: reason == null, reason };
}
