// Bottom sheet holding the graph. Three heights; drag the handle and it snaps to the nearest.

import { type PointerEvent, type ReactNode, useRef, useState } from "react";

export type Detent = "min" | "mid" | "max";

export const MIN_HEIGHT = 64;
const MID_FLOOR = 200;

/**
 * Sheet heights. The middle one is whatever space is left under the comparison table
 * (`spaceBelow`), so the graph and the selected column are both visible on any phone.
 */
export function sheetHeights(spaceBelow: number, viewport = window.innerHeight): Record<Detent, number> {
  const max = Math.round(viewport * 0.82);
  const mid = Math.round(Math.min(max - 40, Math.max(MID_FLOOR, spaceBelow)));
  return { min: MIN_HEIGHT, mid, max };
}

export function nearestDetent(height: number, heights: Record<Detent, number>): Detent {
  return (Object.keys(heights) as Detent[]).reduce((best, d) =>
    Math.abs(heights[d] - height) < Math.abs(heights[best] - height) ? d : best,
  );
}

interface Props {
  title: string;
  detent: Detent;
  heights: Record<Detent, number>;
  onDetent: (d: Detent) => void;
  children: ReactNode;
}

export function GraphSheet({ title, detent, heights, onDetent, children }: Props) {
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const height = live ?? heights[detent];

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: height };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const h = Math.min(heights.max, Math.max(heights.min, d.h + (d.y - e.clientY)));
    setLive(h);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const moved = Math.abs(d.y - e.clientY) > 6;
    // A tap on the handle toggles between the smallest and the middle height.
    onDetent(moved ? nearestDetent(live ?? height, heights) : detent === "min" ? "mid" : "min");
    setLive(null);
  };

  return (
    <aside className={live == null ? "sheet" : "sheet dragging"} style={{ height }} aria-label={title}>
      <div
        className="sheet-handle"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          drag.current = null;
          setLive(null);
        }}
      >
        <span className="grabber" />
        <span className="sheet-title">{title}</span>
      </div>
      <div className="sheet-body">{children}</div>
    </aside>
  );
}

