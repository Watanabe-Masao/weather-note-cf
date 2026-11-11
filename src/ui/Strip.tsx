// A horizontally scrolling row of day columns whose centre column is the selected day ("drum").
// Uses native scrolling with snap points, so momentum and rubber-banding feel like the OS.
//
// - The selected day only changes when scrolling has settled (finger up and no movement).
// - Linked strips share one Sync object: the strip the finger is on leads, the others follow.
// - While a strip is being moved, `onGesture(true)` lets the store hold screen updates.

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { centerIndex, COLUMNS, scrollFor } from "../compare";

const SETTLE_MS = 140;

/** Shared between linked strips. */
export class StripSync {
  leader: string | null = null;
  members = new Map<string, HTMLDivElement>();
}

interface Props {
  /** Visible columns (odd, the centre in the middle). */
  columns?: number;
  id: string;
  dates: string[];
  center: string;
  sync?: StripSync | null;
  onSettle: (date: string) => void;
  onGesture: (active: boolean) => void;
  renderColumn: (date: string) => ReactNode;
  /** Days that can be shown but not chosen (faded edge columns). Releasing on one springs back. */
  selectable?: (date: string) => boolean;
}

export function Strip({ id, dates, center, sync, onSettle, onGesture, renderColumn, selectable, columns = COLUMNS }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [col, setCol] = useState(0);
  const state = useRef({ touching: false, active: false, timer: 0, programmatic: false, firstDate: "" });
  const latest = useRef({ dates, center, onSettle, onGesture, selectable, columns });
  latest.current = { dates, center, onSettle, onGesture, selectable, columns };

  // Column width = a seventh of the visible strip.
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => setCol(el.clientWidth / columns);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns]);

  useEffect(() => {
    if (!sync || !ref.current) return;
    sync.members.set(id, ref.current);
    return () => void sync.members.delete(id);
  }, [sync, id]);

  // Put the selected day in the centre when it changes from outside (buttons, calendar, today).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !col) return;
    const index = dates.indexOf(center);
    if (index < 0) return;
    const s = state.current;
    if (s.active) return; // the finger is in charge
    const target = scrollFor(index, col);
    if (Math.abs(el.scrollLeft - target) < 1) return;
    // A new window (moved range) or first layout jumps; anything else glides.
    const jump = s.firstDate !== dates[0] || el.scrollLeft === 0;
    s.firstDate = dates[0];
    s.programmatic = true;
    if (sync) sync.leader = null;
    el.scrollTo({ left: target, behavior: jump ? "instant" : "smooth" });
  }, [center, dates, col, sync]);

  const settle = useCallback(() => {
    const el = ref.current;
    const s = state.current;
    if (!el || s.touching) return;
    if (s.programmatic) {
      s.programmatic = false;
      return;
    }
    if (!s.active) return;
    s.active = false;
    if (sync && sync.leader === id) sync.leader = null;
    for (const m of sync?.members.values() ?? []) m.classList.remove("following");
    const { dates: ds, center: current, onSettle: done, onGesture: gesture, selectable: canSelect } = latest.current;
    const colWidth = el.clientWidth / latest.current.columns;
    const index = centerIndex(el.scrollLeft, colWidth, ds.length);
    gesture(false);
    if (!canSelect || canSelect(ds[index])) {
      if (ds[index]) done(ds[index]);
      return;
    }
    // Released past the edge: stop at the last day that can be chosen, walking back towards the current day.
    const from = ds.indexOf(current);
    const toward = from < index ? -1 : 1;
    let nearest = index;
    while (nearest >= 0 && nearest < ds.length && !canSelect(ds[nearest])) nearest += toward;
    const target = ds[nearest] ?? current;
    if (target !== current) {
      done(target); // the new centre scrolls the strip there
      return;
    }
    // Already on the edge day: glide back to it (and pull linked strips along).
    s.programmatic = true;
    const left = scrollFor(from, colWidth);
    el.scrollTo({ left, behavior: "smooth" });
    for (const [key, m] of sync?.members ?? []) if (key !== id) m.scrollTo({ left, behavior: "smooth" });
  }, [id, sync]);

  const begin = () => {
    const s = state.current;
    s.programmatic = false;
    if (!s.active) {
      s.active = true;
      latest.current.onGesture(true);
    }
    if (sync) {
      sync.leader = id;
      for (const [key, m] of sync.members) if (key !== id) m.classList.add("following");
    }
  };

  const onScroll = () => {
    const el = ref.current!;
    const s = state.current;
    if (sync && sync.leader && sync.leader !== id) return; // following another strip
    if (!s.active && !s.programmatic) begin(); // trackpad or wheel without a touch
    if (sync && sync.leader === id)
      for (const [key, m] of sync.members) if (key !== id) m.scrollLeft = el.scrollLeft;
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(settle, SETTLE_MS);
  };

  const onTouchStart = () => {
    state.current.touching = true;
    begin();
  };
  const onTouchEnd = () => {
    const s = state.current;
    s.touching = false;
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(settle, SETTLE_MS);
  };

  return (
    <div
      ref={ref}
      className="strip"
      style={{ ["--col" as string]: `${col}px`, ["--pad" as string]: (columns - 1) / 2 }}
      onScroll={onScroll}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onPointerDown={(e) => e.pointerType === "mouse" && begin()}
      onPointerUp={(e) => e.pointerType === "mouse" && onTouchEnd()}
    >
      <div className="strip-pad" />
      {dates.map((d) => (
        <div key={d} className={d === center ? "strip-col is-center" : "strip-col"}>
          {renderColumn(d)}
        </div>
      ))}
      <div className="strip-pad" />
    </div>
  );
}
