// Swipe a panel sideways to move one day: left = the next day, right = the day before
// (like turning a page). The panel follows the finger a little; past the threshold, or on a
// flick, the day changes and the new one slides in from the side it came from.
// Vertical moves are left alone (the sheet scrolls and drags as usual).

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { prefersReducedMotion, VelocityTracker } from "./sheetMotion";

const SLOP = 8;
const DISTANCE = 56;
const FLICK = 0.45;

export function useSwipeDays(onStep: ((days: number) => void) | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  /** How far the pull has gone toward a day change: −1 … 1 is "release to move" at ±1 (sign = direction). */
  const [pull, setPull] = useState(0);
  const [entering, setEntering] = useState<0 | -1 | 1>(0);
  const step = useRef(onStep);
  step.current = onStep;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tracker = new VelocityTracker();
    let start: { x: number; y: number } | null = null;
    let decided = false;
    let taking = false;
    let last = 0;
    const begin = (x: number, y: number) => {
      start = { x, y };
      decided = false;
      taking = false;
      tracker.reset(0);
    };
    const move = (x: number, y: number, prevent: () => void) => {
      if (!start || !step.current) return;
      const mx = x - start.x;
      const my = y - start.y;
      if (!decided) {
        if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return;
        decided = true;
        taking = Math.abs(mx) > Math.abs(my) * 1.3;
      }
      if (!taking) return;
      prevent();
      last = mx;
      tracker.add(mx);
      setDx(mx * 0.55);
      setPull(-mx / DISTANCE);
    };
    const end = () => {
      if (taking && step.current) {
        const v = tracker.velocity();
        const dir = last < -DISTANCE || v < -FLICK ? 1 : last > DISTANCE || v > FLICK ? -1 : 0;
        if (dir) {
          step.current(dir);
          setEntering(dir as 1 | -1);
          window.setTimeout(() => setEntering(0), prefersReducedMotion() ? 0 : 20);
        }
      }
      start = null;
      taking = false;
      setDx(0);
      setPull(0);
    };
    const ts = (e: TouchEvent) => e.touches.length === 1 && begin(e.touches[0].clientX, e.touches[0].clientY);
    const tm = (e: TouchEvent) => move(e.touches[0].clientX, e.touches[0].clientY, () => e.preventDefault());
    const pd = (e: PointerEvent) => e.pointerType === "mouse" && begin(e.clientX, e.clientY);
    const pm = (e: PointerEvent) => e.pointerType === "mouse" && start && move(e.clientX, e.clientY, () => e.preventDefault());
    const pu = (e: PointerEvent) => e.pointerType === "mouse" && end();
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("pointerdown", pd);
    window.addEventListener("pointermove", pm);
    window.addEventListener("pointerup", pu);
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("pointerdown", pd);
      window.removeEventListener("pointermove", pm);
      window.removeEventListener("pointerup", pu);
    };
  }, []);

  // Following: no transition. Released: spring back. A new day: starts offset on the side it came from, then glides in.
  const style: CSSProperties = entering
    ? { transform: `translateX(${entering * 36}px)`, opacity: 0.4, transition: "none" }
    : dx
      ? { transform: `translateX(${dx}px)`, opacity: 1 - Math.min(0.5, Math.abs(dx) / 400), transition: "none" }
      : { transform: "translateX(0)", opacity: 1, transition: "transform 260ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease-out" };
  return { ref, style, pull };
}
