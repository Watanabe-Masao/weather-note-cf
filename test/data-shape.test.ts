// データの形の版（shared/versions.ts の DATA_SHAPE）の見張り（2026-11-25 渡辺さん「何故それが事前に検知できなかったのか」）。
//
// 行（WeatherRow）に入る項目が変わると、端の保存（Worker の edge cache）とブラウザの保存に古い形の行が残り、
// その項目だけが「—」になる（#426 で視程を足したのに版を上げず、前年の視程が出なかった）。
// 気象庁の表・Open-Meteo・アメダスの見本を読み、行に出てくる項目の一覧を版と組にして持つ。
// 一覧が変わったら：shared/versions.ts の DATA_SHAPE を1つ上げ、下の SHAPES に新しい版の一覧を足す。
import { describe, expect, it } from "vitest";
import { DATA_SHAPE } from "../shared/versions";
import type { WeatherRow } from "../shared/types";
import { parseTable } from "../worker/src/jma-tables";
import { normalizeForecast } from "../worker/src/open-meteo";
import { aggregateRecentDay, parseLivePoint } from "../worker/src/amedas";
import { fixture } from "./fixture";

const META = new Set(["date", "n", "type", "provider", "raw", "quality", "unpublished", "provisional"]);
const fields = (rows: unknown[]) => [...new Set((rows as WeatherRow[]).flatMap((r) => Object.keys(r).filter((k) => !META.has(k))))].sort();

/** 版ごとの、行に出てくる項目。版を上げたら、ここに新しい版を足す（古い版は消さない＝いつ何が変わったかの記録）。 */
const SHAPES: Record<number, Record<string, string[]>> = {
  // 3（2026-11-25）：気象庁の表（時別）とアメダスに視程 visibility（#426）。2 の一覧は記録していない。
  3: {
    "気象庁の表（日別）": ["dayWeather", "gust", "humidity", "humidityMin", "max", "min", "nightWeather", "pressure", "rain", "rainHour", "snow", "snowDepth", "sun", "temp", "wind", "windMax"],
    "気象庁の表（時別）": ["dew", "direction", "humidity", "pressure", "radiation", "rain", "snow", "snowDepth", "sun", "temp", "visibility", "weather", "wind"],
    "Open-Meteo（日別）": ["dayWeather", "gust", "humidity", "humidityMin", "max", "min", "pressure", "probability", "radiation", "rain", "snow", "sun", "sunrise", "sunset", "temp", "weatherCode", "wind", "windMax"],
    "Open-Meteo（時別）": ["direction", "humidity", "pressure", "probability", "rain", "solar", "sun", "temp", "weather", "weatherCode", "wind"],
    "アメダス（時別）": ["direction", "humidity", "observedAt", "pressure", "rain", "sun", "temp", "visibility", "weather", "wind"],
    "アメダス（日のまとめ）": ["coverage", "dayWeather", "humidity", "max", "min", "nightWeather", "pressure", "rain", "sun", "temp", "wind", "windMax"],
  },
};

describe("データの形の版", () => {
  it("行の項目が変わったら DATA_SHAPE を上げる", () => {
    const { rows, hourlyRows } = normalizeForecast(JSON.parse(fixture("forecast.json")));
    const live = JSON.parse(fixture("current-observations.json"));
    const now = {
      "気象庁の表（日別）": fields(parseTable(fixture("daily.html"))),
      "気象庁の表（時別）": fields(parseTable(fixture("hourly.html"), true)),
      "Open-Meteo（日別）": fields(rows),
      "Open-Meteo（時別）": fields(hourlyRows),
      "アメダス（時別）": fields(parseLivePoint(live, "2026-11-08").rows),
      "アメダス（日のまとめ）": fields([aggregateRecentDay(live, "2026-11-08").daily]),
    };
    expect(now, "行の項目が変わりました。shared/versions.ts の DATA_SHAPE を上げ、test/data-shape.test.ts の SHAPES に新しい版の一覧を足してください").toEqual(SHAPES[DATA_SHAPE]);
  });
});
