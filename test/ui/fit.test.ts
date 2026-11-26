import { describe, expect, it } from "vitest";
import { axisWidth, lineLabel, lineValues, niceTicks, tickLabel } from "../../src/design/format";

describe("things that must fit", () => {
  it("never gives a 1022.5-style tick at units, but keeps 0.25 and 25", () => {
    const p = niceTicks(1012.6, 1024.4, 5);
    expect(p.ticks.every((t) => Number.isInteger(t))).toBe(true);
    expect(niceTicks(0, 1, 5).ticks).toContain(0.25);
    expect(niceTicks(0, 100, 5).ticks).toContain(25);
  });

  it("makes the axis column as wide as its longest label", () => {
    expect(axisWidth(["5", "10"])).toBe(28);
    expect(axisWidth(["1010", "1020"])).toBeGreaterThan(axisWidth(["10", "20"]));
    expect(axisWidth(["1010", "1020"])).toBeGreaterThanOrEqual(10 + 4 * 6);
    expect(tickLabel(1020)).toBe("1020");
  });

  it("says a shared start of the line's names once, keeping whole words", () => {
    expect(lineLabel(["気圧最高", "気圧最低"])).toBe("気圧 最高/最低");
    expect(lineLabel(["最高", "最低"])).toBe("最高/最低");
    expect(lineLabel(["風速"])).toBe("風速");
  });

  it("puts on the one-line summary only values in one unit, two at most (11/26: 視程 km was shown in µg/m³)", () => {
    const air = [
      { key: "pmMean", unit: "µg/m³" },
      { key: "dustMax", unit: "µg/m³" },
      { key: "measuredPm", unit: "µg/m³" },
      { key: "visibilityMin", unit: "km" },
    ];
    expect(lineValues(air).map((r) => r.key)).toEqual(["pmMean", "dustMax"]);
    expect(lineValues([{ key: "vis", unit: "km" }, { key: "pm", unit: "µg/m³" }]).map((r) => r.key)).toEqual(["vis"]);
    expect(lineValues([{ key: "max", unit: "℃" }, { key: "min", unit: "℃" }]).map((r) => r.key)).toEqual(["max", "min"]);
    expect(lineValues([])).toEqual([]);
  });
});
