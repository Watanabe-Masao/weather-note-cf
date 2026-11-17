// 天気の番号（天気予報用テロップ番号）の表 shared/weatherCode.ts を、リポジトリの実データと照らす：
// 気象庁の電文（VPFD51・VPFW50）・予報 JSON・shiromatz の記録（test/fixtures/forecast）に出てくる番号が
// すべて表にあること、電文の同じ区域・同じ時刻の言葉と表の言葉が合うこと。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseForecastXml } from "../shared/forecastXml";
import { WEATHER_CODES, weatherCodeInfo, weatherCodeText } from "../shared/weatherCode";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), "utf8");

const TELEGRAMS = [
  ["vpfd51-130000-1100.xml", "VPFD51", "130000"],
  ["vpfd51-390000-0500.xml", "VPFD51", "390000"],
  ["vpfd51-390000-1100.xml", "VPFD51", "390000"],
  ["vpfd51-390000-1700.xml", "VPFD51", "390000"],
  ["vpfw50-390000-1100.xml", "VPFW50", "390000"],
  ["vpfw50-471000-1100.xml", "VPFW50", "471000"],
] as const;

const issues = TELEGRAMS.map(([name, kind, office]) => ({ name, issue: parseForecastXml(fixture(name), kind, office) }));

/** 同じ区域・同じ時刻の、番号と言葉（element の）組。 */
function pairs(element: "weather" | "weather_text") {
  const out: { name: string; place: string; validFrom: string; code: string; words: string }[] = [];
  for (const { name, issue } of issues)
    for (const c of issue.entries.filter((e) => e.element === "weather_code" && e.value != null))
      for (const w of issue.entries.filter(
        (e) => e.element === element && e.place === c.place && e.validFrom === c.validFrom && e.validTo === c.validTo && e.value != null,
      ))
        out.push({ name, place: c.place, validFrom: c.validFrom, code: c.value!, words: w.value! });
  return out;
}

/** 比べるための形：空白（全角を含む）を除き、電文の「晴れ」「くもり」を気象庁の表の「晴」「曇」に。 */
const same = (words: string) => words.replace(/\s/g, "").replace(/晴れ/g, "晴").replace(/くもり/g, "曇");

describe("天気の番号の表", () => {
  it("has JMA's 118 codes, each with its words, its pictures and its group", () => {
    const codes = Object.keys(WEATHER_CODES);
    expect(codes).toHaveLength(118);
    for (const [code, [day, night, group, text, en]] of Object.entries(WEATHER_CODES)) {
      expect(code).toMatch(/^[1-4]\d\d$/);
      expect(day).toMatch(/^\d{3}\.svg$/);
      expect(night).toMatch(/^\d{3}\.svg$/);
      expect(["100", "200", "300", "400"]).toContain(group);
      expect(text).not.toBe("");
      expect(en).not.toBe("");
    }
  });

  it("gives JMA's words for a code, as a string or a number", () => {
    expect(weatherCodeText("100")).toBe("晴");
    expect(weatherCodeText(101)).toBe("晴時々曇");
    expect(weatherCodeText("200")).toBe("曇");
    expect(weatherCodeText(" 313 ")).toBe("雨後曇");
    expect(weatherCodeText("302")).toBe("雨時々止む");
    expect(weatherCodeInfo(101)).toEqual({ code: "101", text: "晴時々曇", en: "PARTLY CLOUDY", dayIcon: "101.svg", nightIcon: "501.svg", group: "100" });
    expect(weatherCodeInfo("200")).toMatchObject({ dayIcon: "200.svg", nightIcon: "200.svg" });
  });

  it("gives null for a code not in the table, never a guess", () => {
    for (const code of ["999", "109", "129", "500", "000", "", "abc", "1010", "0100", "10", "100a", 109, 100.5, Number.NaN, -100, "constructor", "toString"])
      expect(weatherCodeText(code as string | number)).toBeNull();
    expect(weatherCodeInfo("999")).toBeNull();
  });
});

describe("リポジトリの実データと照らす", () => {
  it("has every code of the telegrams (VPFD51・VPFW50)", () => {
    const codes = new Set(issues.flatMap(({ issue }) => issue.entries.filter((e) => e.element === "weather_code" && e.value != null).map((e) => e.value!)));
    expect(codes.size).toBeGreaterThan(0);
    expect([...codes].filter((c) => weatherCodeText(c) == null)).toEqual([]);
  });

  it("has every code of JMA's forecast JSON (bosai-390000-1100.json)", () => {
    const codes = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object")
        for (const [k, v] of Object.entries(o)) {
          if (k === "weatherCodes" && Array.isArray(v)) for (const c of v) codes.add(String(c));
          walk(v);
        }
    };
    walk(JSON.parse(fixture("bosai-390000-1100.json")));
    expect(codes.size).toBeGreaterThan(0);
    expect([...codes].filter((c) => weatherCodeText(c) == null)).toEqual([]);
  });

  it("has every code of shiromatz's record (the CSV in the fixtures)", () => {
    const codes = new Set<string>();
    // weatherCode(s) is the 6th column; the columns before it (office, times, area) hold no commas.
    for (const name of ["shiromatz-202501-390000.csv", "shiromatz-202610-390000.csv"]) {
      const [head, ...rows] = fixture(name).trim().split(/\r?\n/);
      const col = head.split(",").findIndex((h) => h === "weatherCode" || h === "weatherCodes");
      expect(col).toBeGreaterThanOrEqual(0);
      for (const row of rows) {
        const v = row.split(",")[col]?.replace(/"/g, "").trim();
        if (v) codes.add(v);
      }
    }
    expect(codes.size).toBeGreaterThan(0);
    expect([...codes].filter((c) => weatherCodeText(c) == null)).toEqual([]);
  });

  it("matches the telegrams' 基本天気 (weather) at the same area and time, word for word", () => {
    const ps = pairs("weather");
    expect(ps.length).toBeGreaterThan(0);
    const wrong = ps.filter((p) => same(p.words) !== weatherCodeText(p.code)).map((p) => `${p.name} ${p.place} ${p.validFrom} ${p.code} ${p.words}`);
    expect(wrong).toEqual([]);
  });

  // 天気の文（weather_text：「くもり　所により　昼過ぎ　まで　雨　で　雷を伴う」…）は番号より細かいことを言うので、
  // 番号の言葉と合わないものがある。合わない組は隠さずここに全部書き、増減があればこのテストが落ちる。
  it("lists the telegrams' sentences (weather_text) that say more than their code's words", () => {
    const ps = pairs("weather_text");
    expect(ps.length).toBeGreaterThan(0);
    const wrong = [...new Set(ps.filter((p) => same(p.words) !== weatherCodeText(p.code)).map((p) => `${p.code} ${weatherCodeText(p.code)} ← ${p.words.replace(/\s/g, "")}`))].sort();
    expect(wrong).toEqual(MISMATCHED_SENTENCES);
  });
});

/** 天気の文と番号の言葉が合わない組（番号 表の言葉 ← 文から空白を除いたもの）。test/fixtures/forecast の電文から。 */
const MISMATCHED_SENTENCES: string[] = [
  "101 晴時々曇 ← 晴れ夜のはじめ頃くもり",
  "102 晴一時雨 ← 晴れ時々くもり明け方まで雨",
  "200 曇 ← くもり所により昼過ぎから夕方雨",
  "200 曇 ← くもり所により昼過ぎまで雨で雷を伴う",
  "202 曇一時雨 ← くもり後晴れ明け方まで雨所により未明雷を伴い激しく降る",
  "203 曇時々雨 ← くもり朝晩雨所により未明雷を伴い激しく降る",
  "214 曇後雨 ← くもり夕方から雨",
  "214 曇後雨 ← くもり昼過ぎから雨",
  "214 曇後雨 ← くもり昼過ぎから雨所により夕方から雷を伴い激しく降る",
  "214 曇後雨 ← くもり昼過ぎから雨所により雷を伴う",
  "300 雨 ← 雨所により夕方から雷を伴い激しく降る",
  "300 雨 ← 雨所により昼過ぎから夕方雷を伴い激しく降る",
  "302 雨時々止む ← 雨時々くもり所により夕方から夜のはじめ頃雷を伴い激しく降る",
  "302 雨時々止む ← 雨時々くもり所により昼過ぎから夜のはじめ頃雷を伴う",
];
