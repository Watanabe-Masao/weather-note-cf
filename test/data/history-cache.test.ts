// 予報の移り変わりの取り置き（2026-11-24 渡辺さん「予報履歴が古いまま残る」）：src/data/historyCache.ts。
// 2026-11-25 の見本：TanStack Query に置き換えたので、決まりは「いつ古くなるか」（historyStaleTime）で確かめる。
import { describe, expect, it } from "vitest";
import { historyStaleTime } from "../../src/data/historyCache";
import { LIVE_EVERY } from "../../src/data/store";

const TODAY = "2026-11-24";

describe("予報の移り変わりの取り直し", () => {
  it("今日と先の日は、10分で古くなる", () => {
    expect(historyStaleTime(TODAY, Date.parse("2026-11-24T00:00:00Z"), TODAY)).toBe(LIVE_EVERY);
    expect(historyStaleTime("2026-11-26", 0, TODAY)).toBe(LIVE_EVERY);
  });
  it("過ぎた日は、その日が終わったあとに取れた分なら古くならない", () => {
    expect(historyStaleTime("2026-11-20", Date.parse("2026-11-21T00:00:00+09:00"), TODAY)).toBe(Infinity);
  });
  it("その日が終わる前に取れた分は、日付が変わったら古い（夕方の発表が抜けたまま残らない）", () => {
    expect(historyStaleTime("2026-11-23", Date.parse("2026-11-23T17:00:00+09:00"), TODAY)).toBe(0);
    expect(historyStaleTime("2026-11-23", 0, TODAY)).toBe(0);
  });
});
