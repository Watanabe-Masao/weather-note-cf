// 1日の「まとめ」の行（2026-11-24 渡辺さん）：src/daySummaryLines.ts。
import { describe, expect, it } from "vitest";
import { summaryLines } from "../../src/daySummaryLines";
import type { WeatherRow } from "../../shared/types";

const row = (o: Partial<WeatherRow>): WeatherRow => ({ date: "2026-11-24", n: 24, type: "forecast", provider: "Open-Meteo", raw: {}, quality: {}, ...o });
const hours = Array.from({ length: 24 }, (_, i) =>
  row({ n: i + 1, rain: i >= 7 && i < 15 ? (i === 9 ? 3 : 1) : 0, wind: 2 + (i % 3), direction: 315, visibility: 1.1 + i / 10 }),
);
const base = { row: row({ rain: 19, sun: 0.4, humidity: 73.2, max: 16, min: 10 }), hours, feelWord: "肌寒い", nextMin: "5", sun: { rise: "6:45", set: "16:59" }, past: false };
const text = (lines: ReturnType<typeof summaryLines>, label: string) => lines.find((l) => l.label === label)!.text;

describe("まとめの行", () => {
  it("5行（気温・雨・風・空・光・大気）、押すと行く仲間つき", () => {
    expect(summaryLines(base).map((l) => [l.label, l.group])).toEqual([
      ["気温", "temp"],
      ["雨", "rainwind"],
      ["風", "rainwind"],
      ["空・光", "sky"],
      ["大気", "air"],
    ]);
  });
  it("数字は表（天気・最高・最低）に無いものだけ：気温の行は肌感と明日の朝の最低", () => {
    const t = text(summaryLines(base), "気温");
    expect(t).toBe("日中は肌寒い。明日の朝は 5℃ まで");
    expect(t).not.toMatch(/16|10/);
  });
  it("雨：雨のある時間の数・量・いちばん多い時刻（時台）", () => {
    expect(text(summaryLines(base), "雨")).toBe("雨は8時間・19.0mm。多いのは9時台");
    expect(text(summaryLines({ ...base, hours: hours.map((h) => ({ ...h, rain: 0 })), row: row({}) }), "雨")).toBe("雨の見込みはありません");
    expect(text(summaryLines({ ...base, past: true, hours: hours.map((h) => ({ ...h, rain: 0 })), row: row({ rain: 0 }) }), "雨")).toBe("雨は降らなかった");
  });
  it("風：主な風向と日中の風速の幅、空・光：日照と日の出入り、大気：湿度と見通し", () => {
    const l = summaryLines(base);
    expect(text(l, "風")).toBe("北西の風、日中は 2〜4 m/s");
    expect(text(l, "空・光")).toBe("日差しはほとんどなし。日の出 6:45・日の入り 16:59");
    expect(text(l, "大気")).toBe("湿度 平均 73%・見通しの最小 1.1km");
  });
});

import { nowValues } from "../../src/daySummaryLines";
describe("いまの値（項目の画面の上、その仲間だけ）", () => {
  const latest = row({ type: "actual", observedAt: "15:40", temp: 15.2, humidity: 73, pressure: 1016.3, wind: 2.2, direction: 315, rain: 0, sun: 0.1, visibility: null });
  it("気温の画面は気温だけ、大気は湿度・気圧（無い視程は出さない）、雨・風は風向つき", () => {
    expect(nowValues(latest, "temp")).toEqual({ at: "15:40", items: [expect.objectContaining({ label: "気温", text: "15.2" })] });
    expect(nowValues(latest, "air").items.map((x) => [x.label, x.text])).toEqual([["湿度", "73"], ["気圧", "1016.3"]]);
    expect(nowValues(latest, "rainwind").items.map((x) => [x.label, x.text, x.note])).toEqual([["降水（この1時間）", "0.0", ""], ["風速", "2.2", "北西"]]);
  });
});

describe("雨の行：データが無いことを「雨なし」と言わない（2026-11-24 渡辺さん、thread-rules）", () => {
  it("読み込み中・取れなかった・無い", () => {
    expect(text(summaryLines({ ...base, hours: null, row: row({}), hoursState: "loading" }), "雨")).toBe("読み込み中…");
    expect(text(summaryLines({ ...base, hours: [], row: row({}), hoursState: "error" }), "雨")).toBe("雨のデータを取れませんでした");
    expect(text(summaryLines({ ...base, past: true, hours: [], row: row({}), hoursState: "none" }), "雨")).toBe("雨のデータがありません");
  });
  it("一部の時間だけ分かっているときは、その中では雨なしと言うだけ", () => {
    const part = hours.slice(0, 10).map((h) => ({ ...h, rain: 0 }));
    expect(text(summaryLines({ ...base, past: true, hours: part, row: row({}) }), "雨")).toBe("10時間分だけ分かっています（その中では雨なし）");
  });
  it("時間が無くても、日の量が 0 と分かっていれば「降らなかった」", () => {
    expect(text(summaryLines({ ...base, past: true, hours: [], row: row({ rain: 0 }), hoursState: "none" }), "雨")).toBe("雨は降らなかった");
  });
});

describe("今日のまとめ：今の気温と雨の降り始め（2026-11-24 渡辺さん）", () => {
  // 7時：0〜7時は観測（雨なし）、8時からは予報で 9時台から雨
  const today = Array.from({ length: 24 }, (_, i) =>
    row({ n: i + 1, type: i < 7 ? "actual" : "forecast", rain: i >= 9 && i < 13 ? (i === 10 ? 3 : 1) : 0, wind: 2, direction: 270 }),
  );
  const now = { temp: 15.2, rain: 0, at: "07:10" };
  it("気温の行は、いちばん先に今の気温を1つ（観測の時刻つき）", () => {
    expect(text(summaryLines({ ...base, now }), "気温")).toBe("いま 15.2℃（07:10観測）。日中は肌寒い。明日の朝は 5℃ まで");
  });
  it("まだ降っていなければ、予報で最初に降る時刻から（量と時間は「このあと」の予報の分）", () => {
    expect(text(summaryLines({ ...base, hours: today, now }), "雨")).toBe("9時ごろから雨の見込み（このあと 4時間・6.0mm の見込み）");
  });
  it("今降っていれば「雨を観測（時点）」、このあとの予報を添える", () => {
    expect(text(summaryLines({ ...base, hours: today, now: { ...now, rain: 1.5, at: "08:50" } }), "雨")).toBe("雨を観測（08:50時点）。このあと 4時間・6.0mm の見込み");
  });
  it("このあとの予報に雨が無ければ、そろっているときだけ「見込みはありません」", () => {
    const dry = today.map((h) => ({ ...h, rain: 0 }));
    expect(text(summaryLines({ ...base, hours: dry, now }), "雨")).toBe("このあと雨の見込みはありません");
    const part = dry.map((h, i) => (i > 15 ? { ...h, rain: null } : h));
    expect(text(summaryLines({ ...base, hours: part, now }), "雨")).toBe("このあと 9時間分だけ分かっています（その中では雨なし）");
  });
});
