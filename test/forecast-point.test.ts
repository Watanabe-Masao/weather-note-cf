// 時点に印を付ける（2026-11-24 渡辺さん）：shared/forecastPoint.ts。
import { describe, expect, it } from "vitest";
import { corrected, latestAt, pointIso, pointLabel, pointOptions, POINT_PRESETS } from "../shared/forecastPoint";
import type { Slot, SlotState } from "../shared/forecastHistoryModel";

const slot = (at: string, state: SlotState = "ok", info: string[] = ["発表"]): Slot =>
  ({ key: at, kind: "VPFD51", at, regular: true, lead: 1, state, shown: null, copies: info.map((i) => ({ info_type: i })), values: state === "ok" ? {} : null, changed: new Set(), failures: [] }) as unknown as Slot;

describe("時点に印", () => {
  const day = "2026-11-25";
  const slots = [slot("2026-11-24T05:00:00+09:00"), slot("2026-11-24T11:00:00+09:00", "ok", ["発表", "訂正"]), slot("2026-11-24T17:00:00+09:00"), slot("2026-11-25T05:00:00+09:00", "missing")];
  it("前日14時の時点の最新は前日11時、18時なら17時、ちょうどの時刻は含む、記録なしの回は選ばない", () => {
    expect(latestAt(slots, pointIso(day, 1, 14))?.at).toBe("2026-11-24T11:00:00+09:00");
    expect(latestAt(slots, pointIso(day, 1, 18))?.at).toBe("2026-11-24T17:00:00+09:00");
    expect(latestAt(slots, pointIso(day, 1, 11))?.at).toBe("2026-11-24T11:00:00+09:00");
    expect(latestAt(slots, pointIso(day, 0, 7))?.at).toBe("2026-11-24T17:00:00+09:00");
    expect(latestAt(slots, pointIso(day, 1, 4))).toBeNull();
  });
  it("訂正のある発表が分かる（いつ出たかは言わない）", () => {
    expect(corrected(slots[1])).toBe(true);
    expect(corrected(slots[0])).toBe(false);
  });
  it("言葉と選べる時刻", () => {
    expect(POINT_PRESETS.map((p) => pointLabel(day, pointIso(day, p.lead, p.h)))).toEqual(["前日 9時", "前日 14時", "前日 18時", "当日 7時"]);
    expect(pointLabel(day, pointIso(day, 2, 9, 30))).toBe("2日前 9:30");
    const o = pointOptions(day);
    expect(o).toHaveLength(8 * 48);
    expect(o[0]).toBe("2026-11-25T23:30:00+09:00");
    expect(o.at(-1)).toBe("2026-11-18T00:00:00+09:00");
  });
});
