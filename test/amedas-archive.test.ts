// アメダスの10分ごとの観測の保存（worker/src/amedasArchive.ts）を D1 の代わりと Map のバケットで：終わった
// 3時間のファイルだけを新しい順に、8日前まで、1回に決まった数ずつ。まだ出ていない分は待ち、失敗は記録。

import { describe, expect, it } from "vitest";
import { judgeHealth } from "../shared/healthJudge";
import { amedasKey, amedasPoints, dueBlocks, LOOKBACK_DAYS, saveAmedas } from "../worker/src/amedasArchive";
import { gunzip } from "../worker/src/r2Archive";
import { d1 } from "./d1";

function bucket() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(key: string, value: ArrayBuffer | Uint8Array) {
      files.set(key, new Uint8Array(value as ArrayBuffer));
    },
    async get(key: string) {
      const v = files.get(key);
      return v ? { arrayBuffer: async () => v.buffer as ArrayBuffer } : null;
    },
  };
}

const POINT = JSON.stringify({ "20261121000000": { temp: [14, 0], visibility: [20000, 0], weather: [1, 0] }, "20261121001000": { temp: [13.9, 0], visibility: [20000, 0] } });
const body = (s: string) => ({ ok: true, status: 200, text: async () => s, arrayBuffer: async () => new TextEncoder().encode(s).buffer as ArrayBuffer });
const none = (status: number) => ({ ok: false, status, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) });
// 2026-11-21 12:31 JST
const NOW = Date.parse("2026-11-21T03:31:00Z");

describe("アメダスの保存：どのファイルを取るか", () => {
  it("is Kochi (74182) and names the file by its JST day and starting hour", () => {
    expect(amedasPoints()).toEqual(["74182"]);
    expect(amedasKey("74182", "2026-11-21", 9)).toBe("amedas/point/74182/2026-11/20261121_09.json.gz");
  });
  it("takes only the 3 hours that ended 20 minutes ago or more, newest first, back 8 days", () => {
    const due = dueBlocks("74182", NOW);
    // 12:31：09〜12時は 12:20 に終わりから20分（取る）。12〜15時はまだ。
    expect(due[0].blockAt).toBe("2026-11-21T09:00:00+09:00");
    expect(due[0].url).toBe("https://www.jma.go.jp/bosai/amedas/data/point/74182/20261121_09.json");
    expect(dueBlocks("74182", Date.parse("2026-11-21T03:19:00Z"))[0].blockAt).toBe("2026-11-21T06:00:00+09:00");
    expect(due.length).toBe(LOOKBACK_DAYS * 8 - 1);
    expect(due.at(-1)!.blockAt).toBe("2026-11-13T15:00:00+09:00");
  });
});

describe("アメダスの保存：保存と記録", () => {
  it("saves gzipped originals a few at a time, skips what is saved, and waits for files not out yet", async () => {
    const db = d1();
    const b = bucket();
    const seen: string[] = [];
    const get = async (url: string) => {
      seen.push(url);
      return url.endsWith("20261121_09.json") ? none(404) : body(POINT);
    };
    expect(await saveAmedas(db, b, NOW, get, 4)).toEqual({ saved: 3, waiting: 1 + (LOOKBACK_DAYS * 8 - 1 - 4), ok: true });
    const key = "amedas/point/74182/2026-11/20261121_06.json.gz";
    expect(new TextDecoder().decode(await gunzip(b.files.get(key)! as Uint8Array<ArrayBuffer>))).toBe(POINT);
    expect(db.raw.prepare("SELECT point, block_at, times FROM amedas_saved WHERE key = ?").get(key)).toEqual({ point: "74182", block_at: "2026-11-21T06:00:00+09:00", times: 2 });
    // 次の回は、保存したものを取り直さない（まだの 09 時を先に、その後ろへ）。
    seen.length = 0;
    await saveAmedas(db, b, NOW + 300_000, get, 4);
    expect(seen.some((u) => u.endsWith("20261121_06.json"))).toBe(false);
    expect(seen[0].endsWith("20261121_09.json")).toBe(true);
  });
  it("logs a failure (not JSON, HTTP 503) and the hourly look tells when it lasts", async () => {
    const db = d1();
    const get = async (url: string) => (url.endsWith("_09.json") ? none(503) : url.endsWith("_06.json") ? body("<html>") : body(POINT));
    expect(await saveAmedas(db, bucket(), NOW, get, 3)).toMatchObject({ saved: 1, ok: false });
    expect(db.raw.prepare("SELECT ok, saved, error FROM amedas_fetch_log").get()).toMatchObject({ ok: 0, saved: 1 });
    const base = {
      state: { forecastLastOk: new Date(NOW).toISOString(), typhoonLastOk: new Date(NOW).toISOString(), openAlerts: [], accountErrorsLastDay: [] },
      room: { d1Size: null, d1WritesMonth: { percent: 1 }, r2: { percentOfFree: 1 }, cron: { runsLastDay: 288, stages: [] } },
      waste: { unparsed: 0, parseFailed: 0, fetchFailuresLastDay: 0 },
    };
    const keys = (h: number) => {
      const j = judgeHealth({ ...base, state: { ...base.state, amedasLastOk: new Date(NOW - h * 3_600_000).toISOString() } } as never, NOW);
      return { problems: j.problems.map((p) => p.key), notes: j.notes.map((n) => n.key) };
    };
    expect(keys(1)).toEqual({ problems: [], notes: [] });
    expect(keys(13).notes).toContain("amedasStale");
    expect(keys(49).problems).toContain("amedasStale");
  });
});
