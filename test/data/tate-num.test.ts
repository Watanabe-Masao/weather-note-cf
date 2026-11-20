// 縦書きの文の数字を漢数字に（11/20 渡辺さん「11月が横向き。十一月に」）。
import { describe, expect, it } from "vitest";
import { tateNum } from "../../src/ui/MoonStory";

describe("tateNum", () => {
  it("turns month and small numbers into kanji numerals", () => {
    expect(tateNum("11月の満月は")).toBe("十一月の満月は");
    expect(tateNum("1月")).toBe("一月");
    expect(tateNum("10月と12月")).toBe("十月と十二月");
    expect(tateNum("20日と0")).toBe("二十日と〇");
    expect(tateNum("２月")).toBe("二月");
    expect(tateNum("数字なし")).toBe("数字なし");
  });
});
