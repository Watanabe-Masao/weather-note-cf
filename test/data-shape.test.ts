// データの形の版（shared/versions.ts の DATA_SHAPE）の見張り（2026-11-25 渡辺さん「何故それが事前に検知できなかったのか」）。
//
// 行（WeatherRow）に入る項目が変わると、端の保存（Worker の edge cache）とブラウザの保存に古い形の行が残り、
// その項目だけが「—」になる（#426 で視程を足したのに版を上げず、前年の視程が出なかった）。
// 気象庁の表・Open-Meteo・アメダスの見本を読み、行に出てくる項目の一覧を版と組にして持つ。
// 一覧が変わったら：shared/versions.ts の DATA_SHAPE を1つ上げ、下の SHAPES に新しい版の一覧を足す。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATA_SHAPE } from "../shared/versions";
import type { WeatherRow } from "../shared/types";
import { parseTable } from "../worker/src/jma-tables";
import { forecastUrl, normalizeForecast } from "../worker/src/open-meteo";

const OPTIONAL_HOURLY_NAMES = ["snowfall", "wind_gusts_10m", "visibility", "cloud_cover"];
import { aggregateRecentDay, parseLivePoint } from "../worker/src/amedas";
import { fixture } from "./fixture";

const META = new Set(["date", "n", "type", "provider", "raw", "quality", "unpublished", "provisional"]);
const fields = (rows: unknown[]) => [...new Set((rows as WeatherRow[]).flatMap((r) => Object.keys(r).filter((k) => !META.has(k))))].sort();

/** 版ごとの、行に出てくる項目。版を上げたら、ここに新しい版を足す（古い版は消さない＝いつ何が変わったかの記録）。 */
/** 版ごとの、行に出てくる項目（test/data-shape.json）。版を上げたら、そこに新しい版を足す（前の版は書き換えない）。 */
const SHAPES = JSON.parse(readFileSync(new URL("./data-shape.json", import.meta.url), "utf8")) as Record<string, Record<string, string[]>>;

/** 見本の時別に、任意の系列（forecastUrl が頼む降雪・突風・視程）を足す。 */
function withOptional(j: { hourly: Record<string, unknown[]> }) {
  const n = (j.hourly.time as unknown[]).length;
  for (const k of OPTIONAL_HOURLY_NAMES) j.hourly[k] = Array.from({ length: n }, (_, i) => (i % 5 === 0 ? null : k === "visibility" ? 24_140 : k === "cloud_cover" ? 62 : 0.5));
  return j as never;
}

describe("データの形の版", () => {
  it("任意の時別の系列は、頼む項目と見本の項目が同じ（頼む項目だけ増えて見本が漏れたら止める）", () => {
    const asked = new URL(forecastUrl({ lat: [33, 30], lon: [133, 30] } as never)).searchParams.get("hourly")!.split(",");
    const base = new URL(forecastUrl({ lat: [33, 30], lon: [133, 30] } as never, false)).searchParams.get("hourly")!.split(",");
    expect(asked.filter((x) => !base.includes(x)).sort()).toEqual([...OPTIONAL_HOURLY_NAMES].sort());
  });

  it("行の項目が変わったら DATA_SHAPE を上げる", () => {
    const { rows, hourlyRows } = normalizeForecast(JSON.parse(fixture("forecast.json")));
    const live = JSON.parse(fixture("current-observations.json"));
    const now = {
      "気象庁の表（日別）": fields(parseTable(fixture("daily.html"))),
      "気象庁の表（時別）": fields(parseTable(fixture("hourly.html"), true)),
      "Open-Meteo（日別）": fields(rows),
      "Open-Meteo（時別）": fields(hourlyRows),
      // 任意の時別（降雪・突風・視程・全雲量）：見本に無いので、全部ある形を作って読む（11/25 外部レビュー）。
      "Open-Meteo（時別、任意項目あり）": fields(normalizeForecast(withOptional(JSON.parse(fixture("forecast.json")))).hourlyRows),
      "アメダス（時別）": fields(parseLivePoint(live, "2026-11-08").rows),
      "アメダス（日のまとめ）": fields([aggregateRecentDay(live, "2026-11-08").daily]),
    };
    expect(now, "行の項目が変わりました。shared/versions.ts の DATA_SHAPE を上げ、test/data-shape.test.ts の SHAPES に新しい版の一覧を足してください").toEqual(SHAPES[String(DATA_SHAPE)]);
  });
});
