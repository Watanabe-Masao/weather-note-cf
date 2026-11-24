// A horizontally scrolling row of day columns whose centre column is the selected day ("drum").
// Uses native scrolling with snap points, so momentum and rubber-banding feel like the OS.
//
// - The selected day only changes when scrolling has settled (finger up and no movement).
// - Linked strips share one Sync object: the strip the finger is on leads, the others follow.
// - While a strip is being moved, `onGesture(true)` lets the store hold screen updates.
// - A tap (the strip did not move between finger down and up) is not a gesture: the column's own tap
//   chooses its day, and the strip glides that day to the centre (2026-11-24 渡辺さん「タップでも選択」).

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { centerIndex, COLUMNS, scrollFor } from "../compare";

const SETTLE_MS = 140;
/** 幅が変わってからこの間（ms）の、指でないスクロールはなぞったことにしない。 */
const RESIZE_QUIET_MS = 400;
/** 指を置いてから離すまでに、これより動いていなければタップ（px）。 */
const TAP_SLOP = 6;

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
  const state = useRef({
    touching: false,
    active: false,
    timer: 0,
    programmatic: false,
    firstDate: "",
    /** Where the strip was at the last scroll event (to tell a real stop from late scroll events). */
    lastLeft: 0,
    /** Where a programmatic scroll is heading. */
    goal: 0,
    /** The column width the strip was last put on its centre with (a new width means the position means another day). */
    col: 0,
    /** When the strip's width last changed (performance.now()). */
    resizedAt: 0,
    /** Where the strip was when the finger (or mouse) went down. */
    downLeft: 0,
  });
  const latest = useRef({ dates, center, onSettle, onGesture, selectable, columns });
  latest.current = { dates, center, onSettle, onGesture, selectable, columns };

  // Column width = a seventh of the visible strip.
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => {
      state.current.resizedAt = performance.now();
      setCol(el.clientWidth / columns);
    };
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
    const moved = s.firstDate !== dates[0];
    s.firstDate = dates[0];
    // 幅が変わった（横向き・縦向き、2026-11-19）：同じスクロール位置が別の日を指すので、なぞっている途中とみなさず、
    // 選んでいる日に置き直す。幅が変わったときのスクロールの知らせを「なぞった」と取ると、別の日を選び直してしまう。
    const resized = s.col !== 0 && s.col !== col;
    s.col = col;
    // The finger is in charge — unless the days themselves changed under it (連動/個別 switched,
    // or the rule changed, mid-glide): then the position means another day, so the gesture is
    // dropped and the strip is put on its centre at once instead of settling on a wrong day.
    if (s.active) {
      if (!moved && !resized) return;
      s.active = false;
      window.clearTimeout(s.timer);
      latest.current.onGesture(false);
      if (sync && sync.leader === id) sync.leader = null;
      for (const m of sync?.members.values() ?? []) m.classList.remove("following");
    }
    const target = scrollFor(index, col);
    if (Math.abs(el.scrollLeft - target) < 1) return;
    // A new window (moved range) or first layout jumps; anything else glides.
    const jump = moved || resized || el.scrollLeft === 0;
    s.programmatic = true;
    s.goal = target;
    if (sync) sync.leader = null;
    el.scrollTo({ left: target, behavior: jump ? "instant" : "smooth" });
  }, [center, dates, col, sync]);

  const settle = useCallback(() => {
    const el = ref.current;
    const s = state.current;
    if (!el || s.touching) return;
    // Only settle once the strip has really stopped. While the page is busy (data arriving and being
    // drawn), iOS can deliver momentum scroll events late: a quiet moment is not a stop. Settling
    // mid-glide would fix a day there and pull the strip back to it.
    if (Math.abs(el.scrollLeft - s.lastLeft) > 0.5) {
      s.lastLeft = el.scrollLeft;
      window.clearTimeout(s.timer);
      s.timer = window.setTimeout(settle, SETTLE_MS);
      return;
    }
    if (s.programmatic) {
      s.programmatic = false;
      // Our own glide ended where it was heading: nothing to do. If the finger's momentum carried
      // the strip elsewhere meanwhile, that is the user's choice: settle on it like a gesture.
      if (Math.abs(el.scrollLeft - s.goal) < 2) return;
      if (!s.active) {
        s.active = true;
        latest.current.onGesture(true);
      }
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
    s.goal = left;
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

  // The days that can be chosen, as scroll positions: a flick stops a little past them (a wall,
  // not a long glide into faded and unpainted columns that then crawls back).
  const edges = useMemo(() => {
    if (!selectable) return null;
    let first = -1;
    let last = -1;
    dates.forEach((d, i) => {
      if (selectable(d)) {
        if (first < 0) first = i;
        last = i;
      }
    });
    return first < 0 ? null : { first, last };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates]);

  const onScroll = () => {
    const el = ref.current!;
    const s = state.current;
    if (sync && sync.leader && sync.leader !== id) return; // following another strip
    // 幅が変わった直後の（指でない）スクロールは、ブラウザが位置を合わせ直しただけ：なぞったことにしない。
    if (!s.active && !s.programmatic && !s.touching && performance.now() - s.resizedAt < RESIZE_QUIET_MS) {
      s.lastLeft = el.scrollLeft;
      return;
    }
    if (!s.active && !s.programmatic) begin(); // trackpad or wheel without a touch
    if (edges && col && s.active) {
      // Past the last (or first) day by more than half a column: stop there. Setting the position
      // also ends iOS momentum, so the release glides back to the edge day at once.
      const over = col * (s.touching ? 0.9 : 0.5);
      const lo = scrollFor(edges.first, col) - over;
      const hi = scrollFor(edges.last, col) + over;
      if (el.scrollLeft > hi) el.scrollLeft = hi;
      else if (el.scrollLeft < lo) el.scrollLeft = Math.max(0, lo);
    }
    if (sync && sync.leader === id)
      for (const [key, m] of sync.members) if (key !== id) m.scrollLeft = el.scrollLeft;
    s.lastLeft = el.scrollLeft;
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(settle, SETTLE_MS);
  };

  const onTouchStart = () => {
    state.current.touching = true;
    state.current.downLeft = ref.current?.scrollLeft ?? 0;
    begin();
  };

  // A tap on a column: the strip did not move, so there is nothing to settle. End the gesture before the
  // column's own tap runs (capture phase): its new day then glides to the centre like a day chosen from
  // outside, instead of being taken back by the settle of a gesture that never moved.
  const onClickCapture = () => {
    const el = ref.current;
    const s = state.current;
    if (!el || s.touching || !s.active || Math.abs(el.scrollLeft - s.downLeft) > TAP_SLOP) return;
    window.clearTimeout(s.timer);
    s.active = false;
    if (sync && sync.leader === id) sync.leader = null;
    for (const m of sync?.members.values() ?? []) m.classList.remove("following");
    latest.current.onGesture(false);
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
      onClickCapture={onClickCapture}
      // A mouse's release is heard on the window: it may land elsewhere (a sheet opened by a long
      // press, #176), and a release the strip never hears would keep the screen held as moving.
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") return;
        state.current.downLeft = ref.current?.scrollLeft ?? 0;
        begin();
        window.addEventListener("pointerup", onTouchEnd, { once: true });
      }}
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
