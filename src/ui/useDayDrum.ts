// The seven-day drum for a graph (#151: 日を横に並べるものはドラム), as the daily graph has it:
// a sideways drag pans the days and settles on whole days (useDrumPan), and a long press (or a mouse
// hover) reads a day, with the guide following the finger. Used by 肌感の推移 and 明るさの移り変わり.
//
// The graph draws 7 + 2 × DRUM_BUFFER days; index DRUM_BUFFER is the first one in view.

import { type RefObject, useEffect, useRef, useState } from "react";
import { useDrumPan } from "./useDrumPan";

export const DRUM_BUFFER = 4;
const LONG_PRESS = 280;

/** The days the drum draws around `target` (offsets from it), the visible seven in the middle. */
export const drumOffsets = Array.from({ length: 7 + 2 * DRUM_BUFFER }, (_, i) => i - 3 - DRUM_BUFFER);

/**
 * `left`: where the plot starts inside the element; `step`: one day's width. `scrub` is the read day
 * as an index into the drawn days (null when not reading).
 */
export function useDayDrum(ref: RefObject<HTMLElement | null>, step: number, left: number, onShift?: (days: number) => void) {
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubbing = useRef(false);
  const scrubbedAt = useRef(0);
  const pan = useDrumPan(ref, step, onShift, () => scrubbing.current);
  const geo = useRef({ step, left });
  geo.current = { step, left };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dayAt = (clientX: number) => {
      const r = el.getBoundingClientRect();
      const i = Math.floor((clientX - r.left - geo.current.left) / geo.current.step) + DRUM_BUFFER;
      return Math.max(DRUM_BUFFER, Math.min(DRUM_BUFFER + 6, i));
    };
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    const stop = () => {
      window.clearTimeout(timer);
      start = null;
      if (scrubbing.current) {
        scrubbing.current = false;
        scrubbedAt.current = performance.now();
        setScrub(null);
      }
    };
    const ts = (e: TouchEvent) => {
      if (e.touches.length !== 1) return stop();
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      timer = window.setTimeout(() => {
        if (!start) return;
        scrubbing.current = true;
        setScrub(dayAt(start.x));
        navigator.vibrate?.(8);
      }, LONG_PRESS);
    };
    const tm = (e: TouchEvent) => {
      const t = e.touches[0];
      if (scrubbing.current) {
        e.preventDefault();
        setScrub(dayAt(t.clientX));
      } else if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 8) {
        window.clearTimeout(timer);
        start = null;
      }
    };
    const pm = (e: PointerEvent) => e.pointerType === "mouse" && !e.buttons && setScrub(dayAt(e.clientX));
    const pl = (e: PointerEvent) => e.pointerType === "mouse" && setScrub(null);
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", stop);
    el.addEventListener("touchcancel", stop);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerleave", pl);
    return () => {
      stop();
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", stop);
      el.removeEventListener("touchcancel", stop);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerleave", pl);
    };
  }, [ref]);

  /** A tap that should pick a day: not right after a drag or a long-press read. */
  const tapOk = () => !pan.justDragged() && performance.now() - scrubbedAt.current > 350;
  return { scrub, pan, tapOk };
}
