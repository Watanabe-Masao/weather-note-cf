// 予報の履歴 (#250, R1-7): JMA's forecast telegrams read by shared/forecastXml.ts — real ones of
// 2026-11 (test/fixtures/forecast, FH-04) and made-up ones for what the real ones do not show.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseForecastXml, type ForecastEntry } from "../shared/forecastXml";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), "utf8");
const pick = (es: ForecastEntry[], x: Partial<ForecastEntry>) =>
  es.filter((e) => Object.entries(x).every(([k, v]) => e[k as keyof ForecastEntry] === v));
const brief = (e: ForecastEntry) => [e.element, e.validFrom.slice(5, 16), e.period, e.label, e.value].join(" ");

describe("府県天気予報（VPFD51）を読む", () => {
  const t = parseForecastXml(fixture("vpfd51-390000-1100.xml"), "VPFD51", "390000");

  it("reads the head: when it was issued, for when, as 発表", () => {
    expect(t).toMatchObject({ kind: "VPFD51", office: "390000", issuedAt: "2026-11-17T11:00:00+09:00", infoType: "発表", title: "高知県府県天気予報" });
    expect(t.problems).toEqual([]);
  });

  it("reads 天気 and its code by area for 今日・明日・明後日, each with its own span", () => {
    expect(pick(t.entries, { place: "390010", element: "weather" }).map(brief)).toEqual([
      "weather 11-17T11:00 PT13H 今日 雨時々止む",
      "weather 11-18T00:00 P1D 明日 くもり",
      "weather 11-19T00:00 P1D 明後日 くもり時々晴れ",
    ]);
    expect(pick(t.entries, { place: "390010", element: "weather_code" }).map((e) => e.value)).toEqual(["302", "200", "201"]);
    expect(new Set(t.entries.filter((e) => e.placeType === "area").map((e) => e.placeName))).toEqual(new Set(["中部", "東部", "西部"]));
  });

  it("reads 天気 also as JMA's sentence (the words of its forecast page and JSON, and of shiromatz)", () => {
    expect(pick(t.entries, { place: "390010", element: "weather_text" }).map((e) => e.value)).toEqual([
      "雨　時々　くもり　所により　昼過ぎ　から　夜のはじめ頃　雷　を伴う",
      "くもり　所により　昼過ぎ　から　夕方　雨",
      "くもり　時々　晴れ",
    ]);
  });

  it("keeps the 降水確率 as 6-hour values, never as a day's", () => {
    const pop = pick(t.entries, { place: "390010", element: "pop" });
    expect(pop.map(brief).slice(0, 2)).toEqual(["pop 11-17T12:00 PT6H １２時から１８時まで 80", "pop 11-17T18:00 PT6H １８時から００時まで 60"]);
    expect(pop.every((e) => e.period === "PT6H" && e.unit === "%" && e.validTo > e.validFrom)).toBe(true);
  });

  it("tells 日中の最高気温 from the day's 最高気温 by its type and span", () => {
    expect(pick(t.entries, { place: "74182" }).filter((e) => e.element !== "temp").map((e) => [e.jmaType, e.validFrom.slice(5, 16), e.validTo.slice(5, 16), e.value, e.unit])).toEqual([
      ["日中の最高気温", "11-17T09:00", "11-17T18:00", "20", "℃"],
      ["最高気温", "11-17T00:00", "11-18T00:00", "20", "℃"],
      ["朝の最低気温", "11-18T00:00", "11-18T09:00", "12", "℃"],
      ["日中の最高気温", "11-18T09:00", "11-18T18:00", "21", "℃"],
    ]);
  });

  it("reads the 3-hour 気温 at instants and the 3-hour 卓越天気 apart from the day's 天気", () => {
    const temps = pick(t.entries, { place: "74182", element: "temp" });
    expect(temps).toHaveLength(13);
    expect(temps.every((e) => e.period === "" && e.validFrom === e.validTo)).toBe(true);
    expect(pick(t.entries, { place: "390010", element: "weather_3h" })).toHaveLength(12);
  });

  it("an evening one: 今夜, and the day's lowest of tomorrow morning", () => {
    const e = parseForecastXml(fixture("vpfd51-390000-1700.xml"), "VPFD51", "390000");
    expect(pick(e.entries, { place: "390010", element: "weather" })[0].label).toBe("今夜");
    expect(pick(e.entries, { place: "74182", element: "temp_min" }).map((x) => x.label)).toEqual(["明日朝"]);
  });

  it("an office of several areas and stations (東京): every one read", () => {
    const e = parseForecastXml(fixture("vpfd51-130000-1100.xml"), "VPFD51", "130000");
    expect(new Set(pick(e.entries, { element: "weather" }).map((x) => x.placeName))).toEqual(new Set(["東京地方", "伊豆諸島北部", "伊豆諸島南部", "小笠原諸島"]));
    expect(new Set(pick(e.entries, { element: "temp_max" }).map((x) => x.placeName))).toEqual(new Set(["東京", "大島", "八丈島", "父島"]));
    expect(e.problems).toEqual([]);
  });
});

describe("府県週間天気予報（VPFW50）を読む", () => {
  const t = parseForecastXml(fixture("vpfw50-390000-1100.xml"), "VPFW50", "390000");

  it("reads 7 days of 天気・日降水確率・信頼度, each a day", () => {
    expect(pick(t.entries, { element: "weather" }).map((e) => e.value)).toEqual(["くもり", "くもり時々晴れ", "くもり時々晴れ", "くもり時々晴れ", "晴れ時々くもり", "晴れ時々くもり", "くもり一時雨"]);
    expect(pick(t.entries, { element: "reliability" }).map((e) => e.value)).toEqual([null, null, "B", "A", "A", "A", "C"]);
    expect(t.entries.every((e) => e.period === "P1D")).toBe(true);
    expect(t.problems).toEqual([]);
  });

  it("keeps 「値なし」 as no value with that note (the item is there, its value is not)", () => {
    const pop1 = pick(t.entries, { element: "pop" })[0];
    expect(pop1).toMatchObject({ value: null, condition: "値なし", validFrom: "2026-11-18T00:00:00+09:00" });
  });

  it("sets the 予測範囲 onto the temperature as its lower and upper ends", () => {
    expect(pick(t.entries, { element: "temp_min" }).slice(0, 2).map((e) => [e.value, e.lower, e.upper])).toEqual([
      [null, null, null],
      ["8", 6, 9],
    ]);
    expect(pick(t.entries, { element: "temp_max" })[1]).toMatchObject({ value: "16", lower: 15, upper: 18, unit: "℃", placeName: "高知" });
  });

  it("leaves the 平年値 out (they are not forecasts)", () => {
    expect(t.entries.some((e) => /平年値/.test(e.jmaType))).toBe(false);
    expect(parseForecastXml(fixture("vpfw50-471000-1100.xml"), "VPFW50", "471000").problems).toEqual([]);
  });
});

describe("府県天気概況（VPFG50）と、読めないもの", () => {
  it("reads the text of 天気概況", () => {
    const t = parseForecastXml(fixture("vpfg50-390000-1036.xml"), "VPFG50", "390000");
    expect(t.issuedAt).toBe("2026-11-17T10:36:00+09:00");
    expect(t.entries).toHaveLength(1);
    expect(t.entries[0]).toMatchObject({ element: "overview", place: "390000", placeName: "高知県" });
    expect(t.entries[0].value).toMatch(/^高知県は、低気圧や湿った空気の影響で/);
  });

  it("a 訂正 is read as one, with its values", () => {
    const xml = fixture("vpfw50-390000-1100.xml").replace("<InfoType>発表</InfoType>", "<InfoType>訂正</InfoType>");
    const t = parseForecastXml(xml, "VPFW50", "390000");
    expect(t.infoType).toBe("訂正");
    expect(t.entries).toHaveLength(42);
  });

  it("says what it cannot read instead of guessing", () => {
    expect(() => parseForecastXml("<Report><Head></Head></Report>", "VPFD51", "390000")).toThrow(/ReportDateTime/);
    const empty = parseForecastXml("<Report><Head><ReportDateTime>2026-11-17T11:00:00+09:00</ReportDateTime><InfoType>発表</InfoType></Head><Body></Body></Report>", "VPFW50", "390000");
    expect(empty.entries).toEqual([]);
    expect(empty.problems).toEqual(["予報の値がない"]);
    const lost = fixture("vpfw50-390000-1100.xml").replace('<TimeDefine timeId="7">', '<TimeDefine timeId="77">');
    expect(parseForecastXml(lost, "VPFW50", "390000").problems).toContain("天気：時刻 7 がない");
  });

  it("reads the same telegram to the same values every time (N-5)", () => {
    const xml = fixture("vpfd51-390000-1100.xml");
    expect(parseForecastXml(xml, "VPFD51", "390000")).toEqual(parseForecastXml(xml, "VPFD51", "390000"));
  });
});
