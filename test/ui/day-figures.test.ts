// 同じ日の同じ値は、どこに出しても同じ数字（2026-11-24 渡辺さん「揃えてください」「テストで仕様として固める」）。
//
// 仕様：
//   1. 日の最高・最低は日の行の値（dayHighLow）。今日も、時間ごとの観測と予報から計算し直さない。
//   2. 書き方は1つ（dayText / dayFigure）：気象庁の予報の値は整数のまま、ほかは formatValue の桁。
//   3. 今日の「このあと」は、その日の最高（最低）がまだ来ていなければ日の値。過ぎていれば時間の値（観測は事実）。
//   4. 日の値を出す画面は、みな 1〜3 を通る（下の「使う所」）。
// 画面の上で同じ数字になることは e2e（SD1b・GR4）で確かめる。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { overlayOfficial } from "../../src/data/official";
import { formatValue } from "../../src/design/format";
import { dayFigure, dayHighLow, dayText } from "../../src/sourceTag";
import { restWord, splitToday, withDay } from "../../src/todaySplit";
import type { OfficialDay } from "../../shared/jmaOfficial";
import type { WeatherRow } from "../../shared/types";

const row = (o: Partial<WeatherRow>): WeatherRow => ({ date: "2026-11-24", n: 25, type: "forecast", provider: "Open-Meteo", raw: {}, quality: {}, ...o });
const from = { kind: "VPFD51" as const, issuedAt: "2026-11-24T05:00:00+09:00", issueId: "x", place: "74182", placeName: "高知" };
const today: OfficialDay = {
  date: "2026-11-24",
  weather: { v: { code: "300", label: "雨", partial: null }, from },
  max: { v: 16, lower: null, upper: null, from },
  min: { v: 10, lower: null, upper: null, from },
  popDay: null,
  pop6: [{ v: 100, from }, { v: 100, from }, { v: 50, from }, { v: 0, from }],
  reliability: null,
};
// 11/24 2時の様子（渡辺さんの画面）：Open-Meteo の日の値は 15.5／9.2、気象庁は 16／10。
const om = row({ max: 15.5, min: 9.2, mean: 12.9 });
const jma = overlayOfficial(om, today);
const hours: WeatherRow[] = [
  ...[11.0, 11.1].map((t, i) => row({ n: i + 1, type: "actual", provider: "JMA-amedas", temp: t })),
  ...[11.5, 13, 15.5, 14, 9.2].map((t, i) => row({ n: i + 3, temp: t })),
];

describe("1. 日の最高・最低は日の行の値", () => {
  it("気象庁の値が重なった日は気象庁の値（Open-Meteo の日の値でも、時間ごとの見込みでもない）", () => {
    expect(dayHighLow(jma)).toEqual({ max: 16, min: 10 });
    expect(dayHighLow(om)).toEqual({ max: 15.5, min: 9.2 });
    expect(dayHighLow(null)).toEqual({ max: null, min: null });
  });
});

describe("2. 書き方は1つ", () => {
  it("気象庁の値は整数のまま、Open-Meteo の値と気象庁に無い項目は小数1桁", () => {
    expect(dayFigure(jma, "max", 16)).toBe("16");
    expect(dayFigure(jma, "min", 10)).toBe("10");
    expect(dayFigure(jma, "range", 6)).toBe("6");
    expect(dayFigure(jma, "mean", 12.9)).toBe("12.9");
    expect(dayFigure(om, "max", 16)).toBe("16.0");
    expect(dayFigure(jma, "max", null)).toBe("—");
  });
  it("表の書き方（formatValue のあと）と同じ", () => {
    expect(dayText(jma, "max", formatValue(16, "℃"))).toBe(dayFigure(jma, "max", 16));
    expect(dayText(om, "max", formatValue(15.5, "℃"))).toBe(dayFigure(om, "max", 15.5));
  });
});

describe("3. 今日の「このあと」は日の値にそろう", () => {
  const s = splitToday(hours)!;
  it("日の最高・最低がまだ来ていなければ、このあとの最高・最低は日の値（時刻なし）", () => {
    const w = withDay(s, dayHighLow(jma));
    expect(w.fc.max).toEqual({ v: 16, n: null });
    expect(w.fc.min).toEqual({ v: 10, n: null });
    expect(restWord(w)).toContain("最高はこのあと 16℃ の見込み");
    expect(restWord(w)).not.toContain("15.5");
  });
  it("もう過ぎていれば時間の値のまま（観測は事実）", () => {
    const w = withDay(s, { max: 11, min: 11.05 });
    expect(w.fc.max).toEqual(s.fc.max);
    expect(w.fc.min).toEqual(s.fc.min);
  });
  it("時間ごとの線（Curve）は変えない：元の区切りは時間の値のまま", () => {
    withDay(s, dayHighLow(jma));
    expect(s.fc.max).toEqual({ v: 15.5, n: 5 });
  });
});

describe("4. 日の値を出す画面は、みな同じ関数を通る", () => {
  const src = (f: string) => readFileSync(join(__dirname, "../../src/ui", f), "utf8");
  // 表・1日の見出しと札・比較のまとめ・日のまとめ・今日の「ここまで／このあと」。
  const USERS: Record<string, RegExp[]> = {
    "CompareBoard.tsx": [/dayText\(/],
    "DayDetail.tsx": [/dayHighLow\(row\)/, /dayFigure\(row, "max"/, /dayFigure\(row, "min"/, /dayText\(row, x\.key/, /dayText\(row, s\.key/],
    "CompareSummary.tsx": [/dayFigure\(/],
    "DaySummaryCard.tsx": [/dayText\(/],
    "TodaySplit.tsx": [/withDay\(raw, day\)/],
  };
  for (const [f, res] of Object.entries(USERS))
    it(f, () => {
      for (const re of res) expect(src(f)).toMatch(re);
    });
  it("1日の見出しは時間ごとから計算し直さない（splitToday を使わない）", () => {
    expect(src("DayDetail.tsx")).not.toMatch(/splitToday/);
  });
  it("「16.0」の元（気象庁の値を小数で書く）を戻さない：日の値を toFixed で直接書かない", () => {
    expect(src("DayDetail.tsx")).not.toMatch(/(max|min)\.toFixed\(/);
    expect(src("CompareSummary.tsx")).not.toMatch(/v\.toFixed\(row\.digits\)/);
  });
});
