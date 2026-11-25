// 空気質の取り置き（src/data/air.ts の LiveCache、11/25 レビュー）：日付が変わって「今日」が「昨日」になった日は
// すぐに1回取り直す。そのあとも終わった日の値に替わるまで（settled が false の間）、今日と同じ間隔で取り直す。
import { describe, expect, it } from "vitest";
import { LiveCache } from "../../src/data/air";
import { LIVE_EVERY } from "../../src/data/store";

type R = { kind: "past" | "forecast" };

function setup(answers: R[]) {
  let now = Date.parse("2026-11-24T14:58:00Z"); // 11/24 23:58 JST
  let today = "2026-11-24";
  const asked: string[] = [];
  const cache = new LiveCache<R>(
    async (_s, d) => (asked.push(d), answers.shift() ?? { kind: "past" }),
    () => now,
    () => today,
    (r) => r.kind === "past",
  );
  return {
    cache,
    asked,
    at: (t: string, day: string) => {
      now = Date.parse(t);
      today = day;
    },
  };
}

describe("空気質の取り置き：日付が変わったとき", () => {
  it("asks again at once after midnight, then every LIVE_EVERY until the finished day arrives", async () => {
    const t = setup([{ kind: "forecast" }, { kind: "forecast" }, { kind: "past" }]);
    await t.cache.ensure("47893", "2026-11-24");
    expect(t.asked).toEqual(["2026-11-24"]);
    // 0:01（3分後、LIVE_EVERY より前）：昨日になったので すぐ取り直す
    t.at("2026-11-24T15:01:00Z", "2026-11-25");
    await t.cache.ensure("47893", "2026-11-24");
    expect(t.asked.length).toBe(2);
    expect(t.cache.get("47893", "2026-11-24").r).toEqual({ kind: "forecast" });
    // まだ予測のまま：間隔の前は取らない、たてば取る
    t.at("2026-11-24T15:05:00Z", "2026-11-25");
    await t.cache.ensure("47893", "2026-11-24");
    expect(t.asked.length).toBe(2);
    t.at(new Date(Date.parse("2026-11-24T15:01:00Z") + LIVE_EVERY).toISOString(), "2026-11-25");
    await t.cache.ensure("47893", "2026-11-24");
    expect(t.asked.length).toBe(3);
    expect(t.cache.get("47893", "2026-11-24").r).toEqual({ kind: "past" });
    // 終わった日の値になったら、もう取らない
    t.at("2026-11-25T03:00:00Z", "2026-11-25");
    await t.cache.ensure("47893", "2026-11-24");
    expect(t.asked.length).toBe(3);
  });
  it("a day already past when asked is asked once", async () => {
    const t = setup([{ kind: "past" }]);
    t.at("2026-11-25T01:00:00Z", "2026-11-25");
    await t.cache.ensure("47893", "2026-11-20");
    t.at("2026-11-25T05:00:00Z", "2026-11-25");
    await t.cache.ensure("47893", "2026-11-20");
    expect(t.asked).toEqual(["2026-11-20"]);
  });
});

describe("比較の空気：日をまとまりに分ける", () => {
  it("joins dates no more than a week apart, up to 45 days", async () => {
    const { dayRanges } = await import("../../src/data/air");
    expect(dayRanges(["2026-11-25", "2026-11-20", "2026-11-26", "2025-11-25", "2025-11-26"])).toEqual([
      { from: "2025-11-25", to: "2025-11-26" },
      { from: "2026-11-20", to: "2026-11-26" },
    ]);
  });
});
