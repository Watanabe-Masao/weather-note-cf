// テーマ (#241): pictures drawn after a change of theme take its colours (read when drawn, not when
// the module is loaded).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { applyTheme, themePalette } from "../../src/design/tokens";
import { WeatherIcon } from "../../src/ui/WeatherIcon";

describe("pictures drawn after a change of theme", () => {
  it("the weather icons take the theme's colours (read when drawn, not when loaded)", () => {
    const root = {
      style: { setProperty() {} },
      dataset: {},
    } as unknown as HTMLElement;
    applyTheme("mist", root);
    expect(
      renderToStaticMarkup(
        createElement(WeatherIcon, { text: "晴", night: true }),
      ),
    ).toContain(`stroke="${themePalette("mist").icon.moon}"`);
    applyTheme("navy", root);
    expect(
      renderToStaticMarkup(
        createElement(WeatherIcon, { text: "晴", night: true }),
      ),
    ).toContain(`stroke="${themePalette("navy").icon.moon}"`);
  });
});
