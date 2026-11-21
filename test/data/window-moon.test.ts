import { describe, expect, it } from "vitest";
import { skyEventOn } from "../../shared/skyEvents";
import { windowMoonLine } from "../../shared/windowMoon";

const K = { lat: 33.567, lon: 133.548 };
const beaver = skyEventOn("2026-11-24", K.lat, K.lon)!;
const line = (iso: string, hidden: boolean | null) => windowMoonLine(Date.parse(iso), beaver, K.lat, K.lon, hidden, () => "東北東");

describe("窓の外の月（11/21）", () => {
  it("当日の昼はのぼる時刻と方角、夜は窓の外（雲なら雲の向こう）", () => {
    expect(line("2026-11-24T12:00:00+09:00", null)).toBe("夕方16時ごろ、東北東の空にのぼります。");
    expect(line("2026-11-24T21:00:00+09:00", false)).toBe("いま、窓の外にも同じ月が出ています。");
    expect(line("2026-11-24T21:00:00+09:00", true)).toBe("いま、雲の向こうに同じ月が出ています。");
    expect(line("2026-11-24T21:00:00+09:00", null)).toBe("いま、夜空に同じ月が出ています。");
  });
  it("前日は満ちかけの月、見出しに出ていない日は無し", () => {
    expect(line("2026-11-23T21:00:00+09:00", false)).toBe("いま、窓の外にも満ちかけの月が出ています。");
    expect(line("2026-11-22T21:00:00+09:00", false)).toBeNull();
    expect(line("2026-11-25T08:00:00+09:00", false)).toBeNull();
  });
});
