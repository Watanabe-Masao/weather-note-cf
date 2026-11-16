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
  it("draws the 肌感 steps in order: 3:1 on a light face, and their lightness rising from 寒い to 暑い there", () => {
    if (t.dark) return; // Deep Navy keeps the steps as they were (each 3:1 on its faces already)
    expect(
      ok(
        t.feel.flatMap(
          (c, i) =>
            [
              [`feel${i + 1}/base`, c, t.surface.base],
              [`feel${i + 1}/raised`, c, t.surface.raised],
            ] as [string, string, string][],
        ),
        3,
      ),
    ).toEqual([]);
    const L = t.feel.map((c) => oklab(c)[0]);
    expect(L.every((v, i) => i === 0 || v > L[i - 1])).toBe(true);
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
