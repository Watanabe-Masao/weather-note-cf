import type { Station } from "../../shared/types";
import stationList from "./stations.json";

// The Worker entry (index.ts) may only export handlers, so shared values live here.
export const stations = stationList as Station[];
export const MAX_HOURLY_DAYS = 14;
export const HOURLY_CONCURRENCY = 3;
