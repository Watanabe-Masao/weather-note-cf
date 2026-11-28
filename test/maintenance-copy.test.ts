// データの保守の「全部コピー」（11/28 渡辺さん「一発で全部コピーできるようにできませんか？」）：畳んである所も文字に入るか。
import { describe, expect, it } from "vitest";
import { fullText } from "../src/account/maintenanceText";

const s = {
  at: "2026-11-28T03:05:00Z",
  judged: { problems: [], notes: [{ key: "offsite", text: "定時処理「offsite copy」が長い（最長 192秒）。" }] },
  refetch: { perHour: 3, stages: [{ id: "forecast", name: "予報の電文", reach: "7日", lastOk: "2026-11-28T03:05:00Z", waiting: 0, left: 3, available: true, needed: false, why: [], last: null }] },
  completeness: {
    forecast: { VPFD51: { expected: 6, kept: 6, pendingCount: 0, lostCount: 0, pending: [], lost: [] } },
    radar: { hrpns: { expected: 48, kept: 46, pendingCount: 2, lostCount: 0, pending: ["2026-11-28T11:00:00+09:00"], lost: [] } },
    lostAll: [],
    air: null,
  },
  errors: [{ at: "2026-11-26T16:15:00Z", where: "定時処理 offsite copy", message: "Error: 控えを置く: HTTP 500" }],
  room: { d1Size: { bytes: 90_000_000, percent: 0.9 }, d1WritesMonth: { estimate: 1_700_000, percent: 3.4, rowsLastDay: 50_000 }, r2: { bytes: 22_000_000, percentOfFree: 0.2 }, cronRunsLastDay: 288, cronMissing: 0 },
  lastDupCheck: null,
  lastAudit: { at: "2026-11-28T03:00:00Z", result: { tables: [{ name: "sky_forecast_values", rows: 12345 }, { name: "sky_forecast_receipts", rows: 678 }], links: [{ name: "予報の値で、もとの発表が無い", n: 0 }] } },
  weeklyAudit: {
    at: "2026-11-25T09:37:00Z",
    result: {
      latestOk: true,
      historyOk: false,
      failed: [],
      r2: { checked: 20, missing: [], wrongSize: [] },
      holes: [],
      series: [{ id: "soramame", name: "大気汚染の実測（そらまめくん）", part: "39201350", first: "2025-12-01T00:00:00+09:00", last: "2026-11-25T09:00:00+09:00", have: 8442, missing: 190, gapCount: 2, gaps: [{ from: "2026-02-23T04:00:00+09:00", to: "2026-02-26T11:00:00+09:00", n: 78 }], ageH: 3, freshH: 12, fresh: true, note: "局が測っていない時間は元から無い。" }],
    },
  },
  offsite: { configured: true, lastDay: "2026-11-27", lastAt: null, days: 11, bytes: 34_700_000, pending: 0, oldestPending: null, lastError: null },
};

describe("データの保守の全部コピー", () => {
  it("まとめに加えて、畳んである所（欠けの時刻・週の点検の抜けた区間・表ごとの行数）も入る", () => {
    const t = fullText(s as unknown as Parameters<typeof fullText>[0]);
    expect(t.startsWith("【データの保守】11/28 12:05")).toBe(true);
    expect(t).toContain("11/28 11:00（まだ取り戻せる）");
    expect(t).toContain("2/23 4:00 〜 2/26 11:00 の間（78回）");
    expect(t).toContain("ほか 1か所");
    expect(t).toContain("・sky_forecast_values 12,345");
    expect(t).toContain("・sky_forecast_receipts 678");
    expect(t).toContain("原本の控え（GitHub）：11日分");
    expect(t).toContain("定時処理 288/288");
  });
});
