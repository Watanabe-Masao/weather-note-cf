// The weather picture chosen from the JMA text (#171: rain with sunny spells gets its own picture).
import { describe, expect, it } from "vitest";
import { skyOf } from "../../src/ui/WeatherIcon";

describe("skyOf", () => {
  it("rain with sunny spells: 晴 first with 雨, or 雨 first with 晴", () => {
    for (const t of ["晴時々雨", "晴一時雨", "晴れ時々雨", "雨時々晴", "雨後晴", "雨のち晴れ"]) expect(skyOf(t), t).toBe("sunRain");
  });
  it("the others stay as they were", () => {
    expect(skyOf("晴")).toBe("sun");
    expect(skyOf("晴後一時曇")).toBe("sunCloud");
    expect(skyOf("曇時々晴")).toBe("sunCloud");
    expect(skyOf("曇一時雨")).toBe("cloud");
    expect(skyOf("雨後曇")).toBe("rain");
    expect(skyOf("雨")).toBe("rain");
    expect(skyOf("晴時々雨、雷を伴う")).toBe("thunder");
    expect(skyOf("雪時々晴")).toBe("snow");
    expect(skyOf(null)).toBe("none");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WeatherIcon } from "../../src/ui/WeatherIcon";
import { ICON } from "../../src/design/tokens";

describe("WeatherIcon for rain with sunny spells", () => {
  it("by day the sun in its colour, the cloud and rain in rain's; by night the moon", () => {
    const day = renderToStaticMarkup(createElement(WeatherIcon, { text: "晴時々雨" }));
    expect(day).toContain('data-sky="sunRain"');
    expect(day).toContain(`stroke="${ICON.sun}"`);
    expect(day).toContain(`stroke="${ICON.rain}"`);
    const night = renderToStaticMarkup(createElement(WeatherIcon, { text: "晴時々雨", night: true }));
    expect(night).toContain('data-sky="sunRain-night"');
    expect(night).toContain(`stroke="${ICON.moon}"`);
    expect(night).not.toContain(`stroke="${ICON.sun}"`);
  });
});
