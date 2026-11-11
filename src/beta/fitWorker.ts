// Runs the comfort models' fitting off the main thread (it can take a second with many reports).
import { ensembleFromReports } from "./comfort";
import type { Report } from "./reports";

self.onmessage = (ev: MessageEvent<{ id: number; reports: Report[] }>) => {
  const { id, reports } = ev.data;
  (self as unknown as Worker).postMessage({ id, ensemble: ensembleFromReports(reports) });
};
