// 予報の移り変わりの取り置き（2026-11-24 渡辺さん「予報履歴が古いまま残る」）：src/data/historyCache.ts。
import { describe, expect, it } from "vitest";
import { HistoryCache } from "../../src/data/historyCache";
import { LIVE_EVERY } from "../../src/data/store";
import type { ForecastHistoryResponse } from "../../shared/forecastHistory";

const TODAY = "2026-11-24";
function setup(fail = () => false) {
  let now = Date.parse("2026-11-24T00:00:00Z"); // 9時
  let n = 0;
  const calls: string[] = [];
  const cache = new HistoryCache(
    async (station, date) => {
      calls.push(`${station}/${date}`);
      if (fail()) throw new Error("503");
      return { v: ++n } as unknown as ForecastHistoryResponse;
    },
    () => now,
    () => TODAY,
  );
  return { cache, calls, later: (ms: number) => (now += ms), version: () => (cache.get("47893", TODAY).r as unknown as { v: number } | null)?.v };
}

describe("予報の移り変わりの取り直し", () => {
  it("今日の分は、10分たってから開き直すと取り直す（朝に開いて夕方に戻ると夕方の発表）", async () => {
    const { cache, calls, later, version } = setup();
    await cache.ensure("47893", TODAY);
    expect(version()).toBe(1);
    later(LIVE_EVERY - 1);
    await cache.ensure("47893", TODAY);
    expect(calls.length).toBe(1);
    later(8 * 3_600_000);
    await cache.ensure("47893", TODAY);
    expect(calls.length).toBe(2);
    expect(version()).toBe(2);
  });

  it("過ぎた日は取り直さない（発表はもう増えない）", async () => {
    const { cache, calls, later } = setup();
    await cache.ensure("47893", "2026-11-20");
    later(24 * 3_600_000);
    await cache.ensure("47893", "2026-11-20");
    expect(calls.length).toBe(1);
  });

  it("予報の移り変わりと時間帯のグラフが同時に頼んでも、取得は1回", async () => {
    const { cache, calls } = setup();
    await Promise.all([cache.ensure("47893", TODAY), cache.load("47893", TODAY)]);
    expect(calls.length).toBe(1);
  });

  it("取り直しに失敗しても、前に取れた分とその時刻を出したまま", async () => {
    let bad = false;
    const { cache, later, version } = setup(() => bad);
    await cache.ensure("47893", TODAY);
    const at = cache.get("47893", TODAY).at;
    bad = true;
    later(LIVE_EVERY);
    await cache.ensure("47893", TODAY);
    expect(version()).toBe(1);
    expect(cache.get("47893", TODAY)).toMatchObject({ at, failed: true, loading: false });
  });

  it("初めの取得が失敗したら、次に開いたときにもう一度", async () => {
    let bad = true;
    const { cache, calls } = setup(() => bad);
    await cache.ensure("47893", "2026-11-20");
    expect(cache.get("47893", "2026-11-20")).toMatchObject({ r: null, failed: true });
    bad = false;
    await cache.ensure("47893", "2026-11-20");
    expect(calls.length).toBe(2);
    expect(cache.get("47893", "2026-11-20").failed).toBe(false);
  });
});
