// 今すぐ取り直す（worker/src/refetch.ts、#299 P1）：段を1回だけ動かす。1時間に3回まで、押した記録を残す。
import { describe, expect, it } from "vitest";
import { REFETCH_PER_HOUR, REFETCH_STAGES, RefetchRefused, refetchNow, refetchSummary, type Stage } from "../worker/src/refetch";
import { ensureRadarSchema } from "../worker/src/radarArchive";
import { d1 } from "./d1";

const NOW = Date.parse("2026-11-19T01:00:00Z");
let runs = 0;
const fake: Stage[] = [
  { id: "radar", name: "雨雲", reach: "約3時間", log: "radar_fetch_log", waiting: "waiting", needsBucket: true, run: async () => `${++runs}回目` },
  { id: "boom", name: "こわれる段", reach: "7日", log: "radar_fetch_log", waiting: null, needsBucket: false, run: async () => Promise.reject(new Error("JMA 503")) },
];
const bucket = { put: async () => {}, get: async () => null } as never;

describe("今すぐ取り直す", () => {
  it("段を1回動かして記録を残す。1時間に3回まで、1時間たてばまた押せる", async () => {
    const db = d1();
    runs = 0;
    for (let i = 0; i < REFETCH_PER_HOUR; i++) expect((await refetchNow(db, bucket, "radar", "admin1", NOW + i * 60_000, fake)).ok).toBe(true);
    await expect(refetchNow(db, bucket, "radar", "admin1", NOW + 10 * 60_000, fake)).rejects.toBeInstanceOf(RefetchRefused);
    expect(runs).toBe(3);
    expect((await refetchNow(db, bucket, "radar", "admin1", NOW + 61 * 60_000, fake)).detail).toBe("4回目");
    expect(db.raw.prepare("SELECT admin_id, stage, ok, detail FROM refetch_log ORDER BY id").all()).toHaveLength(4);
  });
  it("失敗も記録に残す。知らない段・保存先が無い段は断る", async () => {
    const db = d1();
    const r = await refetchNow(db, bucket, "boom", "admin1", NOW, fake);
    expect(r).toEqual({ stage: "boom", ok: false, detail: "失敗：JMA 503" });
    await expect(refetchNow(db, bucket, "nope", "admin1", NOW, fake)).rejects.toBeInstanceOf(RefetchRefused);
    await expect(refetchNow(db, undefined, "radar", "admin1", NOW, fake)).rejects.toThrow("R2");
  });
  it("管理画面の様子：段ごとの最後に取れた時刻・取り残し・残りの回数（表がまだ無くても読める）", async () => {
    const db = d1();
    await ensureRadarSchema(db);
    db.raw.prepare("INSERT INTO radar_fetch_log (at, ok, saved, waiting, error) VALUES (?, 1, 9, 18, NULL)").run(new Date(NOW - 300_000).toISOString());
    const s = await refetchSummary(db, NOW, true);
    expect(s.stages.map((x) => x.id)).toEqual(REFETCH_STAGES.map((x) => x.id));
    expect(s.stages[0]).toMatchObject({ id: "radar", lastOk: new Date(NOW - 300_000).toISOString(), waiting: 18, left: 3, available: true, last: null });
    expect(s.stages[1]).toMatchObject({ id: "forecast", lastOk: null, waiting: null });
    expect((await refetchSummary(db, NOW, false)).stages[0].available).toBe(false);
  });
});
