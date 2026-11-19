// テーマ (#241): the three themes on one structure, each checked where it is read — text 4.5:1 on the
// faces it sits on, data colours 4.5:1 (they are read as numbers), state marks 3:1, each graph role
// as far from the face in every theme, the 肌感 steps one diverging scale, the faces one distance apart,
// and the accent kept apart from every data colour.

import { describe, expect, it } from "vitest";
import { contrast, deltaE, oklab } from "../../src/design/contrast";
import {
  applyTheme,
  BAND_LINES,
  cssVariables,
  DATA,
  FEEL_LEVELS,
  FEEL_SCALE_COLORS,
  ICON,
  LINE,
  THEME_NAMES,
  themePalette,
} from "../../src/design/tokens";

const ok = (pairs: [string, string, string][], need: number) =>
  pairs
    .filter(([, a, b]) => contrast(a, b) < need)
    .map(([n, a, b]) => `${n} ${contrast(a, b).toFixed(2)}`);

describe.each(THEME_NAMES)("%s", (name) => {
  const t = themePalette(name);
  const faces = {
    page: t.surface.page,
    base: t.surface.base,
    raised: t.surface.raised,
    overlay: t.surface.overlay,
  };
  it("has every token as a colour", () => {
    const all = [
      t.surface,
      t.ink,
      t.accent,
      t.data,
      t.day,
      t.status,
      t.icon,
    ].flatMap((o) => Object.values(o));
    expect(
      all.filter((c) => !/^#[0-9a-f]{6}$/i.test(c) && !/^rgba\(/.test(c)),
    ).toEqual([]);
    expect([
      t.feel.length,
      t.feel5.length,
      t.feel3.length,
      t.bands.length,
    ]).toEqual([7, 5, 3, 5]);
  });
  it("text reads (4.5:1) on every face", () => {
    const pairs: [string, string, string][] = [];
    for (const [f, bg] of Object.entries(faces))
      for (const k of ["primary", "secondary", "tertiary"] as const)
        pairs.push([`${k}/${f}`, t.ink[k], bg]);
    pairs.push(
      ["secondary/inset", t.ink.secondary, t.surface.inset],
      ["onAccent/accent", t.ink.onAccent, t.accent.base],
    );
    expect(ok(pairs, 4.5)).toEqual([]);
  });
  it("data colours read as numbers (4.5:1) on the base and raised faces", () => {
    const keys = [
      "hot",
      "cold",
      "mean",
      "rain",
      "sun",
      "radiation",
      "humidity",
      "wind",
      "pressure",
      "feel",
    ] as const;
    expect(
      ok(
        keys.flatMap(
          (k) =>
            [
              [`${k}/base`, t.data[k], t.surface.base],
              [`${k}/raised`, t.data[k], t.surface.raised],
            ] as [string, string, string][],
        ),
        4.5,
      ),
    ).toEqual([]);
  });
  it("marks of state and choice are seen (3:1): the accent, warning, error, 予報, the 時間区分 lines", () => {
    const marks: [string, string][] = [
      ["accent", t.accent.base],
      ["warning", t.status.warning],
      ["error", t.status.error],
      ["forecast", t.status.forecast],
      ...t.bands.map((b, i) => [`band${i}`, b] as [string, string]),
    ];
    expect(
      ok(
        marks.flatMap(
          ([n, c]) =>
            [
              [`${n}/base`, c, t.surface.base],
              [`${n}/raised`, c, t.surface.raised],
            ] as [string, string, string][],
        ),
        3,
      ),
    ).toEqual([]);
  });
  it("keeps the green accent apart from the data: 湿度 (the green-teal item) by ΔE ≥ 10, every other item ≥ 7", () => {
    expect(
      Object.entries(t.data)
        .filter(
          ([k, c]) =>
            deltaE(c, t.accent.base) < (k.startsWith("humidity") ? 10 : 7),
        )
        .map(([k]) => k),
    ).toEqual([]);
  });
  // A colour drawn at an opacity is read as what it becomes on the face (再設計書 7.3).
  const over = (c: string, a: number, bg: string) =>
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(c.slice(i, i + 2), 16) * a +
            parseInt(bg.slice(i, i + 2), 16) * (1 - a),
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  it("never fades a weather picture: the partner day's and an estimate keep the full line (thinner, dotted instead)", () => {
    expect([t.effect.quiet, t.effect.estimated, t.effect.estimatedQuiet]).toEqual(["1", "1", "1"]);
    const want = t.dark ? 6.0 : 4.6;
    const pics = Object.entries(t.icon).filter(([k]) => k !== "glint");
    expect(
      pics.flatMap(([k, c]) => {
        const v = contrast(c, t.surface.base);
        return Math.abs(v - want) > 0.15 ? [`${k} ${v.toFixed(2)}`] : [];
      }),
    ).toEqual([]);
  });
  it("puts each graph role as far from the face in every theme (役割ごとの距離, #243): main > comparison > reference > hatch > grid", () => {
    const at = (c: string) => contrast(c, t.surface.base);
    const range = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
    // Deep Navy's temperatures sit further (6.2–6.8): light coloured figures on a dark face read weaker
    // than their ratio says (measured with APCA, 2026-11-18: Lc 35 at 4.5), so they were lifted to Lc 45.
    const [lo, hi] = t.dark ? [6.2, 6.8] : [4.6, 5.45];
    expect(
      [at(t.data.hot), at(t.data.cold)].every((v) => range(v, lo, hi)),
    ).toBe(true);
    expect(range(at(t.reference.color), 2.2, 2.6)).toBe(true);
    expect(range(at(t.chart.hatch), 1.5, 1.7)).toBe(true);
    expect(range(at(t.chart.grid), 1.2, 1.4)).toBe(true);
    const compare = contrast(
      over(t.data.hot, t.compareOpacity, t.surface.base),
      t.surface.base,
    );
    expect(
      at(t.data.hot) > compare &&
        compare > at(t.reference.color) &&
        at(t.reference.color) > at(t.chart.hatch) &&
        at(t.chart.hatch) > at(t.chart.grid),
    ).toBe(true);
  });
  // Deep Navy (#244): a red light enough to read on a dark face turns salmon at the light themes'
  // hue, so its red leans 10° toward brown (terracotta, Warm White's brick red in the dark), and both
  // temperatures carry 85% of the light themes' saturation (chroma ÷ lightness) so they do not glare
  // (68% until 2026-11-18: on the deeper face they read dull at night).
  it("keeps the temperatures one colour across themes: the light themes alike, Deep Navy a terracotta red and a calmer blue", () => {
    const warm = themePalette("warm");
    const lch = (c: string) => {
      const [L, a, b] = oklab(c);
      return { L, C: Math.hypot(a, b), H: (Math.atan2(b, a) * 180) / Math.PI };
    };
    for (const k of ["hot", "cold"] as const) {
      const w = lch(warm.data[k]);
      const x = lch(t.data[k]);
      const lean = t.dark && k === "hot" ? NAVY_RED_LEAN : 0;
      expect(Math.abs(x.H - w.H - lean)).toBeLessThan(3);
      const share = (x.C / x.L) / (w.C / w.L);
      if (t.dark) expect(share).toBeCloseTo(NAVY_SATURATION, 1);
      else expect(Math.abs(x.C - w.C)).toBeLessThan(0.02);
    }
  });
  // 肌感の7段 (2026-11-18 渡辺さん、寒い＝#3232FF の色の表 A＋縁): one scale in all three themes, filled
  // vivid with white numbers on it. The steps part by vividness, not by distance from the face: 寒い and
  // 暑い the most vivid, ふつう the calmest, each pair alike. Until 2026-11-18 the steps parted by
  // distance from the face (4.4 … 2.4 … 4.4), which on Deep Navy made the warm steps brown.
  it("draws the 肌感 steps as one scale in every theme: white numbers read on each, 寒い and 暑い the most vivid, ふつう the calmest", () => {
    const navy = themePalette("navy");
    expect(t.feel).toEqual(navy.feel);
    expect(t.feelEdge).toEqual(navy.feelEdge);
    expect(t.feel[0]).toBe("#3232ff");
    expect(t.feelEdge[0]).toBe("#3265ff");
    expect(t.ink.onFeel).toBe("#ffffff");
    expect(ok(t.feel.map((c, i) => [`feel${i + 1}`, c, t.ink.onFeel]), 4.5)).toEqual([]);
    const chroma = t.feel.map((c) => {
      const [, a, b] = oklab(c);
      return Math.hypot(a, b);
    });
    // Vivid toward both ends: each step calmer than the one outside it, ふつう the calmest.
    expect(chroma[0] > chroma[1] && chroma[1] > chroma[2] && chroma[2] > chroma[3]).toBe(true);
    expect(chroma[6] > chroma[5] && chroma[5] > chroma[4] && chroma[4] > chroma[3]).toBe(true);
    for (const [a, b] of [[0, 6], [1, 5], [2, 4]]) expect(Math.abs(chroma[a] - chroma[b])).toBeLessThan(0.07);
    // Still a mark on the card, and the edge a lighter tone of its own step.
    expect(ok(t.feel.map((c, i) => [`feel${i + 1}/raised`, c, t.surface.raised]), 2)).toEqual([]);
    for (const [i, c] of t.feel.entries()) expect(oklab(t.feelEdge[i])[0]).toBeGreaterThan(oklab(c)[0]);
    expect(t.feel5).toEqual([0, 2, 3, 4, 6].map((i) => t.feel[i]));
    expect(t.feel3).toEqual([1, 3, 5].map((i) => t.feel[i]));
  });
  it("sets the faces one distance from the base in every theme (Warm White's: card ΔL 5.0)", () => {
    const L = (c: string) => oklab(c)[0] * 100;
    const b = L(t.surface.base);
    expect(L(t.surface.raised) - b).toBeGreaterThan(4.7);
    expect(L(t.surface.raised) - b).toBeLessThan(5.3);
    expect(L(t.surface.overlay)).toBeGreaterThanOrEqual(L(t.surface.raised));
    expect(b - L(t.surface.inset)).toBeGreaterThan(2.1);
    expect(b - L(t.surface.inset)).toBeLessThan(2.9);
  });
  it("draws the comparison day at 80% of the main line's distance", () => {
    const main = contrast(t.data.hot, t.surface.base) - 1;
    const cmp =
      contrast(
        over(t.data.hot, t.compareOpacity, t.surface.base),
        t.surface.base,
      ) - 1;
    expect(cmp / main).toBeGreaterThan(0.76);
    expect(cmp / main).toBeLessThan(0.84);
  });
});

/** Deep Navy's temperatures (#244): their share of Warm White's saturation, and the red's lean toward brown (degrees). */
const NAVY_SATURATION = 0.85;
const NAVY_RED_LEAN = 10;

describe("putting a theme in use", () => {
  const el = () =>
    ({ style: { setProperty() {} }, dataset: {} }) as unknown as HTMLElement;
  it("fills every colour SVG reads and the CSS properties, with nothing left from the theme before", () => {
    for (const name of ["navy", "mist", "warm", "navy"] as const) {
      applyTheme(name, el());
      const t = themePalette(name);
      expect(DATA).toEqual(t.data);
      expect(ICON).toEqual(t.icon);
      expect(FEEL_LEVELS).toEqual(t.feel);
      expect(FEEL_SCALE_COLORS[5]).toEqual(t.feel5);
      expect(FEEL_SCALE_COLORS[3]).toEqual(t.feel3);
      expect(BAND_LINES).toEqual(t.bands);
      expect(LINE.reference).toBe(t.reference.color);
      expect(LINE.referenceOpacity).toBe(t.reference.opacity);
      expect(LINE.opacity.compare).toBe(t.compareOpacity);
      expect(LINE.dimmed).toBe(t.ink.disabled);
      expect(cssVariables()["--surface-page"]).toBe(t.surface.page);
      expect(cssVariables()["--effect-veil"]).toBe(t.effect.veil);
    }
  });
});

// 空の色の上（太陽と月のグラフ・空を見上げる・時間帯の太陽の帯、11/20）：地は空の色でどのテーマでも同じなので、
// 線と文字はテーマによらず暗い地に合わせた色。夜の空（紺）に対して線が 3:1 以上。
import { onSkyVars, SKY_ICON } from "../../src/design/tokens";
import { skyAt } from "../../shared/sky";
describe("on the sky (#241, 11/20)", () => {
  it("the lines over the sky are the same in every theme and stand out from the night sky", () => {
    const before = JSON.stringify(onSkyVars());
    for (const name of ["mist", "warm", "navy"] as const) {
      applyTheme(name, { style: { setProperty() {} }, dataset: {} } as unknown as HTMLElement);
      expect(JSON.stringify(onSkyVars())).toBe(before);
    }
    const night = skyAt(-30, 1, 0, false).zenith;
    expect(contrast(onSkyVars()["--ink-tertiary"], night)).toBeGreaterThanOrEqual(3);
    expect(contrast(SKY_ICON.moon, night)).toBeGreaterThanOrEqual(3);
  });
});
