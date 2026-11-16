// Our own colour maths (src/design/contrast.ts, used by the theme tests) checked against Color.js
// (devDependency only), so the yardstick the themes are tuned by is the textbook one (#244).
import Color from "colorjs.io";
import { describe, expect, it } from "vitest";
import { contrast, oklab } from "../../src/design/contrast";
import { themePalette } from "../../src/design/tokens";

const pairs = (["navy", "mist", "warm"] as const).flatMap((n) => {
  const t = themePalette(n);
  return [t.data.hot, t.data.cold, t.ink.primary, t.icon.sun, t.surface.raised, ...t.feel].map(
    (c) => [c, t.surface.base] as const,
  );
});

describe("contrast.ts agrees with Color.js", () => {
  it("WCAG 2 contrast", () => {
    for (const [a, b] of pairs)
      expect(contrast(a, b)).toBeCloseTo(new Color(a).contrast(new Color(b), "WCAG21"), 2);
  });
  it("OKLab lightness", () => {
    for (const [a] of pairs)
      expect(oklab(a)[0]).toBeCloseTo(new Color(a).to("oklab").coords[0] ?? 0, 3);
  });
});
