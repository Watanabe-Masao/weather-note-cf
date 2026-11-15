/// <reference lib="dom" />
// tokens.ts also writes the tokens into the page (applyTokens), so it needs the DOM types.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { barLook, barPath, LINE, lineLook, SHAPE } from "../../src/design/tokens";

describe("graph lines: one rule (design engine)", () => {
  it("tells the day by form and the kind by colour", () => {
    const t = lineLook("target", "#f39a86");
    const c = lineLook("compare", "#f39a86");
    expect(t.strokeDasharray).toBeUndefined();
    expect(c.strokeDasharray).toBe(LINE.dash.compare);
    expect(t.stroke).toBe(c.stroke); // never told apart by colour
    expect(c.strokeWidth).toBeLessThan(t.strokeWidth);
    // A reference keeps its day's form, takes the reference colour and is thinner than the value.
    const rt = lineLook("target", "#f39a86", { kind: "reference" });
    const rc = lineLook("compare", "#f39a86", { kind: "reference" });
    expect(rt.strokeDasharray).toBe(t.strokeDasharray);
    expect(rc.strokeDasharray).toBe(c.strokeDasharray);
    expect(rt.stroke).toBe(LINE.reference);
    expect(rt.strokeWidth).toBeLessThan(t.strokeWidth);
  });

  it("dims to grey and keeps the form", () => {
    const d = lineLook("compare", "#f39a86", { dimmed: true });
    expect(d.stroke).toBe(LINE.dimmed);
    expect(d.strokeDasharray).toBe(LINE.dash.compare);
    expect(barLook("target", "#f5c865").fill).toBe("#f5c865");
    expect(barLook("compare", "#f5c865").fill).toBe("none");
  });

  it("is the only place graphs get the days' dashes from", () => {
    const dir = join(__dirname, "../../src/ui");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") && f !== "SunTestBoard.tsx")
      .filter((f) => /strokeDasharray=\{(compare|dashed|other)\b|strokeDasharray="[56] 4"/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("graph shapes: 少しだけ角を取る (design-system.md 4.1)", () => {
  it("rounds only the top of an amount bar: its tip is the value, its foot stays square on 0", () => {
    const d = barPath(10, 20, 12, 40);
    expect(d.startsWith("M10,60V")).toBe(true); // from the foot (y + h), straight up
    expect(d).toContain(`A${SHAPE.bar.radius},${SHAPE.bar.radius}`);
    expect(d.endsWith("V60Z")).toBe(true); // back down to the same foot
    expect(d).toContain(",20H"); // the flat top at the value
  });

  it("never rounds past a short bar's height or a quarter of a narrow bar's width (never a pill)", () => {
    expect(barPath(0, 0, 12, 1)).toContain("A1,1");
    expect(barPath(0, 0, 6, 40)).toContain("A1.5,1.5");
    expect(barPath(0, 0, 12, 0)).toBe("M0,0h12v0h-12Z"); // nothing to round: a flat mark
  });

  it("is the only way the graphs draw an amount bar", () => {
    const dir = join(__dirname, "../../src/ui");
    const offenders = ["Chart.tsx", "HourCompare.tsx"].filter((f) => /<rect(?:(?!\/>)[\s\S])*\{\.\.\.barLook\(/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
