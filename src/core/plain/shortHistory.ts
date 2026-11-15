// 学習なし版の短期の履歴 (principles 0, 0b): for each hour, its 肌感, the short history of the hours
// before (history.short.ema) and how fast the 肌感 has been moving (feel.rate) — 日かげ or 日なた, as
// asked. Reads no answers. The hours are consecutive across midnight: pass the day before's evening.

import { type Estimate, evaluate, type Series, type Value } from "../estimate/engine";
import { feelRate } from "../estimate/feel-rate/formula";
import { FEEL_RATE_STANDARD } from "../estimate/feel-rate/params";
import { historyShort } from "../estimate/history-short/formula";
import { HISTORY_SHORT_STANDARD } from "../estimate/history-short/params";
import { windPersonSettings } from "../estimate/wind-person/params";
import type { Site } from "../material/inputs";
import type { MaterialHour } from "../material/material";
import { shadeFeel } from "./feelShade";
import { type FeelSettingsLike, sunFeel } from "./feelSun";

export type Exposure = "shade" | "sun";

export interface HourHistory {
  feel: Estimate;
  short: Estimate;
  rate: Estimate;
}

const asValue = (e: Estimate | null): Value => (e == null ? { absent: "noRow" } : "value" in e ? { value: e.value } : { absent: e.absent });

/** `hours` consecutive, oldest first (null: no row for that hour). One outcome per hour. */
export function shortHistories(hours: readonly (MaterialHour | null)[], site: Site, s: FeelSettingsLike, exposure: Exposure): HourHistory[] {
  // The hours are consecutive: each one's neighbours are the hours beside it in the list (the last
  // has no "after" — for an answer's hour it is not known yet).
  const feels = hours.map((h, i) =>
    h == null ? null : exposure === "sun" ? sunFeel(h, site, s, { before: hours[i - 1], after: hours[i + 1] }) : shadeFeel(h, site, { windPerson: windPersonSettings(s.alpha) }),
  );
  return feels.map((feel, i) => {
    const before: Series = { series: feels.slice(0, i).reverse().map(asValue) };
    const now: Estimate = feel ?? { absent: "missingInput", inputs: { hour: "noRow" }, trace: [] };
    return {
      feel: now,
      short: evaluate(historyShort, HISTORY_SHORT_STANDARD, { hourFeels: before }),
      rate: evaluate(feelRate, FEEL_RATE_STANDARD, { feel: now, hourFeels: before }),
    };
  });
}
