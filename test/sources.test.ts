import { describe, expect, it } from "vitest";
import { aggregateRecentDay, parseLivePoint, type PointData } from "../worker/src/amedas";
import { normalizeForecast } from "../worker/src/open-meteo";
import { fixtureJson as json } from "./fixture";


describe("Open-Meteo forecast", () => {
  const { rows, hourlyRows } = normalizeForecast(json("forecast.json"));

  it("gives one daily row per forecast day with JMA field names", () => {
    expect(rows.map((r) => r.date)).toEqual([
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    for (const r of rows) {
      expect(r.type).toBe("forecast");
      expect(typeof r.max).toBe("number");
      expect(typeof r.dayWeather).toBe("string");
    }
  });

  it("numbers hours 1-24 like JMA, with 00:00 as hour 24 of the day before", () => {
    expect(hourlyRows.every((h) => h.n >= 1 && h.n <= 24)).toBe(true);
    const first = hourlyRows[0];
    expect(first).toMatchObject({ date: "2026-11-07", n: 24 });
    const nov9 = hourlyRows.filter((h) => h.date === "2026-11-09");
    expect(nov9.map((h) => h.n)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });
});

describe("AMeDAS observations", () => {
  const evening = json<PointData>("current-observations.json");
  const midnight = json<PointData>("midnight-observations.json");

  it("keeps the latest 10-minute observation and on-the-hour rows", () => {
    const { rows, latest } = parseLivePoint(evening, "2026-11-08");
    expect(latest?.observedAt).toBe("23:40");
    expect(rows.map((r) => r.n)).toEqual([21, 22, 23]);
  });

  it("reads the observed weather on the hour (only the codes checked, KC-05) and the visibility in km", () => {
    const { rows } = parseLivePoint(evening, "2026-11-08");
    expect(rows.map((r) => r.weather)).toEqual(["曇", "曇", "曇"]);
    expect(rows[0].visibility).toBe(20);
    // 確かめていない番号は文字にしない（予報の天気を借りる）。
    const odd = { "20261108210000": { ...evening["20261108210000"], weather: [3, 0] } } as PointData;
    expect(parseLivePoint(odd, "2026-11-08").rows[0].weather).toBeUndefined();
  });

  it("uses the 24:00 closing record for max, min and rain when it is available", () => {
    const { daily, hourly } = aggregateRecentDay({ ...evening, ...midnight }, "2026-11-08");
    expect(hourly.at(-1)).toMatchObject({ n: 24, observedAt: "24:00" });
    expect(daily.quality.max).toBe("normal");
    expect(daily.provisional).toBe(true);
    expect(daily.dayWeather).toBeNull();
  });

  it("marks values from a partial day as partial", () => {
    const { daily } = aggregateRecentDay(evening, "2026-11-08");
    expect(daily.quality.temp).toBe("partial");
  });
});

describe("Open-Meteo daily totals from the hourly forecast", () => {
  const times = Array.from({ length: 24 }, (_, i) => `2026-11-10T${String(i + 1).padStart(2, "0")}:00`.replace("T24", "T00"));
  // 24 hours of 2026-11-10 (01:00 … 24:00, the last written as the next day's 00:00).
  times[23] = "2026-11-11T00:00";
  const payload = {
    hourly: {
      time: times,
      temperature_2m: times.map(() => 10),
      shortwave_radiation: times.map((_, i) => (i >= 6 && i < 18 ? 250 : 0)),
      snowfall: times.map((_, i) => (i === 3 ? 1.4 : 0)),
    },
    daily: { time: ["2026-11-10"], temperature_2m_max: [12], temperature_2m_min: [8] },
  };

  it("adds radiation (MJ/㎡) and snowfall (cm) for complete days", () => {
    const { rows } = normalizeForecast(payload);
    expect(rows[0].radiation).toBe(10.8); // 12 h × 250 W/㎡ × 3600 s
    expect(rows[0].snow).toBe(1.4);
  });

  it("shows the forecast visibility in km stopped at 20, and keeps the whole value for judging", () => {
    const { hourlyRows } = normalizeForecast({ ...payload, hourly: { ...payload.hourly, visibility: payload.hourly.time.map((_, i) => (i === 1 ? 43_500 : 6_150)) } });
    expect(hourlyRows[1]).toMatchObject({ visibility: 20, visibilityFull: 43.5 });
    expect(hourlyRows[2]).toMatchObject({ visibility: 6.2, visibilityFull: 6.2 });
  });

  it("leaves snow empty when the API did not send it", () => {
    const { rows } = normalizeForecast({ ...payload, hourly: { ...payload.hourly, snowfall: undefined } });
    expect(rows[0].snow).toBeNull();
    expect(rows[0].radiation).toBe(10.8);
  });
});

describe("AMeDAS observations just after midnight", () => {
  it("is no observation yet (not a failure) while JMA's latest time is still the day before", async () => {
    const { observations } = await import("../worker/src/amedas");
    const { jstToday } = await import("../shared/dates");
    const today = jstToday();
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url));
      if (String(url).endsWith("amedastable.json"))
        return new Response(JSON.stringify({ "74182": { kjName: "高知", type: "A", lat: [33, 33.4], lon: [133, 32.9] } }));
      if (String(url).endsWith("latest_time.txt")) return new Response(`${yesterday}T23:50:00+09:00`);
      return new Response("", { status: 404 });
    }) as typeof fetch;
    try {
      const r = await observations({ precNo: 74, blockNo: "47893", name: "高知", prefecture: "高知県", lat: [33, 33.4], lon: [133, 32.9] }, today);
      expect(r.rows).toEqual([]);
      expect(r.latest).toBeNull();
      expect(seen.some((u) => u.includes("/data/point/"))).toBe(false);
    } finally {
      globalThis.fetch = real;
    }
  });
});
