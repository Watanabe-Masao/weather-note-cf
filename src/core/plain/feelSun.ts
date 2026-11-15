// 学習なし版の肌感（日なた） (principles 0): material → 日照から推測した日射, 10 m の風 → feel.sun on
// top of feel.shade, with the settings' 周りの様子 and 日差しの強さ. Reads no answers.

import { type Estimate, evaluate, type Value } from "../estimate/engine";
import { feelSun } from "../estimate/feel-sun/formula";
import { feelSunSettings } from "../estimate/feel-sun/params";
import { radSunshine } from "../estimate/sun/formula";
import { RAD_SUNSHINE_STANDARD } from "../estimate/sun/params";
import { windTen } from "../estimate/wind-ten/formula";
import { windPersonSettings } from "../estimate/wind-person/params";
import { windTenSettings } from "../estimate/wind-ten/params";
import { hourInputs, type Site } from "../material/inputs";
import type { MaterialHour } from "../material/material";
import { shadeFeel } from "./feelShade";

export interface FeelSettingsLike {
  /** 周りの様子 (power-law exponent). */
  alpha: number;
  /** 日差しの強さ (share of the radiation the body takes). */
  absorb: number;
}

/**
 * The hours next to an hour (rad.sunshine reads their sunshine to tell a cloud apart, #208 H-02b).
 * Leave one out when it is not known at the time asked: an answer's hour has no "after" yet.
 */
export interface Neighbours {
  before?: MaterialHour | null;
  after?: MaterialHour | null;
}

const sunshineOf = (h: MaterialHour | null | undefined): Value =>
  h == null ? { absent: "noRow" } : h.values.sunshine != null ? { value: h.values.sunshine } : { absent: h.absent.sunshine ?? "notObserved" };

/** 日照から推測した日射 of an hour (W/m²). */
export function sunshineRadiation(hour: MaterialHour, site: Site, around: Neighbours = {}): Estimate {
  const x = hourInputs(hour, site);
  return evaluate(radSunshine, RAD_SUNSHINE_STANDARD, {
    hourStart: x.hourStart,
    lat: x.lat,
    lon: x.lon,
    sunshine: x.sunshine,
    rain: x.rain,
    sunshineBefore: sunshineOf(around.before),
    sunshineAfter: sunshineOf(around.after),
  });
}

/** 肌感（日なた） of an hour. */
export function sunFeel(hour: MaterialHour, site: Site, s: FeelSettingsLike, around: Neighbours = {}): Estimate {
  const x = hourInputs(hour, site);
  const shade = shadeFeel(hour, site, { windPerson: windPersonSettings(s.alpha) });
  const wind10 = evaluate(windTen, windTenSettings(s.alpha), { wind: x.wind, windHeight: x.windHeight });
  return evaluate(feelSun, feelSunSettings(s.absorb), { feelShade: shade, radSunshine: sunshineRadiation(hour, site, around), windTen: wind10 });
}
