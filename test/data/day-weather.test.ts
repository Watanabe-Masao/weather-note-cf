// The day's weather estimated while JMA's 天気概況 is not out yet.
import { describe, expect, it } from "vitest";
import { dayLengthHours, dayWeatherOf, estimateDayWeather } from "../../shared/dayWeather";
import type { WeatherRow } from "../../shared/types";

const day = (over: Partial<WeatherRow>): WeatherRow => ({ date: "2026-11-11", n: 11, type: "actual", provider: "JMA", raw: {}, quality: {}, ...over }) as WeatherRow;

describe("estimated day weather", () => {
  it("knows the length of the day at the station (Kochi: about 10.5 h in mid November, 14.4 h at midsummer; 稚内 15.6 h)", () => {
    expect(dayLengthHours("2026-11-11", "47893")).toBeCloseTo(10.5, 0);
    expect(dayLengthHours("2026-06-21", "47893")).toBeCloseTo(14.4, 0);
    expect(dayLengthHours("2026-06-21", "47401")).toBeCloseTo(15.6, 0);
  });

  it("reads sunshine and precipitation (the case of 11/11: 10.1 h sun, no rain → 晴)", () => {
    expect(estimateDayWeather(day({ sun: 10.1, rain: 0 }), "47893")).toBe("晴");
    expect(estimateDayWeather(day({ sun: 4, rain: 0 }), "47893")).toBe("曇時々晴");
    expect(estimateDayWeather(day({ sun: 0.5, rain: 0 }), "47893")).toBe("曇");
    expect(estimateDayWeather(day({ sun: 0, rain: 12 }), "47893")).toBe("雨");
    expect(estimateDayWeather(day({ sun: 8, rain: 2 }), "47893")).toBe("晴時々雨");
    expect(estimateDayWeather(day({ sun: 1, rain: 0, snow: 2 }), "47893")).toBe("雪");
    expect(estimateDayWeather(day({ rain: 0 }), "47893")).toBeNull(); // no sunshine: no guess
  });

  it("JMA's summary always wins, and forecasts are never estimated", () => {
    expect(dayWeatherOf(day({ dayWeather: "曇一時雨", sun: 10 }), "47893")).toEqual({ text: "曇一時雨", estimated: false });
    expect(dayWeatherOf(day({ dayWeather: "", sun: 10.1, rain: 0 }), "47893")).toEqual({ text: "晴", estimated: true });
    expect(dayWeatherOf(day({ type: "forecast", sun: 10 }) as WeatherRow, "47893")).toEqual({ text: null, estimated: false });
  });
});

describe("band weather", () => {
  const hr = (n: number, over: Partial<WeatherRow> = {}) => ({ date: "2026-11-11", n, type: "actual", provider: "JMA", raw: {}, quality: {}, ...over }) as WeatherRow;
  it("uses the hours' weather text, rain first, else the most frequent", async () => {
    const { hoursWeather } = await import("../../shared/dayWeather");
    expect(hoursWeather([hr(12, { weather: "晴" }), hr(13, { weather: "雨" }), hr(14, { weather: "晴" })], [12, 13, 14], "47893")).toEqual({ text: "雨", estimated: false });
    expect(hoursWeather([hr(12, { weather: "曇" }), hr(13, { weather: "晴" }), hr(14, { weather: "曇" })], [12, 13, 14], "47893")).toEqual({ text: "曇", estimated: false });
  });
  it("estimates from sunshine in daylight and rain, never at night, never from a lent forecast", async () => {
    const { hoursWeather } = await import("../../shared/dayWeather");
    expect(hoursWeather([12, 13, 14].map((n) => hr(n, { sun: 0.9, rain: 0 })), [12, 13, 14], "47893")).toEqual({ text: "晴", estimated: true });
    expect(hoursWeather([12, 13, 14].map((n) => hr(n, { sun: 0, rain: 0.5 })), [12, 13, 14], "47893")).toEqual({ text: "雨", estimated: true });
    expect(hoursWeather([18, 19, 20].map((n) => hr(n, { sun: 0, rain: 0 })), [18, 19, 20], "47893")).toEqual({ text: null, estimated: false });
    const lent = [12, 13, 14].map((n) => hr(n, { sun: 0.1, rain: 0, weather: "晴", origin: { weather: "forecast" } } as never));
    expect(hoursWeather(lent, [12, 13, 14], "47893")).toEqual({ text: "曇", estimated: true });
  });
});

describe("review: a band half observed, half forecast", () => {
  it("speaks from the observed hours, not the forecast's text for the rest", async () => {
    const { hoursWeather } = await import("../../shared/dayWeather");
    const obs = { date: "2026-11-12", n: 12, type: "actual", provider: "JMA", sun: 1, rain: 0, raw: {}, quality: {} } as unknown as WeatherRow;
    const fc = { date: "2026-11-12", n: 13, type: "forecast", provider: "Open-Meteo", weather: "雨", raw: {}, quality: {} } as unknown as WeatherRow;
    expect(hoursWeather([obs, fc], [12, 13], "47893", 1)).toEqual({ text: "晴", estimated: true });
  });
});
