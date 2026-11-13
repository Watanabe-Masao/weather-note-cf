// A sheet over the page (day detail, feel map, similar days, calendar, settings).
//
// - Opens by sliding up with the sheet curve while the page behind dims.
// - Closes the same way in reverse before it is removed (also for ×, Esc, backdrop and picks).
// - Drag down by the handle, or by the content when it is scrolled to its top: the sheet follows
//   the finger, the dimming lightens with it, and a release past a quarter of its height or with
//   a downward flick closes it; otherwise it springs back. Pulling up meets a rubber band.
// - The page behind does not scroll while it is open.
// - Drawn at the page's top level (a portal to <body>): a sheet opened from inside another sheet
//   (settings → 計算の根拠, → the test board) would otherwise be placed and clipped by the outer
//   sheet's transform and scroll (it opened far above the screen).

import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";
import {
  createContext,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MOTION } from "../design/tokens";
import { moveDuration, prefersReducedMotion, rubberBand, SHEET_EASE, VelocityTracker, capture } from "./sheetMotion";

const OPEN_MS: number = MOTION.enter;
const CLOSE_MS: number = MOTION.exit;
const SLOP = 7;
/** Downward flick speed (px/ms) that closes regardless of distance. */
const CLOSE_FLICK = 0.55;

const CloseContext = createContext<() => void>(() => {});
/** Close the surrounding sheet with its animation (use instead of calling onClose directly). */
export const useSheetClose = () => useContext(CloseContext);

/** The one way an overlay sheet shows how to close: × at the right of its header (rule: 閉じ方). */
export function SheetCloseButton() {
  const close = useSheetClose();
  return (
    <button className="icon-btn close" onClick={close} aria-label="閉じる" title="閉じる">
      <CloseIcon />
    </button>
  );
}

interface Props {
  /** The sheet's title: shown in its header next to the close button (every overlay has both). */
  title: ReactNode;
  /** Accessible name when the title is not plain text. */
  label?: string;
  /** Extra controls in the header, before the close button. */
  headerEnd?: ReactNode;
  onClose: () => void;
  className?: string;
  /**
   * "full": the graph sheet's highest height (views: 肌感マップ, 似た日, 設定), so every big surface
   * is one size. "fit": as tall as the content (a short picker: カレンダー).
   */
  size?: "full" | "fit";
  children: ReactNode;
}

type Phase = "entering" | "open" | "closing";

let openSheets = 0;

export function ModalSheet({ title, label, headerEnd, onClose, className, size = "full", children }: Props) {
  const [phase, setPhase] = useState<Phase>("entering");
  const [pull, setPull] = useState<number | null>(null);
  const [settleMs, setSettleMs] = useState(OPEN_MS);
  const panel = useRef<HTMLElement>(null);
  const tracker = useRef(new VelocityTracker());
  const drag = useRef<{ startY: number; raw: number } | null>(null);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const reduced = prefersReducedMotion();

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setSettleMs(CLOSE_MS);
    setPull(null);
    setPhase("closing");
    window.setTimeout(() => onCloseRef.current(), reduced ? 0 : CLOSE_MS);
  }, [reduced]);

  // Slide in on the frame after mounting.
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setPhase("open"));
    panel.current?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(id);
  }, []);

  // Esc closes; the page behind stays still.
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", key);
    openSheets++;
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      if (--openSheets === 0) html.style.overflow = before;
    };
  }, [close]);

  const begin = (y: number) => {
    drag.current = { startY: y, raw: 0 };
    tracker.current.reset(0);
    setPull(0);
  };
  const follow = (y: number) => {
    const d = drag.current;
    if (!d) return;
    d.raw = y - d.startY;
    tracker.current.add(d.raw);
    // Down follows the finger; up resists.
    setPull(d.raw >= 0 ? d.raw : -rubberBand(-d.raw, 40));
  };
  const finish = (tap = false) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const h = panel.current?.offsetHeight ?? 600;
    const v = tracker.current.velocity();
    if (tap && Math.abs(d.raw) < SLOP) return close();
    if (d.raw > h * 0.25 || (v > CLOSE_FLICK && d.raw > SLOP)) return close();
    setSettleMs(reduced ? 0 : moveDuration(d.raw));
    setPull(null);
  };

  // Handle: pointer (drag at once; a tap closes).
  const handleDown = (e: PointerEvent<HTMLDivElement>) => {
    capture(e.currentTarget, e.pointerId);
    begin(e.clientY);
  };

  // Content: touch, taking over only for a downward pull from the top.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let decided = false;
    let taking = false;
    const onStart = (e: TouchEvent) => {
      const handle = (e.target as HTMLElement).closest(".sheet-handle");
      if (handle || e.touches.length !== 1) return;
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
        // Horizontal gestures (graph scrubbing) and anything inside a scrolled area keep their own job.
        const scroller = (e.target as HTMLElement).closest("[data-sheet-scroll]") as HTMLElement | null;
        const atTop = (scroller ?? el).scrollTop <= 0;
        taking = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2 && atTop;
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
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const shown = phase === "open";
  const h = panel.current?.offsetHeight ?? 600;
  const offset = shown ? (pull ?? 0) : null;
  const transform = offset == null ? "translateY(100%)" : `translateY(${offset}px)`;
  const fade = shown ? 1 - Math.max(0, Math.min(1, (pull ?? 0) / h)) * 0.85 : 0;
  const ms = reduced ? 0 : pull != null && drag.current ? 0 : phase === "closing" ? CLOSE_MS : settleMs;
  const ease = phase === "closing" ? "cubic-bezier(0.4, 0, 1, 1)" : SHEET_EASE;

  return createPortal(
    <CloseContext.Provider value={close}>
      <div
        className="msheet-backdrop"
        style={{ opacity: fade, transition: `opacity ${ms}ms ${ease}` }}
        onClick={close}
        aria-hidden
      />
      <section
        ref={panel}
        className={`msheet ${size}${className ? ` ${className}` : ""}${drag.current ? " dragging" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === "string" ? title : undefined)}
        tabIndex={-1}
        data-sheet-scroll
        style={{ transform, transition: `transform ${ms}ms ${ease}` }}
      >
        <div
          className="sheet-handle"
          onPointerDown={handleDown}
          onPointerMove={(e) => follow(e.clientY)}
          onPointerUp={() => finish(true)}
          onPointerCancel={() => finish()}
          role="button"
          aria-label="閉じる"
        >
          <span className="grabber" />
        </div>
        <header className="msheet-head">
          <h2>{title}</h2>
          {headerEnd}
          <SheetCloseButton />
        </header>
        <div className="msheet-body">{children}</div>
      </section>
    </CloseContext.Provider>,
    document.body,
  );
}
