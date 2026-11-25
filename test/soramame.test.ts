// 大気汚染の実測の保存（worker/src/soramame.ts）：介良局の1時間値を、直近2か月の取り直しと古い側へ3か月ずつを
// 交互に、1年前まで。6時間に1回まで（その間は1時間に1回、今月だけ。11/25）。値なし（空・"-"・空白）の扱い、失敗の記録。

import { describe, expect, it } from "vitest";
import { addMonths, nextMonths, saveSoramame, soramameUrl } from "../worker/src/soramame";
import { d1 } from "./d1";

// 2026-11-21 22:40 JST
const NOW = Date.parse("2026-11-21T13:40:00Z");
const row = (date: string, hour: string, pm: string) => ({ SKT_CD: "39201350", SKT_DATE: date, SKT_TIME: hour, PM2_5: pm, OX: "0.019", SPM: "0.019", NO2: "0.004", SO2: "", WD: "N", WS: "1.1" });
const ok = (rows: unknown[]) => ({ ok: true, status: 200, text: async () => JSON.stringify(rows) });
const HEAD = "年,月,日,時,SO2,NO,NO2,NOX,CO,OX,NMHC,CH4,THC,SPM,PM2.5,SP,WD,WS,TEMP,HUM";
const csv = (lines: string[] = []) => ({ ok: true, status: 200, text: async () => [HEAD, ...lines].join("\r\n") });
/** 検索の API には rows、直近7日の CSV には lines を返す。 */
const api = (rows: unknown[], lines: string[] = []) => async (url: string) => (url.includes("/7day.csv") ? csv(lines) : ok(rows));

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
  it("saves each hour (a missing value is null, an hour not out yet is not kept); this month every hour, the rest every 6 hours", async () => {
    const db = d1();
    const seen: string[] = [];
    const search = [row("2026/11/21", "01", "14"), row("2026/11/21", "02", "-"), { ...row("2026/11/21", "23", ""), OX: "", SPM: " ", NO2: "", WD: "", WS: "" }, { ...row("2026/11/21", "03", "9"), SKT_CD: "39201360" }];
    const get = async (url: string) => (seen.push(url), api(search)(url));
    expect(await saveSoramame(db, NOW, get)).toEqual({ saved: 2, ok: true });
    expect(db.raw.prepare("SELECT date, hour, pm2_5, ox, so2, wd, ws FROM soramame_hourly ORDER BY hour").all()).toEqual([
      { date: "2026-11-21", hour: 1, pm2_5: 14, ox: 0.019, so2: null, wd: "N", ws: 1.1 },
      { date: "2026-11-21", hour: 2, pm2_5: null, ox: 0.019, so2: null, wd: "N", ws: 1.1 },
    ]);
    // 6時間ごとの回：検索の API（直近2か月）と、直近7日の CSV。
    expect(seen).toEqual([expect.stringContaining("Start_YM=202610&End_YM=202611"), "https://soramame.env.go.jp/data/sokutei/NoudoTime/39201350/7day.csv"]);
    // 1時間たたないうちは取らない。
    expect(await saveSoramame(db, NOW + 600_000, get)).toMatchObject({ skipped: true });
    // 1時間ごとには直近7日の CSV だけ（6時間ごとの回の数え方には入らない）。
    await saveSoramame(db, NOW + 3_600_000, get);
    await saveSoramame(db, NOW + 2 * 3_600_000, get);
    expect(seen.slice(2)).toEqual([expect.stringContaining("7day.csv"), expect.stringContaining("7day.csv")]);
    expect(db.raw.prepare("SELECT range FROM soramame_fetch_log ORDER BY at DESC LIMIT 1").get()).toEqual({ range: "7day" });
    // 6時間たてば、古い側（直近の次の回）。
    await saveSoramame(db, NOW + 6 * 3_600_000, get);
    expect(seen[4]).toContain("Start_YM=202608&End_YM=202610");
    // 次の直近の取り直し（12時間後）：同じ値の時間は書き直さず、直った値だけ書く。
    expect(await saveSoramame(db, NOW + 12 * 3_600_000, api([row("2026/11/21", "01", "14"), row("2026/11/21", "02", "12")]))).toEqual({ saved: 1, ok: true });
  });
  it("reads the 7-day CSV: today's hours, the Japanese wind word, blanks as no value; keeps the wind when the CSV has none", async () => {
    const db = d1();
    const lines = ["2026,11,21,01,0,0,0.007,0.007,  ,0.03,  ,  ,  ,0,4,  ,南南東,0.6,  ,  ", "2026,11,21,22,0,0.001,0.004,0.005,  ,  ,  ,  ,  ,0.014,  ,  ,静穏,0.2,  ,  ", "2026,11,21,23,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  "];
    expect(await saveSoramame(db, NOW, api([], lines))).toEqual({ saved: 2, ok: true });
    expect(db.raw.prepare("SELECT date, hour, pm2_5, ox, spm, no2, so2, wd, ws FROM soramame_hourly ORDER BY hour").all()).toEqual([
      { date: "2026-11-21", hour: 1, pm2_5: 4, ox: 0.03, spm: 0, no2: 0.007, so2: 0, wd: "SSE", ws: 0.6 },
      { date: "2026-11-21", hour: 22, pm2_5: null, ox: null, spm: 0.014, no2: 0.004, so2: 0, wd: "CALM", ws: 0.2 },
    ]);
    expect(db.raw.prepare("SELECT returned, newest, dropped FROM soramame_fetch_log").get()).toEqual({ returned: 3, newest: "2026-11-21 22", dropped: 0 });
    // 文字が化けて風向が読めない CSV でも、前に入った風向は消さない
    await saveSoramame(db, NOW + 3_600_000, api([], ["2026,11,21,01,0,0,0.007,0.007,  ,0.03,  ,  ,  ,0,5,  ,???,0.6,  ,  "]));
    expect(db.raw.prepare("SELECT pm2_5, wd FROM soramame_hourly WHERE hour = 1").get()).toEqual({ pm2_5: 5, wd: "SSE" });
  });
  it("refuses a CSV of another form", async () => {
    const { parseRecentCsv } = await import("../worker/src/soramame");
    expect(() => parseRecentCsv("a,b,c\n1,2,3")).toThrow(/unexpected header/);
  });
  it("logs a failure", async () => {
    const db = d1();
    expect(await saveSoramame(db, NOW, async () => ({ ok: false, status: 503, text: async () => "" }))).toEqual({ saved: 0, ok: false });
    expect(db.raw.prepare("SELECT ok, range FROM soramame_fetch_log").get()).toEqual({ ok: 0, range: "2026-10..2026-11" });
  });
});

describe("そらまめくん：取得の記録と最初に入った時刻（11/25 ルールの見直し）", () => {
  it("logs how many rows came back, the newest hour with a value, and the rows dropped for their form", async () => {
    const db = d1();
    await saveSoramame(db, NOW, api([row("2026/11/21", "01", "14"), row("2026/11/21", "22", "9"), { ...row("2026/11/21", "23", ""), OX: "", SPM: "", NO2: "", WD: "", WS: "" }, { ...row("2026-11-21", "05", "9") }]));
    expect(db.raw.prepare("SELECT returned, newest, dropped FROM soramame_fetch_log").get()).toEqual({ returned: 4, newest: "2026-11-21 22", dropped: 1 });
  });
  it("keeps when an hour first came in when the value is corrected later", async () => {
    const db = d1();
    await saveSoramame(db, NOW, api([row("2026/11/21", "01", "14")]));
    await saveSoramame(db, NOW + 6 * 3_600_000, api([row("2026/11/21", "01", "15")]));
    expect(db.raw.prepare("SELECT pm2_5, fetched_at FROM soramame_hourly").get()).toEqual({ pm2_5: 15, fetched_at: new Date(NOW).toISOString() });
  });
  it("tells the screen the newest hour out, from the last good fetch", async () => {
    const { readMeasured } = await import("../worker/src/soramame");
    const db = d1();
    await saveSoramame(db, NOW, api([row("2026/11/20", "22", "14")]));
    expect((await readMeasured(db, "39201350", "高知市 介良局", "2026-11-21", "2026-11-21")).newestOut).toBe("2026-11-20 22");
  });
});

describe("そらまめくん：画面用の読み出し（11/25、だれにでも）", () => {
  it("returns the day's hours with when each was written, and the last good check", async () => {
    const { readMeasured } = await import("../worker/src/soramame");
    const db = d1();
    await saveSoramame(db, NOW, api([row("2026/11/21", "01", "14"), row("2026/11/21", "02", "9"), row("2026/11/20", "24", "7")]));
    const r = await readMeasured(db, "39201350", "高知市 介良局", "2026-11-21", "2026-11-21");
    expect(r).toMatchObject({ station: "39201350", name: "高知市 介良局", date: "2026-11-21", checkedAt: new Date(NOW).toISOString() });
    expect(r.hours.map((h) => [h.hour, h.pm2_5])).toEqual([
      [1, 14],
      [2, 9],
    ]);
    expect(r.hours[0].fetchedAt).toBe(new Date(NOW).toISOString());
    // 手前の時間が7日分に届かないので、ふだんとは比べない
    expect(r.usual).toMatchObject({ from: "2026-10-22", to: "2026-11-20", items: { pm2_5: null, ox: null } });
  });
  it("the usual: the 30 days before the day (before today for today), by quantiles", async () => {
    const { readMeasured } = await import("../worker/src/soramame");
    const { ensureSoramameSchema } = await import("../worker/src/soramame");
    const db = d1();
    await ensureSoramameSchema(db);
    const put = db.raw.prepare("INSERT INTO soramame_hourly (station, date, hour, pm2_5, ox, spm, no2, so2, wd, ws, fetched_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 0.001, NULL, NULL, ?)");
    // 11/1〜11/20 の20日 × 24時間：PM2.5 は 0〜479、SO2 はずっと 0.001
    for (let d = 1; d <= 20; d++) for (let h = 1; h <= 24; h++) put.run("39201350", `2026-11-${String(d).padStart(2, "0")}`, h, (d - 1) * 24 + h - 1, "x");
    put.run("39201350", "2026-11-21", 1, 9999, "x"); // 見る日の分は入れない
    const r = await readMeasured(db, "39201350", "高知市 介良局", "2026-11-21", "2026-11-21");
    // 479 × 10%・75%・90%・98%（線形補間）
    expect(r.usual!.items.pm2_5!.n).toBe(480);
    expect(r.usual!.items.pm2_5!.q.map((x) => Math.round(x * 100) / 100)).toEqual([47.9, 359.25, 431.1, 469.42]);
    expect(r.usual!.items.so2).toEqual({ n: 480, q: [0.001, 0.001, 0.001, 0.001] });
    expect(r.usual!.items.ox).toBeNull();
  });
});
