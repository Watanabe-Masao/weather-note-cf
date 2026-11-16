import { describe, expect, it } from "vitest";
import { archiveChartUrl, dayChart, forecastCharts, hibitenUrl, quickChartUrl } from "../shared/wxchart";

// The names JMA uses, as found in WX-01/02 (#249): Japan time 9時 is the UTC 00 chart of the same day,
// 3時 the UTC 18 chart of the day before (and of its month: 1日 3時 is in the month before).
describe("天気図の場所", () => {
  it("names the 3-hourly charts by UTC, in the UTC month's folder", () => {
    expect(quickChartUrl("2026-11-16", 9)).toBe("https://www.data.jma.go.jp/yoho/data/wxchart/quick/202611/SPAS_COLOR_202611160000.png");
    expect(quickChartUrl("2026-11-16", 21)).toBe("https://www.data.jma.go.jp/yoho/data/wxchart/quick/202611/SPAS_COLOR_202611161200.png");
    expect(quickChartUrl("2026-11-01", 3)).toBe("https://www.data.jma.go.jp/yoho/data/wxchart/quick/202610/SPAS_COLOR_202610311800.png");
  });
  it("names the 保存用天気図 and 日々の天気図 PDFs", () => {
    expect(archiveChartUrl("2025-01-15", 9)).toBe("https://www.data.jma.go.jp/yoho/data/wxchart/archive/2025_01/PDFDATA/JSMAP/Js_2025011500.pdf");
    expect(archiveChartUrl("2025-01-15", 21)).toBe("https://www.data.jma.go.jp/yoho/data/wxchart/archive/2025_01/PDFDATA/JSMAP/Js_2025011512.pdf");
    expect(hibitenUrl("2015-06-07")).toBe("https://www.data.jma.go.jp/yoho/data/hibiten/2015/1506.pdf");
  });
  it("gives each day the farthest-reaching source it has", () => {
    const today = "2026-11-17";
    expect(dayChart("2026-11-18", today).kind).toBe("forecast");
    expect(dayChart("2026-11-17", today).kind).toBe("quick");
    expect(dayChart("2024-10-01", today).kind).toBe("quick");
    expect(dayChart("2024-09-30", today).kind).toBe("archive");
    expect(dayChart("2022-12-01", today).kind).toBe("archive");
    expect(dayChart("2022-11-30", today).kind).toBe("hibiten");
    expect(dayChart("2002-01-01", today).kind).toBe("hibiten");
    expect(dayChart("2001-12-31", today).kind).toBe("ndl");
  });
  it("reads the 予想天気図 from JMA's list: the base time in UTC, shown in Japan time", () => {
    const list = {
      near: {
        ft24: ["20261116185331_0_Z__C_010000_20261116120000_MET_CHT_JCIfsas24_Rjp_JCP600x581_JRcolor_Tjmahp_image.png"],
        ft48: ["20261116201131_0_Z__C_010000_20261116120000_MET_CHT_JCIfsas48_Rjp_JCP600x581_JRcolor_Tjmahp_image.png"],
      },
    };
    expect(forecastCharts(list)).toEqual([
      {
        url: "https://www.jma.go.jp/bosai/weather_map/data/png/20261116185331_0_Z__C_010000_20261116120000_MET_CHT_JCIfsas24_Rjp_JCP600x581_JRcolor_Tjmahp_image.png",
        hours: 24,
        base: "2026-11-16T21:00+09:00",
        valid: "2026-11-17T21:00+09:00",
      },
      {
        url: "https://www.jma.go.jp/bosai/weather_map/data/png/20261116201131_0_Z__C_010000_20261116120000_MET_CHT_JCIfsas48_Rjp_JCP600x581_JRcolor_Tjmahp_image.png",
        hours: 48,
        base: "2026-11-16T21:00+09:00",
        valid: "2026-11-18T21:00+09:00",
      },
    ]);
    expect(forecastCharts({ near: { ft24: ["../evil.png"] } })).toEqual([]);
    expect(forecastCharts(null)).toEqual([]);
  });
});
