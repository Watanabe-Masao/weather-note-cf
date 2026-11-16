// テーマ (#241): the three themes on one structure, each checked where it is read — text 4.5:1 on the
// faces it sits on, data colours 4.5:1 (they are read as numbers), state marks 3:1, the 肌感 steps
// 3:1 with their order in lightness too, and the accent kept apart from every data colour.

import { describe, expect, it } from "vitest";
import { contrast, deltaE, oklab } from "../../src/design/contrast";
import {
  applyTheme,
  cssVariables,
  DATA,
  FEEL_LEVELS,
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
  it("keeps a reference line under the comparison day, yet seen (P4 under P2)", () => {
    const ref = contrast(
      over(t.reference.color, t.reference.opacity, t.surface.base),
      t.surface.base,
    );
    const weakestCompare = Math.min(
      ...(
        ["hot", "cold", "rain", "sun", "wind", "pressure", "humidity"] as const
      ).map((k) =>
        contrast(
          over(t.data[k], t.compareOpacity, t.surface.base),
          t.surface.base,
        ),
      ),
    );
    expect(ref).toBeGreaterThanOrEqual(1.8);
    expect(ref).toBeLessThan(weakestCompare + 0.5);
  });
  it("keeps the partner day's and an estimated weather picture seen (2:1 even both at once)", () => {
    const a = Number(t.effect.estimatedQuiet);
    const pics = Object.entries(t.icon).filter(([k]) => k !== "glint");
    expect(
      pics
        .filter(
          ([, c]) => contrast(over(c, a, t.surface.base), t.surface.base) < 2,
        )
        .map(
          ([k, c]) =>
            `${k} ${contrast(over(c, a, t.surface.base), t.surface.base).toFixed(2)}`,
        ),
    ).toEqual([]);
  });
  it("puts each graph role as far from the face in every theme (役割ごとの距離, #243): main > comparison > reference > hatch > grid", () => {
    const at = (c: string) => contrast(c, t.surface.base);
    const range = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
    expect(
      [at(t.data.hot), at(t.data.cold)].every((v) => range(v, 4.6, 5.4)),
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
  it("keeps the temperatures one colour across themes: the same hue and chroma (only the lightness differs)", () => {
    const navy = themePalette("navy");
    for (const k of ["hot", "cold"] as const) {
      const [, a1, b1] = oklab(navy.data[k]);
      const [, a2, b2] = oklab(t.data[k]);
      expect(Math.abs(Math.atan2(b1, a1) - Math.atan2(b2, a2))).toBeLessThan(
        0.06,
      );
      expect(Math.abs(Math.hypot(a1, b1) - Math.hypot(a2, b2))).toBeLessThan(
        0.02,
      );
    }
  });
  it("draws the 肌感 steps as one diverging scale in every theme: 寒い and 暑い farthest, ふつう nearest, each pair alike", () => {
    // The distances from the base face, cold to hot (#242): the same in each theme, so a step reads
    // as strongly on Deep Navy as on the light faces. Each still reads as a mark on the card.
    const want = [4.4, 3.6, 2.9, 2.4, 2.9, 3.6, 4.4];
    const at = t.feel.map((c) => contrast(c, t.surface.base));
    expect(
      at.flatMap((v, i) =>
        Math.abs(v - want[i]) > 0.15 ? [`feel${i + 1} ${v.toFixed(2)}`] : [],
      ),
    ).toEqual([]);
    expect(
      t.feel.flatMap((c, i) =>
        contrast(c, t.surface.raised) < 2
          ? [`feel${i + 1}/raised ${contrast(c, t.surface.raised).toFixed(2)}`]
          : [],
      ),
    ).toEqual([]);
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

describe("putting a theme in use", () => {
  it("fills the colours SVG reads and the CSS properties alike", () => {
    applyTheme("warm", {
      style: { setProperty() {} },
      dataset: {},
    } as unknown as HTMLElement);
    expect(DATA.hot).toBe(themePalette("warm").data.hot);
    expect(FEEL_LEVELS[0]).toBe(themePalette("warm").feel[0]);
    expect(cssVariables()["--surface-page"]).toBe(
      themePalette("warm").surface.page,
    );
    applyTheme("navy", {
      style: { setProperty() {} },
      dataset: {},
    } as unknown as HTMLElement);
    expect(DATA.hot).toBe(themePalette("navy").data.hot);
  });
});
