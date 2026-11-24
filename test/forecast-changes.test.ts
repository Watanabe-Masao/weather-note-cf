// 予報の変化の要約（2026-11-24 渡辺さん）：shared/forecastChanges.ts。
import { describe, expect, it } from "vitest";
import { dayChanges, headlineChange } from "../shared/forecastChanges";
import type { DayValues, Slot, SlotState, V } from "../shared/forecastHistoryModel";

const val = (v: number | string): V => ({ s: "value", v, entry: {} as never });
const wx = (name: string): DayValues["weather"] => ({ ...(val("200") as object), name, sentence: null, partial: null }) as DayValues["weather"];
function slot(kind: "VPFD51" | "VPFW50", at: string, lead: number, o: Partial<DayValues> & { name?: string; pop?: number[] } = {}, state: SlotState = "ok"): Slot {
  const values: DayValues | null =
    state === "ok"
      ? {
          weather: wx(o.name ?? "くもり"),
          popDay: kind === "VPFW50" ? val(o.pop?.[0] ?? 30) : null,
          pop6: kind === "VPFD51" ? (o.pop ?? [10, 20, 20, 10]).map(val) : null,
          max: o.max ?? val(16),
          min: o.min ?? val(10),
          reliability: null,
        }
      : null;
  return { key: `${kind}/${at}`, kind, at, regular: true, lead, state, shown: null, copies: [], values, changed: new Set(), failures: [] };
}

describe("予報の変化の要約", () => {
  it("雨の予報に変わった（同じ種類の前の発表から）、そのときは降水確率は言わない", () => {
    const c = dayChanges([
      slot("VPFD51", "2026-11-23T11:00:00+09:00", 1, { name: "くもり", pop: [10, 20, 20, 10] }),
      slot("VPFD51", "2026-11-23T17:00:00+09:00", 1, { name: "くもり一時雨", pop: [10, 30, 60, 10] }),
    ]);
    expect(c.map((x) => [x.when, x.what, x.detail])).toEqual([["前日17時の発表で", "雨の予報に変わった", "くもり → くもり一時雨"]]);
  });

  it("天気の雨の有無が変わらなければ、降水確率が20ポイント以上動いたら「降水確率が上がった」", () => {
    const c = dayChanges([
      slot("VPFD51", "2026-11-23T11:00:00+09:00", 1, { name: "くもり時々雨", pop: [10, 20, 20, 10] }),
      slot("VPFD51", "2026-11-23T17:00:00+09:00", 1, { name: "くもり時々雨", pop: [10, 30, 60, 10] }),
    ]);
    expect(c.map((x) => [x.what, x.detail])).toEqual([["降水確率が上がった", "12〜18時 20 → 60% ▲40"]]);
  });

  it("10ポイントや1℃は拾わない、2℃は拾う", () => {
    const c = dayChanges([
      slot("VPFW50", "2026-11-21T17:00:00+09:00", 3, { pop: [30], max: val(18) }),
      slot("VPFW50", "2026-11-22T11:00:00+09:00", 2, { pop: [40], max: val(17) }),
      slot("VPFW50", "2026-11-22T17:00:00+09:00", 2, { pop: [40], max: val(15) }),
    ]);
    expect(c.map((x) => [x.when, x.what, x.detail])).toEqual([["2日前17時の発表で", "最高の予報が下がった", "17 → 15℃ ▼2"]]);
  });

  it("間の発表が欠けていたら時刻を断定しない", () => {
    const c = dayChanges([
      slot("VPFD51", "2026-11-23T05:00:00+09:00", 1, { name: "晴れ" }),
      slot("VPFD51", "2026-11-23T11:00:00+09:00", 1, {}, "missing"),
      slot("VPFD51", "2026-11-23T17:00:00+09:00", 1, { name: "雨" }),
    ]);
    expect(c[0]).toMatchObject({ gap: true, when: "前日5時〜前日17時のあいだに", what: "雨の予報に変わった" });
  });

  it("府県と週間は比べない、当日の途中からの発表も比べない", () => {
    const c = dayChanges([
      slot("VPFW50", "2026-11-22T17:00:00+09:00", 2, { name: "晴れ" }),
      slot("VPFD51", "2026-11-23T11:00:00+09:00", 1, { name: "雨" }),
      slot("VPFD51", "2026-11-24T05:00:00+09:00", 0, { name: "晴れ" }),
    ]);
    expect(c).toEqual([]);
  });

  it("いちばん大事な1つは雨の有無、その中の新しいもの。新しい順に並ぶ", () => {
    const c = dayChanges([
      slot("VPFW50", "2026-11-21T17:00:00+09:00", 3, { max: val(18) }),
      slot("VPFW50", "2026-11-22T11:00:00+09:00", 2, { max: val(15), name: "くもり一時雨" }),
      slot("VPFD51", "2026-11-23T11:00:00+09:00", 1, { pop: [10, 20, 20, 10], name: "くもり一時雨" }),
      slot("VPFD51", "2026-11-23T17:00:00+09:00", 1, { pop: [10, 20, 50, 10], name: "くもり一時雨" }),
    ]);
    expect(c.map((x) => x.what)).toEqual(["降水確率が上がった", "雨の予報に変わった", "最高の予報が下がった"]);
    expect(headlineChange(c)?.what).toBe("雨の予報に変わった");
    expect(headlineChange([])).toBeNull();
  });
});

import { shownChanges } from "../shared/forecastChanges";
describe("画面に出す変化", () => {
  it("一覧に出ない発表（同じ時刻に府県がある週間）の変化は出さない：押してもその発表を選べないので", () => {
    const all = [
      slot("VPFW50", "2026-11-22T11:00:00+09:00", 2, { pop: [10] }),
      slot("VPFW50", "2026-11-23T11:00:00+09:00", 1, { pop: [50] }),
      slot("VPFD51", "2026-11-23T11:00:00+09:00", 1, {}),
    ];
    expect(dayChanges(all).map((c) => c.issueKind)).toEqual(["VPFW50"]);
    expect(shownChanges(all)).toEqual([]);
  });
});
