import type { Station } from "../../shared/types";
import stationList from "./stations.json";

// The Worker entry (index.ts) may only export handlers, so shared values live here.
export const stations = stationList as Station[];
export const MAX_HOURLY_DAYS = 14;
export const HOURLY_CONCURRENCY = 3;

/** Bumped when parsed rows gain fields, so a year of edge-cached tables is read again (v2: snow, humidityMin, windMax). */
export const CACHE_VERSION = "v2";
