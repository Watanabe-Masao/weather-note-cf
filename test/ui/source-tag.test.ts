// 日ごとの値の出どころの札（src/sourceTag.ts、2026-11-23）。
import { describe, expect, it } from "vitest";
import { overlayOfficial } from "../../src/data/official";
import { jmaText, jmaValue, omValue, rangeSource, sourceTag, valueSource } from "../../src/sourceTag";
import type { OfficialDay } from "../../shared/jmaOfficial";
import type { WeatherRow } from "../../shared/types";

const row = (o: Partial<WeatherRow>): WeatherRow => ({ date: "2026-11-25", n: 25, type: "actual", provider: "JMA", raw: {}, quality: {}, ...o });
const from = (kind: "VPFD51" | "VPFW50") => ({ kind, issuedAt: "2026-11-22T17:00:00+09:00", issueId: "x", place: "74182", placeName: "高知" });
const weekly: OfficialDay = {
  date: "2026-11-25",
  weather: { v: { code: "200", label: "くもり", partial: null }, from: from("VPFW50") },
  max: { v: 14, lower: 13, upper: 16, from: from("VPFW50") },
  min: { v: 6, lower: 4, upper: 7, from: from("VPFW50") },
  popDay: { v: 30, from: from("VPFW50") },
  pop6: [null, null, null, null],
  reliability: { v: "B", from: from("VPFW50") },
};

describe("出どころの札", () => {
  it("names what an observed day's values are", () => {
    expect(sourceTag(row({}), "fixed")).toBe("確定");
    expect(sourceTag(row({}), "variable")).toBe("暫定");
    expect(sourceTag(row({ provider: "JMA-recent", provisional: true }), "variable")).toBe("速報");
  });

  it("names a forecast day by the JMA issue of its values, or 補完 when JMA has none", () => {
    const om = row({ type: "forecast", provider: "Open-Meteo", max: 15.3, min: 7.1, temp: 10.2, confidence: "A" });
    expect(sourceTag(om, "variable")).toBe("補完");
    const jma = overlayOfficial(om, weekly);
    expect(sourceTag(jma, "variable")).toBe("週間");
    expect([jma.max, jma.min, jma.probability, jma.confidence, jma.dayWeather]).toEqual([14, 6, 30, "B", "曇"]);
    // 平均は Open-Meteo のまま：その値だけ点線。最高・最低・寒暖差は気象庁で、整数のまま。
    expect([omValue(jma, "temp"), omValue(jma, "max"), omValue(jma, "range")]).toEqual([true, false, false]);
    expect([jmaValue(jma, "max"), jmaValue(jma, "temp")]).toEqual([true, false]);
    expect(jmaText("14.0")).toBe("14");
    expect(jmaText("−3.0")).toBe("−3");
    expect(valueSource(jma, "max")).toBe("気象庁 週間天気予報 11/22 17時発表・高知");
    expect(valueSource(jma, "temp")).toBe("Open-Meteo（気象庁の予報に無い値）");
    // 寒暖差は Weather Note の計算と分けて書く（FS-02「加工して作成」）。
    expect(rangeSource(jma)).toBe("気象庁 週間天気予報 11/22 17時発表・高知の最高・最低から Weather Note が計算（最高−最低）");
    // 府県の日の降水確率：6時間ごとからアプリが選んだと書く。
    const fd = overlayOfficial(om, { ...weekly, popDay: null, pop6: [null, { v: 20, from: from("VPFD51") }, { v: 40, from: from("VPFD51") }, null] });
    expect(valueSource(fd, "probability")).toBe("気象庁 府県天気予報 11/22 17時発表・高知の6時間降水確率から、いちばん高い区切りを Weather Note が選んだ値（加工）");
    expect(fd.probability).toBe(40);
    // 補完の日は札で分かるので点線は付けない。
    expect(omValue(om, "temp")).toBe(false);
  });
});
