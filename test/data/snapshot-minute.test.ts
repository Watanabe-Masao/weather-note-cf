// The temperature at the moment of the answer (12:15 → the 12:10 observation, not 12:00).
import { describe, expect, it } from "vitest";
import { inputQuality } from "../../src/beta/quality";
import { type Report, snapshotOf } from "../../src/beta/reports";
import type { WeatherRow } from "../../shared/types";

const hourRow = (n: number, temp: number): WeatherRow => ({ date: "2026-11-12", n, type: "actual", provider: "JMA-amedas", temp, humidity: 60, wind: 2, raw: {}, quality: {} }) as WeatherRow;
const tenMin = (hhmm: string, temp: number): WeatherRow => ({ ...hourRow(+hhmm.slice(0, 2), temp), observedAt: hhmm, humidity: 55, wind: 3 }) as WeatherRow;
const feel = { sun: true } as never;
const at = (hhmm: string) => Date.parse(`2026-11-12T${hhmm}:00+09:00`);

describe("the moment of the answer", () => {
  const rows = [hourRow(11, 18), hourRow(12, 19)];

  it("takes the latest 10-minute observation when it is newer than the hour", () => {
    const s = snapshotOf(rows, 12, feel, null, undefined, { latest: tenMin("12:10", 19.6), now: at("12:15") })!;
    expect(s.hour).toBe(12);
    expect(s.minute).toBe(10);
    expect(s.temp).toBe(19.6);
    expect(s.humidity).toBe(55);
    expect(s.from.temp).toBe("amedas");
    const q = inputQuality({ at: new Date(at("12:15")).toISOString(), snapshot: s, history: [0], baseline: null } as unknown as Report);
    expect(q.lagMin).toBe(5);
  });

  it("keeps the hour's value when the 10-minute one is older, of another day, or after the answer", () => {
    expect(snapshotOf(rows, 12, feel, null, undefined, { latest: tenMin("12:00", 19), now: at("12:15") })!.minute).toBeUndefined();
    expect(snapshotOf(rows, 12, feel, null, undefined, { latest: { ...tenMin("12:10", 25), date: "2026-11-11" } as WeatherRow, now: at("12:15") })!.temp).toBe(19);
    expect(snapshotOf(rows, 12, feel, null, undefined, { latest: tenMin("12:40", 25), now: at("12:15") })!.temp).toBe(19);
    expect(snapshotOf(rows, 12, feel)!.minute).toBeUndefined();
  });
});

describe("review 2026-11-12: the hour whose observation has not arrived, and the 0時台", () => {
  const fc = (n: number, temp: number, date = "2026-11-12") => ({ date, n, type: "forecast", provider: "Open-Meteo", temp, humidity: 60, wind: 2, raw: {}, quality: {} }) as WeatherRow;

  it("12:05 with the 12時 observation not in yet: the last observed hour and its 10-minute value, not the forecast", () => {
    const rows = [hourRow(10, 17), hourRow(11, 18), fc(12, 25), fc(13, 26)];
    const s = snapshotOf(rows, 12, feel, null, undefined, { latest: tenMin("11:50", 18.4), now: at("12:05") })!;
    expect([s.hour, s.minute, s.temp, s.from.temp]).toEqual([11, 50, 18.4, "amedas"]);
    const q = inputQuality({ at: new Date(at("12:05")).toISOString(), snapshot: s, history: [0], baseline: null } as unknown as Report);
    expect(q.status).toBe("observed");
    expect(q.lagMin).toBe(15);
  });

  it("12:15 with only a 12:10 value ahead of the 11時 row: the moment moves to 12時, minute 10", () => {
    const rows = [hourRow(11, 18), fc(12, 25)];
    const s = snapshotOf(rows, 12, feel, null, undefined, { latest: tenMin("12:10", 19.1), now: at("12:15") })!;
    expect([s.hour, s.minute, s.temp]).toEqual([12, 10, 19.1]);
  });

  it("0:30: the day before's 24時 with the 0:20 value of the new day, not tonight's forecast", () => {
    const yesterday = [hourRow(23, 12), hourRow(24, 11.5)].map((r) => ({ ...r, date: "2026-11-11" }));
    const latest = { ...tenMin("00:20", 11.2), date: "2026-11-12", n: 0 } as WeatherRow;
    const s = snapshotOf(yesterday, 24, feel, null, undefined, { latest, now: at("00:30") })!;
    expect([s.date, s.hour, s.minute, s.temp]).toEqual(["2026-11-11", 24, 20, 11.2]);
    const q = inputQuality({ at: new Date(at("00:30")).toISOString(), snapshot: s, history: [0], baseline: null } as unknown as Report);
    expect(q.lagMin).toBe(10);
    expect(q.trainable).toBe(true);
  });
});
