/// <reference lib="dom" />
// tokens.ts also writes the tokens into the page (applyTokens), so it needs the DOM types.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { barLook, LINE, lineLook } from "../../src/design/tokens";

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
