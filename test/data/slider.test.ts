// kit Slider (#173): where the span and ticks sit (clamped to the range), and what a screen reader hears.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Slider } from "../../src/ui/kit";

const html = (props: Partial<Parameters<typeof Slider>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Slider, { min: 0, max: 1430, step: 10, thumbs: [{ value: 600, label: "時刻（10分ごと）", valueText: "10:00 日の出ている間", onChange: () => {} }], ...props }),
  );

describe("Slider", () => {
  it("each thumb is a range input with its step, label and spoken value", () => {
    const h = html();
    expect(h).toContain('type="range"');
    expect(h).toContain('step="10"');
    expect(h).toContain('aria-label="時刻（10分ごと）"');
    expect(h).toContain('aria-valuetext="10:00 日の出ている間"');
    expect(h).toContain('value="600"');
  });
  it("is kept from dragging its sheet", () => {
    expect(html()).toMatch(/class="slider"[^>]*data-no-sheet-drag/);
    expect(html({ className: "sun-slider" })).toContain('class="slider sun-slider"');
  });
  it("places ticks and the span by value, clamped to the range", () => {
    const h = html({ min: 0, max: 100, ticks: [25, -10, 150], fill: [20, 120] });
    expect(h).toContain('class="tick" style="left:25%"');
    expect(h).toContain('class="tick" style="left:0%"');
    expect(h).toContain('class="tick" style="left:100%"');
    expect(h).toContain('class="fill" style="left:20%;width:80%"');
    expect(html()).not.toContain('class="fill"');
  });
  it("two thumbs (a span) give two inputs", () => {
    const h = html({ thumbs: [
      { value: 10, label: "下限", onChange: () => {} },
      { value: 20, label: "上限", onChange: () => {} },
    ] });
    expect(h.match(/type="range"/g)?.length).toBe(2);
  });
});
