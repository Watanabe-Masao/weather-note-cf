import { describe, expect, it } from "vitest";
import { fetchJson } from "../../src/data/fetchJson";

const answer = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
const failing = (e: Error) => (async () => Promise.reject(e)) as unknown as typeof fetch;
const message = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

describe("what an API failure says on screen", () => {
  it("passes the Worker's own Japanese message", async () => {
    expect(await message(fetchJson("/x", answer(502, JSON.stringify({ error: "気象庁への接続に失敗しました（503）。" }))))).toBe("気象庁への接続に失敗しました（503）。");
  });

  it("never shows browser or server wording", async () => {
    expect(await message(fetchJson("/x", answer(502, JSON.stringify({ error: "fetch failed: ECONNRESET" }))))).toBe("取得に失敗しました。時間をおいて再試行してください。");
    expect(await message(fetchJson("/x", answer(500, "<html>Internal Server Error</html>")))).toBe("取得に失敗しました。時間をおいて再試行してください。");
    expect(await message(fetchJson("/x", failing(new TypeError("Load failed"))))).toBe("通信できませんでした。電波の状態を確かめてください。");
    const timeout = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
    expect(await message(fetchJson("/x", failing(timeout)))).toBe("取得に時間がかかりすぎました。時間をおいて再試行してください。");
    expect(await message(fetchJson("/x", answer(200, "not json")))).toBe("取得したデータを読み取れませんでした。時間をおいて再試行してください。");
  });

  it("returns the data when all is well", async () => {
    expect(await fetchJson("/x", answer(200, JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });
});
