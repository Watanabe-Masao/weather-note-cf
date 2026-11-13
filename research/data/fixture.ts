// A small, made-up export (two people, a few reports each), for the tests and for trying the
// scripts without real data:  npm run fixture  → raw/ds-fixture.json
import { MODEL_VERSION } from "../../src/beta/comfort";
import { type Report, SCALE_VERSION } from "../../src/beta/reports";
import type { Export } from "./transform";

const snapshot = (hour: number, temp: number, from: "amedas" | "forecast" = "amedas") => ({
  date: "2026-11-12",
  hour,
  temp,
  humidity: 60,
  wind: 2,
  solar: 300,
  from: { temp: from, humidity: from, wind: from, solar: "forecast" },
  sunTemp: temp + 3,
  shadeTemp: temp - 1,
  forecastSky: "晴れ",
  forecastSkyCode: 1,
  transform: "feel-1",
});

export function makeReport(id: string, hour: number, temp: number, y: number, over: Partial<Report> = {}): Report {
  return {
    id,
    at: new Date(Date.parse(`2026-11-12T${String(hour).padStart(2, "0")}:10:00+09:00`)).toISOString(),
    station: "47893",
    sensation: y,
    exposure: "sun",
    windFelt: "weak",
    sky: "sunny",
    scaleVersion: SCALE_VERSION,
    snapshot: snapshot(hour, temp),
    baseline: { value: 15, forecastMixed: false, coverage: 1, alpha: 0.8 },
    history: Array.from({ length: 60 }, (_, i) => 15 + Math.sin(i / 9) * 3),
    recent: [],
    comfort: {
      probs: [0, 0.05, 0.2, 0.5, 0.2, 0.05, 0],
      mode: 0,
      expected: 0,
      state: { mu: 18, h: 3, g: 4, s: 0.7 },
      offset: 0,
      beyond: 0,
      models: [],
      n: 3,
      alpha: 0.8,
      at: Date.parse(`2026-11-12T${String(hour).padStart(2, "0")}:10:00+09:00`),
      version: MODEL_VERSION,
      learning: "provisional",
    },
    updatedAt: 1,
    ...over,
  } as unknown as Report;
}

export function makeExport(): Export {
  return {
    datasetId: "ds-fixture",
    exportedAt: Date.parse("2026-11-12T12:00:00+09:00"),
    rows: [
      { researchId: "aaaa", report: makeReport("a1", 8, 12, -2) },
      { researchId: "aaaa", report: makeReport("a2", 13, 19, 0) },
      { researchId: "aaaa", report: makeReport("a3", 15, 24, 2, { snapshot: snapshot(15, 24, "forecast") as never }) },
      { researchId: "bbbb", report: makeReport("b1", 9, 14, -1) },
      { researchId: "bbbb", report: makeReport("b2", 12, 21, 1, { scaleVersion: 2 }) },
    ],
    withdrawn: [],
  };
}
