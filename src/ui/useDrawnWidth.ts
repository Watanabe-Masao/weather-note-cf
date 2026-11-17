// The width a drawing is shown at, and sizes on screen inside an SVG (#142, docs/design-system.md 2.1).
// In an SVG a size is in the drawing's own units (its viewBox), so text set to 11 in a drawing shown
// narrower than its viewBox is under 11px on screen. Measure the width it is drawn at, and turn screen
// px into the drawing's units with it.
import { type RefObject, useEffect, useState } from "react";
import { TYPE_SIZE } from "../design/tokens";

/** The element's drawn width in px, kept up to date (0 until it is measured). */
export function useDrawnWidth(ref: RefObject<Element | null>, deps: unknown[] = []): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return w;
}

/**
 * `n` screen px in the units of a drawing `viewWidth` wide shown at `drawnPx` (until it is measured,
 * as if shown at `assumedPx`).
 */
export const svgUnits = (n: number, viewWidth: number, drawnPx: number, assumedPx = viewWidth) => (n * viewWidth) / (drawnPx || assumedPx);

/** A step of the type scale on screen, in the drawing's units. */
export const svgTextSize = (step: keyof typeof TYPE_SIZE, viewWidth: number, drawnPx: number, assumedPx = viewWidth) =>
  svgUnits(TYPE_SIZE[step], viewWidth, drawnPx, assumedPx);
