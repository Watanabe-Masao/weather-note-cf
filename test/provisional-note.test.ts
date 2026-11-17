// 「暫定」の説明 (shared/provisionalNote.ts)：出どころ・待っているもの・確定の見込みが、確定の決まり
// (shared/fixed.ts) と食い違わないこと。
import { describe, expect, it } from "vitest";
import { isFixedDay } from "../shared/fixed";
import { provisionalNote } from "../shared/provisionalNote";
import type { WeatherRow } from "../shared/types";

const row = (o: Partial<WeatherRow>): WeatherRow => ({ date: "2026-11-17", n: 17, type: "actual", provider: "JMA", raw: { max: "18.9" }, quality: {}, max: 18.9, ...o });

describe("provisionalNote", () => {
  it("日の表がまだ無い日（アメダスの速報）：出どころは速報、待つのは日の表と3日、見込みは 11/20 以降", () => {
    const n = provisionalNote(row({ provider: "JMA-recent", provisional: true, dayWeather: null }), "2026-11-17", "2026-11-18", false)!;
    expect(n.source).toContain("アメダスの速報");
    expect(n.waiting).toEqual(["気象庁の日の表（まだ出ていません）", "3日たつこと（アプリは3日たった日だけを確定にします）"]);
    expect(n.when).toMatch(/^11\/20以降/);
  });
  it("日の表はあるが値がそろっていない：まだ出ていない値の名前を出す", () => {
    const n = provisionalNote(row({ unpublished: ["sun"], dayWeather: null }), "2026-11-15", "2026-11-18", false)!;
    expect(n.source).toContain("過去の気象データ");
    expect(n.waiting).toEqual(["日の表のまだ出ていない値：日照時間・天気概況（昼）"]);
    expect(n.when).toContain("気象庁がまだ出していない値が出たら");
    // 確定の決まりでも、この行はまだ確定でない
    expect(isFixedDay(row({ unpublished: ["sun"], dayWeather: null, date: "2026-11-15" }), "2026-11-18")).toBe(false);
  });
  it("今日：観測が終わることを待つ", () => {
    const n = provisionalNote(row({ provider: "JMA-recent", provisional: true, date: "2026-11-18" }), "2026-11-18", "2026-11-18", false)!;
    expect(n.waiting[0]).toBe("今日の観測が終わること");
  });
  it("確定の日・予報の日・行が無い日は出さない", () => {
    expect(provisionalNote(row({}), "2026-11-10", "2026-11-18", true)).toBeNull();
    expect(provisionalNote(row({ type: "forecast" }), "2026-11-19", "2026-11-18", false)).toBeNull();
    expect(provisionalNote(null, "2026-11-17", "2026-11-18", false)).toBeNull();
  });
});
