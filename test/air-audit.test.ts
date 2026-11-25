// 空気のデータの欠けの発見（worker/src/airAudit.ts）と見張り（shared/healthJudge.ts）、提供スケジュール（shared/airSchedule.ts）。
// 漏れ：毎時の並びで欠けを数える（猶予の間は数えない）。重複：主キーで同じ時間は1行。出ていない：提供元の空欄は欠けとしない。
import { describe, expect, it } from "vitest";
import { auditCams, auditForecast, auditHours, auditSoramame, soramameEnd } from "../worker/src/airAudit";
import { ensureAirSchema } from "../worker/src/airQuality";
import { ensureAirForecastSchema } from "../worker/src/airForecast";
import { ensureSoramameSchema, saveSoramame } from "../worker/src/soramame";
import { judgeHealth } from "../shared/healthJudge";
import { AIR_FEEDS } from "../shared/airSchedule";
import { RUNBOOK } from "../shared/runbook";
import { ensureCompletenessSchema } from "../worker/src/completeness";
import { d1 } from "./d1";

const J = (s: string) => Date.parse(`${s}+09:00`);
const iso = (s: string) => `${s}+09:00`;

describe("提供スケジュール", () => {
  it("3つの系統それぞれに、提供・取得・遅れの目安・取り戻せる長さ・欠けたとき・手順がある", () => {
    expect(AIR_FEEDS.map((f) => f.id)).toEqual(["forecast", "cams", "soramame"]);
    for (const f of AIR_FEEDS) {
      expect(f.publish && f.fetch && f.reach && f.refill).toBeTruthy();
      expect(f.lateH).toBeGreaterThan(0);
      expect(RUNBOOK.some((r) => r.code === f.runbook)).toBe(true);
    }
  });
});

describe("毎時の並び", () => {
  it("欠け・出ていない・続けて確かめられた位置", () => {
    const t = ["a1", "a2", "a3", "a4"];
    expect(auditHours(t, new Set(["a1", "a4"]), new Set(["a2"]))).toMatchObject({ expected: 3, kept: 2, watermark: "a2", pending: ["a3"], absent: ["a2"] });
  });
  it("そらまめくんの 24時はその日の終わり（翌日の0時）", () => {
    expect(soramameEnd("2026-11-24", 24)).toBe(iso("2026-11-25T00:00:00"));
    expect(soramameEnd("2026-11-25", 1)).toBe(iso("2026-11-25T01:00:00"));
  });
});

describe("CAMS（終わった日）", () => {
  it("昨日の分は日付が変わって3時間たってから数える。値の無い時間は欠け", async () => {
    const db = d1();
    await ensureAirSchema(db);
    const put = db.raw.prepare("INSERT INTO air_quality_hourly (station, valid_at, pm2_5, pm10, dust, aod, source, fetched_at) VALUES ('47893', ?, ?, NULL, NULL, NULL, 'x', 'x')");
    for (const d of ["2026-11-23", "2026-11-24"]) for (let h = 0; h < 24; h++) put.run(iso(`${d}T${String(h).padStart(2, "0")}:00:00`), d === "2026-11-24" && h === 5 ? null : 8);
    // 11/25 2時：昨日（11/24）はまだ数えない → 11/23 の24時間だけ
    expect(await auditCams(db, "47893", J("2026-11-25T02:00:00"))).toMatchObject({ expected: 24, kept: 24, pending: [] });
    // 11/25 4時：11/24 も数え、5時が欠け
    expect(await auditCams(db, "47893", J("2026-11-25T04:00:00"))).toMatchObject({ expected: 48, kept: 47, pending: [iso("2026-11-24T05:00:00")] });
  });
});

describe("そらまめくん", () => {
  it("その1時間の終わりから3時間たった時間まで数える。提供元の空欄は出ていない（欠けではない）。最新", async () => {
    const db = d1();
    await ensureSoramameSchema(db);
    await ensureCompletenessSchema(db);
    const put = db.raw.prepare("INSERT INTO soramame_hourly (station, date, hour, pm2_5, ox, spm, no2, so2, wd, ws, fetched_at) VALUES ('39201350', ?, ?, 8, NULL, NULL, NULL, NULL, NULL, NULL, 'x')");
    for (let h = 1; h <= 12; h++) if (h !== 6 && h !== 9) put.run("2026-11-25", h);
    db.raw.prepare("INSERT INTO data_absent (source, item, found_at) VALUES ('air:soramame:39201350', ?, 'x')").run(iso("2026-11-25T09:00:00"));
    const a = await auditSoramame(db, "39201350", J("2026-11-25T14:30:00"));
    // 1時〜11時（14:30 の3時間前まで）：6時が欠け、9時は出ていない
    expect(a).toMatchObject({ expected: 10, kept: 9, pending: [iso("2026-11-25T06:00:00")], absent: [iso("2026-11-25T09:00:00")], newest: iso("2026-11-25T12:00:00") });
  });
  it("CSV と検索の API で同じ時間が来ても1行（重複しない）。空欄の古い時間は出ていないとして残す", async () => {
    const db = d1();
    const HEAD = "年,月,日,時,SO2,NO,NO2,NOX,CO,OX,NMHC,CH4,THC,SPM,PM2.5,SP,WD,WS,TEMP,HUM";
    const lines = ["2026,11,21,01,0,0,0.007,0.007,  ,0.03,  ,  ,  ,0,4,  ,南,0.6,  ,  ", "2026,11,21,02,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  ,  "];
    const row = { SKT_CD: "39201350", SKT_DATE: "2026/11/21", SKT_TIME: "01", PM2_5: "4", OX: "0.03", SPM: "0", NO2: "0.007", SO2: "0", WD: "S", WS: "0.6" };
    const get = async (u: string) => ({ ok: true, status: 200, text: async () => (u.includes("7day.csv") ? [HEAD, ...lines].join("\n") : JSON.stringify([row])) });
    await saveSoramame(db, J("2026-11-21T12:00:00"), get);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM soramame_hourly").get()).toEqual({ n: 1 });
    expect(db.raw.prepare("SELECT source, item FROM data_absent").all()).toEqual([{ source: "air:soramame:39201350", item: iso("2026-11-21T02:00:00") }]);
  });
});

describe("予測のそろい", () => {
  it("今日の0時から4日先の23時までの96時間", async () => {
    const db = d1();
    await ensureAirForecastSchema(db);
    const put = db.raw.prepare("INSERT INTO air_quality_forecast (station, valid_at, pm2_5, pm10, dust, aod, fetched_at) VALUES ('47893', ?, 8, NULL, NULL, NULL, 'x')");
    for (let i = 0; i < 80; i++) put.run(`${new Date(J("2026-11-25T00:00:00") + i * 3_600_000 + 9 * 3_600_000).toISOString().slice(0, 13)}:00:00+09:00`);
    expect(await auditForecast(db, "47893", J("2026-11-25T10:00:00"))).toMatchObject({ expected: 96, kept: 80 });
  });
});

describe("見張り：空気のデータ", () => {
  const now = J("2026-11-25T15:00:00");
  const base = {
    state: { forecastLastOk: new Date(now).toISOString(), typhoonLastOk: new Date(now).toISOString(), openAlerts: [], accountErrorsLastDay: [] },
    room: { d1Size: null, d1WritesMonth: { percent: 1 }, r2: { percentOfFree: 1 }, cron: { runsLastDay: 288, stages: [] } },
    waste: { unparsed: 0, parseFailed: 0, fetchFailuresLastDay: 0 },
  };
  const air = (over: object = {}) => ({
    cams: { pending: [], pendingCount: 0 },
    soramame: { pending: [], pendingCount: 0, newest: iso("2026-11-25T14:00:00") },
    forecast: { expected: 96, kept: 96 },
    ...over,
  });
  const keys = (a: object) => {
    const j = judgeHealth({ ...base, state: { ...base.state, completeness: { forecast: {}, lostLastDay: [], air: a } } } as never, now);
    return { problems: j.problems.map((p) => p.key), notes: j.notes.map((n) => n.key) };
  };
  it("ふだんは何も言わない", () => expect(keys(air())).toEqual({ problems: [], notes: [] }));
  it("実測の最新が3時間より古ければ注意、12時間で異常", () => {
    expect(keys(air({ soramame: { pending: [], pendingCount: 0, newest: iso("2026-11-25T11:00:00") } })).notes).toContain("soramameLate");
    expect(keys(air({ soramame: { pending: [], pendingCount: 0, newest: iso("2026-11-24T22:00:00") } })).problems).toContain("soramameLate");
  });
  it("欠けと予測の不足は注意", () => {
    expect(keys(air({ cams: { pending: [iso("2026-11-24T05:00:00")], pendingCount: 1 } })).notes).toContain("airGap");
    expect(keys(air({ forecast: { expected: 96, kept: 60 } })).notes).toContain("airForecastShort");
  });
});
