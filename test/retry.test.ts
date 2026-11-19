// 再試行と、間隔を延ばしていく待ち（worker/src/retry.ts、health.ts timed）。
import { describe, expect, it } from "vitest";
import { retryingFetch, transientD1 } from "../worker/src/retry";
import { timed } from "../worker/src/health";
import { d1 } from "./d1";

const res = (status: number) => new Response("x", { status });
function base(seq: (Response | Error)[]) {
  const calls: string[] = [];
  const f = (async (u: string) => {
    calls.push(u);
    const r = seq.shift()!;
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { f, calls };
}

describe("気象庁の取得のやり直し", () => {
  const waits: number[] = [];
  const wait = async (ms: number) => void waits.push(ms);
  it("5xx・429・接続の切れは、待ちを延ばしながら3回まで", async () => {
    waits.length = 0;
    const b = base([res(503), new TypeError("Network connection lost"), res(200)]);
    const r = await retryingFetch(20_000, [500, 2000], wait, b.f)("u");
    expect(r.status).toBe(200);
    expect(b.calls.length).toBe(3);
    expect(waits).toEqual([500, 2000]);
  });
  it("3回とも一時的な失敗なら、最後の答えを返す（次の定時処理が取り直す）", async () => {
    const b = base([res(503), res(503), res(502)]);
    expect((await retryingFetch(20_000, [500, 2000], wait, b.f)("u")).status).toBe(502);
    expect(b.calls.length).toBe(3);
  });
  it("4xx と時間切れはやり直さない", async () => {
    const b = base([res(404)]);
    expect((await retryingFetch(20_000, [500, 2000], wait, b.f)("u")).status).toBe(404);
    expect(b.calls.length).toBe(1);
    const t = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const c = base([t, res(200)]);
    await expect(retryingFetch(20_000, [500, 2000], wait, c.f)("u")).rejects.toThrow("timed out");
    expect(c.calls.length).toBe(1);
  });
});

describe("D1 の一時的な失敗", () => {
  it("接続の切れ・混雑は一時的、表が無い・SQL の誤り・制約は一時的でない", () => {
    expect(transientD1(new Error("D1_ERROR: Network connection lost."))).toBe(true);
    expect(transientD1(new Error("D1_ERROR: D1 DB is overloaded. Requests queued for too long."))).toBe(true);
    expect(transientD1(new Error("D1_ERROR: no such column: recovered_at"))).toBe(false);
    expect(transientD1(new Error("D1_ERROR: UNIQUE constraint failed: users.login_id"))).toBe(false);
    expect(transientD1(new Error("This promise was created by a request that has since ended"))).toBe(false);
  });
  it("定時処理の段は、一時的な D1 の失敗のあと1回だけやり直し、済めば成功として残す", async () => {
    const db = d1();
    let n = 0;
    await timed(db, "2026-11-19T02:00:00.000Z", "x", async () => {
      if (++n === 1) throw new Error("D1_ERROR: Network connection lost.");
    });
    expect(n).toBe(2);
    expect(db.raw.prepare("SELECT ok, error FROM cron_runs WHERE stage = 'x'").get()).toEqual({ ok: 1, error: "（一時的な D1 の失敗のあと、やり直して済んだ）" });
    let m = 0;
    await timed(db, "2026-11-19T02:05:00.000Z", "y", async () => {
      m++;
      throw new Error("D1_ERROR: no such table: t");
    });
    expect(m).toBe(1);
    expect(db.raw.prepare("SELECT ok FROM cron_runs WHERE stage = 'y'").get()).toEqual({ ok: 0 });
  });
});
