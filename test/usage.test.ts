// 実際の使用量 (worker/src/usage.ts): the month's use read from Cloudflare's GraphQL Analytics, with a
// made-up answer — each product asked apart, one that fails said and not shown as 0, R2's operations
// counted as Class A or B.

import { describe, expect, it } from "vitest";
import { health } from "../worker/src/health";
import { monthUsage } from "../worker/src/usage";
import { d1 } from "./d1";

const env = { CF_ANALYTICS_TOKEN: "t", CF_ACCOUNT_ID: "acc" };
const NOW = Date.parse("2026-11-17T04:00:00Z");

function cloudflare(fail: string[] = []) {
  const asked: { query: string; variables: Record<string, unknown>; auth: string }[] = [];
  const post = async (_url: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    asked.push({ ...b, auth: (init.headers as Record<string, string>).Authorization });
    const which = b.query.includes("workersInvocationsAdaptive") ? "workers" : b.query.includes("d1Analytics") ? "d1" : "r2";
    if (fail.includes(which)) return { ok: true, status: 200, json: async () => ({ data: null, errors: [{ message: "not authorized for that account" }] }) };
    const account =
      which === "workers"
        ? { w: [{ sum: { requests: 120_000, errors: 3, subrequests: 40_000 }, quantiles: { cpuTimeP50: 2_500, cpuTimeP99: 60_000 } }] }
        : which === "d1"
          ? { q: [{ sum: { readQueries: 50_000, writeQueries: 9_000, rowsRead: 2_000_000, rowsWritten: 400_000 } }], s: [{ max: { databaseSizeBytes: 52_000_000 } }] }
          : {
              o: [
                { sum: { requests: 900 }, dimensions: { actionType: "PutObject" } },
                { sum: { requests: 950 }, dimensions: { actionType: "GetObject" } },
                { sum: { requests: 5 }, dimensions: { actionType: "ListObjects" } },
              ],
              s: [{ max: { payloadSize: 120_000_000, objectCount: 1_800 } }],
            };
    return { ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [account] } }, errors: null }) };
  };
  return { post, asked };
}

describe("実際の使用量", () => {
  it("reads the month's use of the Worker, D1 and R2 with the read-only token", async () => {
    const c = cloudflare();
    const u = await monthUsage(env, NOW, c.post);
    expect(u).toMatchObject({
      ok: true,
      from: "2026-11-01T00:00:00.000Z",
      workers: { ok: true, value: { requests: 120_000, errors: 3, cpuP50Us: 2_500 } },
      d1: { ok: true, value: { rowsWritten: 400_000, sizeBytes: 52_000_000 } },
      r2: { ok: true, value: { classA: 905, classB: 950, bytes: 120_000_000, objects: 1_800 } },
    });
    expect(c.asked).toHaveLength(3);
    expect(c.asked.every((a) => a.auth === "Bearer t" && a.variables.accountTag === "acc")).toBe(true);
    expect(c.asked[1].variables).toMatchObject({ from: "2026-11-01", to: "2026-11-17" });
  });

  it("says a part it could not read, and reads the others", async () => {
    const u = await monthUsage(env, NOW, cloudflare(["d1"]).post);
    expect(u.ok && u.d1).toEqual({ ok: false, error: "not authorized for that account" });
    expect(u.ok && u.workers.ok).toBe(true);
  });

  it("says when the token is not set, instead of showing nothing used", async () => {
    expect(await monthUsage({}, NOW)).toEqual({ ok: false, error: "CF_ANALYTICS_TOKEN / CF_ACCOUNT_ID が設定されていません" });
  });

  it("puts the measure in the health read, against the plan", async () => {
    const h = await health(d1(), NOW, env, cloudflare(["r2"]).post);
    expect(h.usage).toMatchObject({
      workers: { requests: 120_000, requestsPercent: 1.2, cpuMsEstimate: 300_000, cpuPercentEstimate: 1 },
      d1: { rowsWritten: 400_000, rowsWrittenPercent: 0.8 },
      r2: { error: "not authorized for that account" },
    });
  });
});
