// 欠けの発見（worker/src/completeness.ts、#299 P0）：「最新が取れた」と「履歴が完全」を分ける。予報の定時の発表の
// 1回ずつ、雨雲の30分ごとの時刻の1つずつを確かめ、まだ取り戻せる欠けと取り戻せない欠けを分け、取り戻せない欠けは
// 1度だけ残す（消さない）。

import { describe, expect, it } from "vitest";
import { judgeHealth } from "../shared/healthJudge";
import { auditCompleteness, auditForecasts, auditRadar, readCompleteness, scheduledTimes } from "../worker/src/completeness";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { ensureRadarSchema } from "../worker/src/radarArchive";
import { d1 } from "./d1";

const J = (s: string) => Date.parse(`${s}+09:00`);
async function withForecasts(issued: string[]) {
  const db = d1();
  await ensureForecastSchema(db);
  for (const t of issued)
    db.raw
      .prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, 'VPFD51', '390000', 'u', ?, 'f', 'h', 'x')")
      .run(`${t}_VPFD51`, `${t}+09:00`);
  return db;
}

describe("予報の電文：定時の発表が1回ずつそろっているか", () => {
  it("定時（府県 5・11・17時）を日本時間で並べる", () => {
    expect(scheduledTimes("VPFD51", J("2026-11-16T10:00:00"), J("2026-11-17T06:00:00"))).toEqual([
      "2026-11-16T11:00:00+09:00",
      "2026-11-16T17:00:00+09:00",
      "2026-11-17T05:00:00+09:00",
    ]);
  });
  it("最新が届いていても、間の1回が抜けていれば欠け。続けて確かめられた位置はその前まで", async () => {
    const db = await withForecasts(["2026-11-16T05:00:00", "2026-11-16T11:00:00", "2026-11-16T17:00:00", "2026-11-17T05:00:00", "2026-11-17T17:00:00", "2026-11-18T05:02:00"]);
    const a = (await auditForecasts(db, J("2026-11-18T12:30:00"))).VPFD51;
    expect(a).toMatchObject({ from: "2026-11-16T05:00:00+09:00", to: "2026-11-18T11:00:00+09:00", expected: 8, kept: 6, watermark: "2026-11-17T05:00:00+09:00", lost: [] });
    expect(a.pending).toEqual(["2026-11-17T11:00:00+09:00", "2026-11-18T11:00:00+09:00"]);
  });
  it("7日を過ぎた欠けは取り戻せない：data_gaps に1度だけ残し、消さない", async () => {
    const db = await withForecasts(["2026-11-10T05:00:00", "2026-11-10T17:00:00"]);
    const now = J("2026-11-18T06:30:00");
    const first = await auditCompleteness(db, now);
    // 一覧の7日（11/11 6:30 より前）から外れた2回が取り戻せない。それより後の欠けはまだ取り戻せる
    expect(first.forecast.VPFD51.lost).toEqual(["2026-11-10T11:00:00+09:00", "2026-11-11T05:00:00+09:00"]);
    expect(first.forecast.VPFD51.pending[0]).toBe("2026-11-11T11:00:00+09:00");
    expect(first.newlyLost).toBe(2);
    expect((await auditCompleteness(db, now + 3_600_000)).newlyLost).toBe(0);
    expect(db.raw.prepare("SELECT source, item FROM data_gaps ORDER BY item").all()).toEqual([
      { source: "forecast:VPFD51", item: "2026-11-10T11:00:00+09:00" },
      { source: "forecast:VPFD51", item: "2026-11-11T05:00:00+09:00" },
    ]);
  });
  it("保存を始める前の時刻・今から1時間以内の回は数えない。表が無いときは空", async () => {
    const db = await withForecasts(["2026-11-18T05:00:00"]);
    expect((await auditForecasts(db, J("2026-11-18T11:30:00"))).VPFD51).toMatchObject({ expected: 1, kept: 1, pending: [] });
    expect(await readCompleteness(d1(), J("2026-11-18T11:30:00"))).toEqual({ forecast: {}, radar: {}, lostLastDay: [], lostAll: [], recoveredAll: [], absentAll: [] });
  });
});

describe("雨雲：30分ごとの時刻に9枚そろっているか", () => {
  it("欠けた時刻を、まだ取り戻せる（約3時間）と取り戻せないに分け、続けて確かめられた位置を出す", async () => {
    const db = d1();
    await ensureRadarSchema(db);
    const now = J("2026-11-18T12:10:00");
    // 6:00〜11:00 の 11時刻。7:00 は5枚だけ、10:30 は無し
    for (let t = J("2026-11-18T06:00:00"); t <= J("2026-11-18T11:00:00"); t += 1_800_000) {
      const iso = `${new Date(t + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;
      const n = iso.includes("T07:00") ? 5 : iso.includes("T10:30") ? 0 : 9;
      for (let i = 0; i < n; i++) db.raw.prepare("INSERT INTO radar_saved (key, valid_at, jma_time, z, x, y, bytes, sha256, fetched_at) VALUES (?, ?, 'x', 8, ?, 0, 1, 'h', 'f')").run(`radar/hrpns/${iso}/${i}`, iso, i);
    }
    const a = (await auditRadar(db, now)).hrpns;
    expect(a).toMatchObject({ expected: 11, kept: 9, watermark: "2026-11-18T06:30:00+09:00", lost: ["2026-11-18T07:00:00+09:00"], pending: ["2026-11-18T10:30:00+09:00"] });
  });
});

describe("毎時の見張り：欠け", () => {
  const base = {
    state: { forecastLastOk: null as string | null, typhoonLastOk: null as string | null, openAlerts: [], accountErrorsLastDay: [] },
    room: { d1Size: null, d1WritesMonth: { percent: 1 }, r2: { percentOfFree: 1 }, cron: { runsLastDay: 288, stages: [] } },
    waste: { unparsed: 0, parseFailed: 0, fetchFailuresLastDay: 0 },
  };
  const now = J("2026-11-18T12:00:00");
  const keys = (completeness: object) => {
    const j = judgeHealth({ ...base, state: { ...base.state, forecastLastOk: new Date(now).toISOString(), typhoonLastOk: new Date(now).toISOString(), completeness } } as never, now);
    return { problems: j.problems.map((p) => p.key), notes: j.notes.map((n) => n.key), text: [...j.problems, ...j.notes].map((f) => f.text) };
  };
  it("まだ取り戻せる欠けが3時間で注意、5日で異常。取り戻せない欠けが24時間で出たら注意", () => {
    const f = (t: string) => ({ forecast: { VPFD51: { pending: [t], pendingCount: 1, lostCount: 0 } }, lostLastDay: [] });
    expect(keys(f("2026-11-18T11:00:00+09:00"))).toMatchObject({ problems: [], notes: [] });
    expect(keys(f("2026-11-18T05:00:00+09:00")).notes).toContain("forecastGap");
    const old = keys(f("2026-11-12T05:00:00+09:00"));
    expect(old.problems).toContain("forecastGap");
    expect(old.text[0]).toContain("府県天気予報の 11/12 5:00 の発表");
    expect(keys({ forecast: {}, lostLastDay: [{ source: "radar:hrpns", n: 2 }] }).notes).toContain("dataLost");
  });
});

// 取れなかった／出ていない（#299 P1、2026-11-19）：一覧に載っていた証拠（source_listed）と、一覧を読めた回の記録で分ける。
import { ensureListedSchema, noteListed } from "../worker/src/listed";
describe("取れなかった／提供元が出していない、を分ける", () => {
  it("一覧を読めた回があったのに一度も載らなかった回は「出ていない」（欠けではない、位置も止めない）。載っていたのに取れなかった回は「取り戻せない」", async () => {
    const db = await withForecasts(["2026-11-10T05:00:00", "2026-11-10T17:00:00", "2026-11-11T05:00:00"]);
    await ensureListedSchema(db);
    // 証拠を取り始めた：5時・17時は載った。11時は載らなかった（10日）。
    await noteListed(db, "forecast:VPFD51", ["2026-11-10T05:00:00+09:00", "2026-11-10T17:00:00+09:00", "2026-11-11T05:00:00+09:00", "2026-11-11T11:00:00+09:00"], J("2026-11-11T12:00:00"));
    // 一覧を読めた回（10日 12時・18時、11日 12時の短い一覧）
    for (const t of ["2026-11-10T12:30:00", "2026-11-10T18:30:00", "2026-11-11T12:30:00"])
      db.raw.prepare("INSERT INTO forecast_fetch_log (at, feed, ok, entries, wanted, added, left_over, error) VALUES (?, 'short', 1, 10, 1, 0, 0, NULL)").run(new Date(J(t)).toISOString());
    const now = J("2026-11-18T13:00:00");
    const r = await auditCompleteness(db, now);
    const a = r.forecast.VPFD51;
    expect(a.absent).toEqual(["2026-11-10T11:00:00+09:00"]); // 読めた回に載らなかった
    expect(a.lost).toEqual(["2026-11-11T11:00:00+09:00"]); // 載っていたのに取れなかった
    expect(a.watermark).toBe("2026-11-11T05:00:00+09:00"); // 出ていない回では止めない
    expect(db.raw.prepare("SELECT source, item FROM data_absent").all()).toEqual([{ source: "forecast:VPFD51", item: "2026-11-10T11:00:00+09:00" }]);
    expect(db.raw.prepare("SELECT item FROM data_gaps").all()).toEqual([{ item: "2026-11-11T11:00:00+09:00" }]);
    expect((await readCompleteness(db, now)).absentAll).toEqual([{ source: "forecast:VPFD51", n: 1 }]);
  });
  it("証拠を取り始める前の時刻・読めた回の無い時刻は分けられない：取り戻せない欠けのまま", async () => {
    const db = await withForecasts(["2026-11-10T05:00:00"]);
    await noteListed(db, "forecast:VPFD51", ["2026-11-10T17:00:00+09:00"], J("2026-11-10T18:00:00"));
    const a = (await auditCompleteness(db, J("2026-11-18T06:30:00"))).forecast.VPFD51;
    expect(a.absent).toEqual([]);
    expect(a.lost[0]).toBe("2026-11-10T11:00:00+09:00"); // 証拠を取り始める（17時）より前
  });
});

describe("雨雲：一覧に無かった時刻は「出ていない」", () => {
  it("読めた回の一覧に一度も載らなかった時刻（7:00）は欠けではない。載っていて取れなかった時刻（7:30）は取り戻せない", async () => {
    const db = d1();
    await ensureRadarSchema(db);
    const iso = (t: number) => `${new Date(t + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;
    const listed: string[] = [];
    for (let t = J("2026-11-18T06:00:00"); t <= J("2026-11-18T08:00:00"); t += 1_800_000) {
      const s = iso(t);
      if (!s.includes("T07:00")) listed.push(s);
      const n = s.includes("T07:00") || s.includes("T07:30") ? 0 : 9;
      for (let i = 0; i < n; i++) db.raw.prepare("INSERT INTO radar_saved (key, valid_at, jma_time, z, x, y, bytes, sha256, fetched_at) VALUES (?, ?, 'x', 8, ?, 0, 1, 'h', 'f')").run(`radar/hrpns/${s}/${i}`, s, i);
    }
    await noteListed(db, "radar:hrpns", listed, J("2026-11-18T08:05:00"));
    db.raw.prepare("INSERT INTO radar_fetch_log (at, ok, saved, waiting, error) VALUES (?, 1, 0, 0, NULL)").run(new Date(J("2026-11-18T08:05:00")).toISOString());
    const a = (await auditRadar(db, J("2026-11-18T12:10:00"))).hrpns;
    expect(a.absent).toEqual(["2026-11-18T07:00:00+09:00"]);
    expect(a.lost[0]).toBe("2026-11-18T07:30:00+09:00"); // 8:30 から後は証拠が無い（読めた回の後）ので取り戻せないのまま
  });
});

import { LISTED_OFFICE } from "../worker/src/forecastArchive";
import { FORECAST_WATCH_OFFICE } from "../worker/src/forecastWatch";
it("一覧の印を残す予報区は、見張る予報区と同じ", () => expect(LISTED_OFFICE).toBe(FORECAST_WATCH_OFFICE));

// 取り戻した印（2026-11-19、DB 設計の提案の Recovered）：欠けた事実は消さず、後で埋まったら日と手段を付ける。
import { ensureForecastParseSchema } from "../worker/src/forecastParse";
describe("後で取り戻した欠け", () => {
  it("自前の電文が後から入った回・過去の記録で埋まった回に印を付け、行は残す。取り戻せない数からは外れる", async () => {
    const db = await withForecasts(["2026-11-10T05:00:00", "2026-11-10T17:00:00"]);
    const now = J("2026-11-18T06:30:00");
    await auditCompleteness(db, now); // 11/10 11:00・11/11 05:00 が取り戻せない
    db.raw
      .prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES ('late', 'VPFD51', '390000', 'u', '2026-11-10T11:02:00+09:00', 'f', 'h9', 'x')")
      .run();
    await ensureForecastParseSchema(db);
    db.raw
      .prepare("INSERT INTO forecast_issues (issue_id, source, office, kind, issued_at, preferred, parser, entries) VALUES ('s1', 'shiromatz', '390000', 'VPFD51', '2026-11-11T05:00:00+09:00', 0, 1, 10)")
      .run();
    const r = await auditCompleteness(db, now + 3_600_000);
    expect(r.newlyRecovered).toBe(2);
    expect(db.raw.prepare("SELECT item, recovered_by FROM data_gaps ORDER BY item").all()).toEqual([
      { item: "2026-11-10T11:00:00+09:00", recovered_by: "自前の電文" },
      { item: "2026-11-11T05:00:00+09:00", recovered_by: "過去の記録（shiromatz）" },
    ]);
    const c = await readCompleteness(db, now + 3_600_000);
    expect(c.lostAll).toEqual([]);
    expect(c.recoveredAll).toEqual([{ source: "forecast:VPFD51", n: 2 }]);
    expect((await auditCompleteness(db, now + 7_200_000)).newlyRecovered).toBe(0);
  });
});
