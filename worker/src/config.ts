import { DATA_SHAPE } from "../../shared/versions";
import type { Station } from "../../shared/types";
import stationList from "../../shared/stations.json";

// The Worker entry (index.ts) may only export handlers, so shared values live here.
export const stations = stationList as Station[];
export const MAX_HOURLY_DAYS = 14;
export const HOURLY_CONCURRENCY = 3;

/** Edge cache keys carry the shared data shape, so the edge and the app are rebuilt together. */
export const CACHE_VERSION = `v${DATA_SHAPE}`;
