// 強風・暴風 (#175): a day's (or an hour's) wind against the Japan Meteorological Agency's warning
// criteria for Kochi city, so a typhoon or a strong low stands out from an ordinary rainy day.
//
// The inputs are those both records and forecasts carry (the data rule): the strongest 10-minute
// mean wind (JMA's 最大風速; the forecast's strongest hourly wind) and the strongest gust
// (最大瞬間風速). The 天気概況's 「暴風を伴う」 is in records only, so it is not used here.
//
// Criteria (気象庁「警報・注意報発表基準一覧表」高知市, mean wind on land): 強風注意報 12 m/s,
// 暴風警報 20 m/s. A gust is about 1.5–2 times the mean, so a gust of 20 m/s marks 強風 and 30 m/s
// 暴風 as well: Typhoon No.14 (2022) gave Kochi a mean of 11.6 but a gust of 23.0, and the low of
// 9 April 2024 a mean of 14.4 and a gust of 24.8 (高知地方気象台).

export type StormLevel = "strong" | "storm";

export const STORM = {
  strong: { label: "強風", mean: 12, gust: 20 },
  storm: { label: "暴風", mean: 20, gust: 30 },
} as const;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The level a day or an hour reaches, from its strongest mean wind and its strongest gust. */
export function stormLevel(windMax: unknown, gust: unknown): StormLevel | null {
  const m = num(windMax);
  const g = num(gust);
  if ((m != null && m >= STORM.storm.mean) || (g != null && g >= STORM.storm.gust)) return "storm";
  if ((m != null && m >= STORM.strong.mean) || (g != null && g >= STORM.strong.gust)) return "strong";
  return null;
}

/** A day's level from its row (daily windMax and gust). */
export const stormOfRow = (row: Record<string, unknown> | null | undefined): StormLevel | null =>
  row ? stormLevel(row.windMax, row.gust) : null;

/** Why, in words: "最大風速 14.4 m/s・最大瞬間 24.8 m/s". */
export function stormReason(windMax: unknown, gust: unknown): string {
  const m = num(windMax);
  const g = num(gust);
  return [m != null ? `最大風速 ${m.toFixed(1)} m/s` : null, g != null ? `最大瞬間 ${g.toFixed(1)} m/s` : null].filter(Boolean).join("・");
}
