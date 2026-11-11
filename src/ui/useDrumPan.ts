// Sideways panning for the daily graph: it follows the finger like the table's drum, and on
// release settles on whole days (a flick carries on, up to the drawn buffer), then hands the
// number of days over. The swap to the new centre happens with the offset reset in one render,
// so nothing jumps.

import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";
import { prefersReducedMotion, project, SHEET_EASE, softClamp, VelocityTracker } from "./sheetMotion";

const SLOP = 8;
const MAX_DAYS = 4;

/** `blocked`: while it returns true (the graph is being scrubbed), the finger does not pan. */
export function useDrumPan(ref: RefObject<HTMLElement | null>, step: number, onShift: ((days: number) => void) | undefined, blocked?: () => boolean) {
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState<number | null>(null);
  const dragged = useRef(0);
  const latest = useRef({ step, onShift, blocked });
  latest.current = { step, onShift, blocked };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tracker = new VelocityTracker();
    let start: { x: number; y: number } | null = null;
    let decided = false;
    let taking = false;
    let last = 0;
    let timer = 0;

    const begin = (x: number, y: number) => {
      if (!latest.current.onShift) return;
      start = { x, y };
      decided = false;
      taking = false;
      tracker.reset(0);
    };
    const move = (x: number, y: number, prevent: () => void) => {
      if (!start) return;
      if (latest.current.blocked?.()) {
        start = null;
        return;
      }
      const dx = x - start.x;
      const dy = y - start.y;
      if (!decided) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        decided = true;
        taking = Math.abs(dx) > Math.abs(dy) * 1.2;
      }
      if (!taking) return;
      prevent();
      last = dx;
      tracker.add(dx);
      const limit = latest.current.step * MAX_DAYS;
      setSettling(null);
      setOffset(softClamp(dx, -limit, limit));
    };
    const end = () => {
      if (!start) return;
      start = null;
      if (!taking) return;
      taking = false;
      dragged.current = performance.now();
      const { step: s, onShift: shift } = latest.current;
      // Glide on with the release speed, then settle on whole days.
      const goal = project(last, tracker.velocity(), 0.985);
      const days = Math.max(-MAX_DAYS, Math.min(MAX_DAYS, Math.round(-goal / s)));
      const ms = prefersReducedMotion() ? 0 : Math.round(Math.min(360, 160 + Math.abs(-days * s - last) * 0.8));
      setSettling(ms);
      setOffset(-days * s);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // One render: the new centre and the reset offset together.
        setSettling(0);
        setOffset(0);
        if (days) shift?.(days);
      }, ms);
    };

    const ts = (e: TouchEvent) => e.touches.length === 1 && begin(e.touches[0].clientX, e.touches[0].clientY);
    const tm = (e: TouchEvent) => move(e.touches[0].clientX, e.touches[0].clientY, () => e.preventDefault());
    const pd = (e: PointerEvent) => e.pointerType === "mouse" && begin(e.clientX, e.clientY);
    const pm = (e: PointerEvent) => e.pointerType === "mouse" && move(e.clientX, e.clientY, () => e.preventDefault());
    const pu = (e: PointerEvent) => e.pointerType === "mouse" && end();
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("pointerdown", pd);
    window.addEventListener("pointermove", pm);
    window.addEventListener("pointerup", pu);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("pointerdown", pd);
      window.removeEventListener("pointermove", pm);
      window.removeEventListener("pointerup", pu);
    };
  }, [ref]);

  const style: CSSProperties = {
    transform: `translateX(${offset}px)`,
    transition: settling ? `transform ${settling}ms ${SHEET_EASE}` : "none",
  };
  return { style, justDragged: () => performance.now() - dragged.current < 350 };
}
