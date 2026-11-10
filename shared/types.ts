// Shapes exchanged between the Worker and the app.

export type Quality = "normal" | "partial" | "insufficient" | "none" | "missing";

export interface Station {
  precNo: number;
  blockNo: string;
  name: string;
  prefecture: string;
  lat: [number, number];
  lon: [number, number];
}

/** One day (daily tables) or one hour (hourly tables) of JMA values. */
export interface WeatherRow {
  date: string;
  /** Day of month for daily rows, hour 1-24 for hourly rows. */
  n: number;
  type: "actual" | "forecast";
  provider: string;
  raw: Record<string, string>;
  quality: Record<string, Quality>;
  /** Columns that exist in the table but had no value yet (not yet published). */
  unpublished?: string[];
  provisional?: boolean;
  [field: string]: unknown;
}

export interface DailyMonthResponse {
  station: string;
  month: string;
  rows: WeatherRow[];
  /** Every day of the month is fixed and will not change. */
  fixed: boolean;
  source: string | null;
  fetchedAt: string;
}

export interface HourlyDay {
  date: string;
  rows: WeatherRow[];
  fixed: boolean;
  error?: string;
}

export interface HourlyResponse {
  station: string;
  days: HourlyDay[];
  fetchedAt: string;
}

export interface ApiError {
  error: string;
}
