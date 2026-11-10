// The graph bottom sheet: three heights, moved by hand.
//
// Feel (spec: "ボトムシートの操作感を細部まで"):
// - Drag from the handle, from the tab row (a tap still switches tabs), or from the content
//   when it is at its top (pull down) or the sheet is not yet at full height (push up).
// - The sheet follows the finger 1:1, with a rubber band past the lowest and highest heights.
// - On release, a flick carries on in its direction (velocity projection), so a quick short
//   flick moves one step; a slow release goes to the nearest height.
// - It settles with an iOS-like curve whose duration grows with the distance.
// - At full height the page behind dims; tapping it brings the sheet back to the middle.
// - A tap on the handle toggles between the lowest and the middle height.
// - Reduced motion: no animation, same positions.

import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { moveDuration, prefersReducedMotion, releaseTarget, SHEET_EASE, softClamp, VelocityTracker, capture } from "./sheetMotion";

export type Detent = "min" | "mid" | "max";

export const MIN_HEIGHT = 64;
const MID_FLOOR = 200;
/** Movement before a press on the tabs or the content counts as a drag. */
const SLOP = 7;

/**
 * Sheet heights. The middle one is whatever space is left under the comparison table
 * (`spaceBelow`), so the graph and the selected column are both visible on any phone.
 */
export function sheetHeights(spaceBelow: number, viewport = window.innerHeight, topLimit = 0): Record<Detent, number> {
  // Highest: up to just under `topLimit` (the item chips), never above 88% of the screen.
  const max = Math.round(Math.min(viewport * 0.88, topLimit > 0 ? viewport - topLimit - 6 : viewport * 0.82));
  const mid = Math.round(Math.min(max - 40, Math.max(MID_FLOOR, spaceBelow)));
  return { min: MIN_HEIGHT, mid, max };
}

export function nearestDetent(height: number, heights: Record<Detent, number>): Detent {
  return releaseTarget(height, 0, heights);
}

interface Props {
  title: string;
  /** Face switch shown under the handle. */
  tabs?: ReactNode;
  detent: Detent;
  heights: Record<Detent, number>;
  onDetent: (d: Detent) => void;
  children: ReactNode;
  /** The dimming starts below this (px from the top), so the item chips stay bright and usable. */
  scrimTop?: number;
}

interface Drag {
  startY: number;
  startH: number;
  /** The unclamped height the finger asks for (velocity is measured on it). */
  raw: number;
}

export function GraphSheet({ title, tabs, detent, heights, onDetent, children, scrimTop = 0 }: Props) {
  const [live, setLive] = useState<number | null>(null);
  const [duration, setDuration] = useState(320);
  const drag = useRef<Drag | null>(null);
  const tracker = useRef(new VelocityTracker());
  const justDragged = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ detent, heights, onDetent });
  latest.current = { detent, heights, onDetent };

  const height = live ?? heights[detent];

  const begin = (y: number) => {
    const h = latest.current.heights[latest.current.detent];
    drag.current = { startY: y, startH: h, raw: h };
    tracker.current.reset(h);
    setLive(h);
  };
  const follow = (y: number) => {
    const d = drag.current;
    if (!d) return;
    const { heights: hs } = latest.current;
    d.raw = d.startH + (d.startY - y);
    tracker.current.add(d.raw);
    setLive(softClamp(d.raw, hs.min, hs.max));
  };
  const finish = (): boolean => {
    const d = drag.current;
    drag.current = null;
    if (!d) return false;
    const { heights: hs, onDetent: set } = latest.current;
    const moved = Math.abs(d.raw - d.startH) > SLOP;
    const target = releaseTarget(Math.min(hs.max, Math.max(hs.min, d.raw)), tracker.current.velocity(), hs);
    setDuration(prefersReducedMotion() ? 0 : moveDuration(hs[target] - softClamp(d.raw, hs.min, hs.max)));
    set(target);
    setLive(null);
    return moved;
  };

  // ---- the handle: drags at once; a tap toggles lowest ↔ middle ----
  const handleDown = (e: PointerEvent<HTMLDivElement>) => {
    capture(e.currentTarget, e.pointerId);
    begin(e.clientY);
  };
  const handleUp = () => {
    const moved = finish();
    if (!moved) {
      const { detent: d, onDetent: set } = latest.current;
      setDuration(prefersReducedMotion() ? 0 : 340);
      set(d === "min" ? "mid" : "min");
    }
  };

  // ---- the tab row: a tap switches tabs; a vertical move drags the sheet ----
  const pending = useRef<{ x: number; y: number; id: number } | null>(null);
  const tabsDown = (e: PointerEvent<HTMLDivElement>) => {
    pending.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    justDragged.current = false;
  };
  const tabsMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = pending.current;
    if (p && !drag.current) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
        capture(e.currentTarget, p.id);
        begin(p.y);
        justDragged.current = true;
      }
    }
    if (drag.current) follow(e.clientY);
  };
  const tabsUp = () => {
    pending.current = null;
    if (drag.current) finish();
  };

  // ---- the content: touch, so native scrolling keeps working when the sheet should not move ----
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let start: { x: number; y: number } | null = null;
    let decided = false;
    let taking = false;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      decided = false;
      taking = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      if (!decided) {
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        decided = true;
        const vertical = Math.abs(dy) > Math.abs(dx) * 1.2;
        const pullDown = dy > 0 && body.scrollTop <= 0;
        const pushUp = dy < 0 && latest.current.detent !== "max";
        taking = vertical && (pullDown || pushUp);
        if (taking) begin(start.y);
      }
      if (taking) {
        e.preventDefault();
        follow(t.clientY);
      }
    };
    const onEnd = () => {
      if (taking) finish();
      start = null;
      taking = false;
    };
    body.addEventListener("touchstart", onStart, { passive: true });
    body.addEventListener("touchmove", onMove, { passive: false });
    body.addEventListener("touchend", onEnd);
    body.addEventListener("touchcancel", onEnd);
    return () => {
      body.removeEventListener("touchstart", onStart);
      body.removeEventListener("touchmove", onMove);
      body.removeEventListener("touchend", onEnd);
      body.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // The page dims as the sheet rises above the middle height.
  const rise = (height - heights.mid) / Math.max(1, heights.max - heights.mid);
  const dim = Math.max(0, Math.min(1, rise)) * 0.45;
  const motion = live == null ? `height ${duration}ms ${SHEET_EASE}, box-shadow ${duration}ms ${SHEET_EASE}` : "none";

  return (
    <>
      <div
        className="sheet-scrim"
        style={{
          top: scrimTop,
          opacity: dim,
          transition: live == null ? `opacity ${duration}ms ${SHEET_EASE}` : "none",
          pointerEvents: detent === "max" && live == null ? "auto" : "none",
        }}
        onClick={() => {
          setDuration(prefersReducedMotion() ? 0 : 360);
          onDetent("mid");
        }}
        aria-hidden
      />
      <aside
        className={live == null ? "sheet" : "sheet dragging"}
        style={{ height: Math.max(0, height), transition: motion }}
        aria-label={title}
        data-detent={detent}
      >
        <div
          className="sheet-handle"
          role="button"
          aria-label={detent === "min" ? "グラフを開く" : "グラフを小さくする"}
          onPointerDown={handleDown}
          onPointerMove={(e) => follow(e.clientY)}
          onPointerUp={handleUp}
          onPointerCancel={() => finish()}
        >
          <span className="grabber" />
          {!tabs && <span className="sheet-title">{title}</span>}
        </div>
        {tabs && (
          <div
            className="sheet-tabs-wrap"
            onPointerDown={tabsDown}
            onPointerMove={tabsMove}
            onPointerUp={tabsUp}
            onPointerCancel={tabsUp}
            // A drag that started on a tab must not also switch to it.
            onClickCapture={(e) => {
              if (justDragged.current) {
                e.stopPropagation();
                e.preventDefault();
                justDragged.current = false;
              }
            }}
          >
            {tabs}
          </div>
        )}
        <div ref={bodyRef} className="sheet-body">
          {children}
        </div>
      </aside>
    </>
  );
}
