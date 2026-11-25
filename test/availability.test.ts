// 値が無いときの理由と観測の方法の区間（shared/availability.ts、2026-11-25）。
import { describe, expect, it } from "vitest";
import { comparable, methodOf, whyMissing } from "../shared/availability";
import { hourlyExtreme } from "../src/chartMetrics";
import type { WeatherRow } from "../shared/types";

const row = (date: string, extra: Record<string, unknown> = {}): WeatherRow => ({ date, n: 1, type: "actual", provider: "JMA", raw: {}, quality: {}, ...extra });

describe("無いときの理由", () => {
  it("読み込み中は無し、失敗・範囲外はそのまま", () => {
    expect(whyMissing({ field: "temp", date: "2025-11-08", state: "empty" })).toBeNull();
    expect(whyMissing({ field: "temp", date: "2025-11-08", state: "error" })).toBe("failed");
    expect(whyMissing({ field: "visibility", date: "2025-11-08", state: "ready", hoursState: "error" })).toBe("failed");
    expect(whyMissing({ field: "temp", date: "1970-01-01", state: "outside" })).toBe("outside");
  });
  it("始まる前は対象外（時別の視程は 1989年4月から）", () => {
    expect(whyMissing({ field: "visibility", date: "1989-03-31", state: "ready", hoursState: "ready", rows: [row("1989-03-31", { visibility: null })] })).toBe("outside");
    expect(whyMissing({ field: "visibility", date: "1989-04-01", state: "ready", hoursState: "ready", rows: [row("1989-04-01", { visibility: null })] })).toBe("absent");
  });
  it("速報でまだ空の列はまだ、項目そのものが無い行は保存が古い（取得失敗）、空欄は欠測", () => {
    expect(whyMissing({ field: "sun", date: "2026-11-24", state: "ready", rows: [row("2026-11-24", { sun: null, unpublished: ["sun"] })] })).toBe("pending");
    expect(whyMissing({ field: "visibility", date: "2025-11-08", state: "ready", hoursState: "ready", rows: [row("2025-11-08", { temp: 15 })] })).toBe("failed");
    expect(whyMissing({ field: "visibility", date: "2025-11-08", state: "ready", hoursState: "ready", rows: [row("2025-11-08", { visibility: null })] })).toBe("absent");
  });
});

describe("観測の方法の区間（視程・天気）", () => {
  it("2020-02-03 までは目視、その日は切り替わりの日、後は自動", () => {
    expect(methodOf("visibility", "2020-02-02")).toBe("visual");
    expect(methodOf("visibility", "2020-02-03")).toBe("mixed");
    expect(methodOf("visibility", "2020-02-04")).toBe("auto");
    expect(methodOf("temp", "2020-02-02")).toBeNull();
  });
  it("またいで比べない（切り替わった日はどちらとも比べない）", () => {
    expect(comparable("visibility", "2019-11-08", "2025-11-08")).toBe(false);
    expect(comparable("visibility", "2025-11-08", "2026-11-07")).toBe(true);
    expect(comparable("visibility", "2019-11-08", "2018-11-08")).toBe(true);
    expect(comparable("visibility", "2020-02-03", "2020-02-04")).toBe(false);
    expect(comparable("temp", "2019-11-08", "2025-11-08")).toBe(true);
    expect(comparable("visibility", null, "2025-11-08")).toBe(true);
  });
  it("目視の日は3時間ごと（8回）でも1日の最小を出す。自動の日は20時間要る", () => {
    const hours = (date: string, ns: number[]) => ns.map((n) => ({ ...row(date), n, visibility: n === 9 ? 4 : 20 }));
    expect(hourlyExtreme(hours("2019-11-08", [3, 6, 9, 12, 15, 18, 21, 24]), "visibility", "min")).toBe(4);
    expect(hourlyExtreme(hours("2025-11-08", [3, 6, 9, 12, 15, 18, 21, 24]), "visibility", "min")).toBeNull();
  });
});
