// The day's weather estimated while JMA's 天気概況 is not out yet.
import { describe, expect, it } from "vitest";
import { dayLengthHours, dayWeatherOf, estimateDayWeather } from "../../shared/dayWeather";
import type { WeatherRow } from "../../shared/types";

const day = (over: Partial<WeatherRow>): WeatherRow => ({ date: "2026-11-11", n: 11, type: "actual", provider: "JMA", raw: {}, quality: {}, ...over }) as WeatherRow;

describe("estimated day weather", () => {
  it("knows the length of the day (Kochi: about 10.5 h in mid November, 14.2 h at midsummer)", () => {
    expect(dayLengthHours("2026-11-11", 33.57)).toBeCloseTo(10.5, 0);
    expect(dayLengthHours("2026-06-21", 33.57)).toBeCloseTo(14.2, 0);
  });

  it("reads sunshine and precipitation (the case of 11/11: 10.1 h sun, no rain → 晴)", () => {
    expect(estimateDayWeather(day({ sun: 10.1, rain: 0 }), 33.57)).toBe("晴");
    expect(estimateDayWeather(day({ sun: 4, rain: 0 }), 33.57)).toBe("曇時々晴");
    expect(estimateDayWeather(day({ sun: 0.5, rain: 0 }), 33.57)).toBe("曇");
    expect(estimateDayWeather(day({ sun: 0, rain: 12 }), 33.57)).toBe("雨");
    expect(estimateDayWeather(day({ sun: 8, rain: 2 }), 33.57)).toBe("晴時々雨");
    expect(estimateDayWeather(day({ sun: 1, rain: 0, snow: 2 }), 33.57)).toBe("雪");
    expect(estimateDayWeather(day({ rain: 0 }), 33.57)).toBeNull(); // no sunshine: no guess
  });

  it("JMA's summary always wins, and forecasts are never estimated", () => {
    expect(dayWeatherOf(day({ dayWeather: "曇一時雨", sun: 10 }))).toEqual({ text: "曇一時雨", estimated: false });
    expect(dayWeatherOf(day({ dayWeather: "", sun: 10.1, rain: 0 }))).toEqual({ text: "晴", estimated: true });
    expect(dayWeatherOf(day({ type: "forecast", sun: 10 }) as WeatherRow)).toEqual({ text: null, estimated: false });
  });
});

describe("band weather", () => {
  const hr = (n: number, over: Partial<WeatherRow> = {}) => ({ date: "2026-11-11", n, type: "actual", provider: "JMA", raw: {}, quality: {}, ...over }) as WeatherRow;
  it("uses the hours' weather text, rain first, else the most frequent", async () => {
    const { hoursWeather } = await import("../../shared/dayWeather");
    expect(hoursWeather([hr(12, { weather: "晴" }), hr(13, { weather: "雨" }), hr(14, { weather: "晴" })], [12, 13, 14])).toEqual({ text: "雨", estimated: false });
    expect(hoursWeather([hr(12, { weather: "曇" }), hr(13, { weather: "晴" }), hr(14, { weather: "曇" })], [12, 13, 14])).toEqual({ text: "曇", estimated: false });
  });
  it("estimates from sunshine in daylight and rain, never at night, never from a lent forecast", async () => {
    const { hoursWeather } = await import("../../shared/dayWeather");
    expect(hoursWeather([12, 13, 14].map((n) => hr(n, { sun: 0.9, rain: 0 })), [12, 13, 14], 33.6)).toEqual({ text: "晴", estimated: true });
    expect(hoursWeather([12, 13, 14].map((n) => hr(n, { sun: 0, rain: 0.5 })), [12, 13, 14], 33.6)).toEqual({ text: "雨", estimated: true });
    expect(hoursWeather([18, 19, 20].map((n) => hr(n, { sun: 0, rain: 0 })), [18, 19, 20], 33.6)).toEqual({ text: null, estimated: false });
    const lent = [12, 13, 14].map((n) => hr(n, { sun: 0.1, rain: 0, weather: "晴", origin: { weather: "forecast" } } as never));
    expect(hoursWeather(lent, [12, 13, 14], 33.6)).toEqual({ text: "曇", estimated: true });
  });
});
