// 大気汚染の実測の保存（worker/src/soramame.ts）：介良局の1時間値を、直近2か月の取り直しと古い側へ3か月ずつを
// 交互に、1年前まで。6時間に1回まで。値なし（空・"-"・空白）の扱い、失敗の記録。

import { describe, expect, it } from "vitest";
import { addMonths, nextMonths, saveSoramame, soramameUrl } from "../worker/src/soramame";
import { d1 } from "./d1";

// 2026-11-21 22:40 JST
const NOW = Date.parse("2026-11-21T13:40:00Z");
const row = (date: string, hour: string, pm: string) => ({ SKT_CD: "39201350", SKT_DATE: date, SKT_TIME: hour, PM2_5: pm, OX: "0.019", SPM: "0.019", NO2: "0.004", SO2: "", WD: "N", WS: "1.1" });
const ok = (rows: unknown[]) => ({ ok: true, status: 200, text: async () => JSON.stringify(rows) });

describe("そらまめくん：取る月", () => {
  it("adds months across years", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", -11)).toBe("2025-12");
  });
  it("takes the last two months, and in turn three older months, back to a year", () => {
    expect(nextMonths("2026-11", null, false)).toEqual({ from: "2026-10", to: "2026-11" });
    expect(nextMonths("2026-11", "2026-10", true)).toEqual({ from: "2026-07", to: "2026-09" });
    expect(nextMonths("2026-11", "2026-07", false)).toEqual({ from: "2026-10", to: "2026-11" });
    expect(nextMonths("2026-11", "2026-01", true)).toEqual({ from: "2025-12", to: "2025-12" });
    expect(nextMonths("2026-11", "2025-12", true)).toEqual({ from: "2026-10", to: "2026-11" });
  });
  it("asks for Kaira (39201350) in Kochi (39), the items by name", () => {
    expect(soramameUrl("39", "39201350", "2026-10", "2026-11")).toBe(
      "https://soramame.env.go.jp/soramame/api/data_search?Start_YM=202610&End_YM=202611&TDFKN_CD=39&SKT_CD=39201350&REQUEST_DATA=PM2_5,OX,SPM,NO2,SO2,WS,WD",
    );
  });
});

describe("そらまめくん：保存と記録", () => {
  it("saves each hour (a missing value is null, an hour not out yet is not kept), at most every 6 hours", async () => {
    const db = d1();
    const seen: string[] = [];
    const get = async (url: string) => {
      seen.push(url);
      return ok([row("2026/11/21", "01", "14"), row("2026/11/21", "02", "-"), { ...row("2026/11/21", "23", ""), OX: "", SPM: " ", NO2: "", WD: "", WS: "" }, { ...row("2026/11/21", "03", "9"), SKT_CD: "39201360" }]);
    };
    expect(await saveSoramame(db, NOW, get)).toEqual({ saved: 2, ok: true });
    expect(db.raw.prepare("SELECT date, hour, pm2_5, ox, so2, wd, ws FROM soramame_hourly ORDER BY hour").all()).toEqual([
      { date: "2026-11-21", hour: 1, pm2_5: 14, ox: 0.019, so2: null, wd: "N", ws: 1.1 },
      { date: "2026-11-21", hour: 2, pm2_5: null, ox: 0.019, so2: null, wd: "N", ws: 1.1 },
    ]);
    expect(await saveSoramame(db, NOW + 3_600_000, get)).toMatchObject({ skipped: true });
    await saveSoramame(db, NOW + 6 * 3_600_000, get);
    expect(seen[1]).toContain("Start_YM=202608&End_YM=202610");
  });
  it("logs a failure", async () => {
    const db = d1();
    expect(await saveSoramame(db, NOW, async () => ({ ok: false, status: 503, text: async () => "" }))).toEqual({ saved: 0, ok: false });
    expect(db.raw.prepare("SELECT ok, range FROM soramame_fetch_log").get()).toEqual({ ok: 0, range: "2026-10..2026-11" });
  });
});
