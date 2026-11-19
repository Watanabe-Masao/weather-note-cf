import { type PointerEvent, useEffect, useRef, useState } from "react";
import { Button } from "./kit";
import { dirName } from "./moonParts";
import { useDrawnWidth } from "./useDrawnWidth";

/** 1° を何 px で描くか（目盛りの細かさ）。なぞった量 ÷ これ が直す角度。 */
const PX_PER_DEG = 4;
const LIMIT = 180;
/** これだけ押し続けると目盛りが開く（ms）。その前に指が動いても開く（すぐなぞりはじめた）。 */
const HOLD_MS = 350;
const MOVE_PX = 8;

const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * 方位を直す（2026-11-19 渡辺さん「長押しでメモリの表示、長押ししながら横にスライドで補正、離すと閉じる」）：ボタンは1つ。
 * - 長押し（または押してすぐ横へなぞる）：上に目盛りが開き、そのまま左右になぞると方位がずれる（右へなぞると小さく＝左へ）。
 *   離すと目盛りは閉じる。
 * - 短く押す：onTap（カメラのときは「本物に合わせる」）。無いときは使い方を onHint で知らせる。
 * - キー：←→ で 1°、PageUp/PageDown で 10°、Enter・Space は短く押すのと同じ。
 * 補正が 0 でないときは、ボタンに値と、横に「0°に」。
 */
export function CompassTrim({ value, onChange, heading, onTap, pressed, onHint }: { value: number; onChange: (v: number) => void; heading: number; onTap?: () => void; pressed?: boolean; onHint?: () => void }) {
  const [open, setOpen] = useState(false);
  const scale = useRef<HTMLDivElement>(null);
  const width = useDrawnWidth(scale, [open], 280) || 280;
  const press = useRef<{ x: number; v: number; timer: number; holding: boolean } | null>(null);
  const clamp = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, round1(v)));
  useEffect(() => () => window.clearTimeout(press.current?.timer), []);

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = { x: e.clientX, v: value, timer: 0, holding: false };
    p.timer = window.setTimeout(() => {
      p.holding = true;
      setOpen(true);
    }, HOLD_MS);
    press.current = p;
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    if (!p.holding && Math.abs(dx) >= MOVE_PX) {
      window.clearTimeout(p.timer);
      p.holding = true;
      setOpen(true);
    }
    if (p.holding) onChange(clamp(p.v - dx / PX_PER_DEG));
  };
  const up = (cancel: boolean) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    window.clearTimeout(p.timer);
    if (p.holding) setOpen(false);
    else if (!cancel) (onTap ?? onHint)?.();
  };

  const w = width;
  const h = 40;
  const half = w / 2 / PX_PER_DEG;
  const ticks: number[] = [];
  for (let d = Math.ceil((heading - half) / 5) * 5; d <= heading + half; d += 5) ticks.push(d);
  const xOf = (d: number) => w / 2 + (d - heading) * PX_PER_DEG;
  const norm = (d: number) => ((d % 360) + 360) % 360;

  return (
    <>
      <Button
        size="sm"
        className="compass-hold"
        data-no-sheet-drag
        aria-pressed={pressed}
        aria-label={`方位を直す（今の補正 ${signed(value)}°）。長押しして左右になぞると直せる${onTap ? "、短く押すと本物に合わせる" : ""}。←→ キーで 1°`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => up(false)}
        onPointerCancel={() => up(true)}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          const step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -10, PageUp: 10 }[e.key];
          if (step !== undefined) {
            e.preventDefault();
            onChange(clamp(value + step));
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            (onTap ?? onHint)?.();
          }
        }}
      >
        方位を直す{value !== 0 ? ` ${signed(value)}°` : ""}
      </Button>
      {value !== 0 && (
        <Button size="sm" onClick={() => onChange(0)}>
          0°に
        </Button>
      )}
      {/* 目盛り（押している間だけ）：窓の下の端に重ねて開き、離すと閉じる。真ん中の線が今向いている方位。 */}
      <div ref={scale} className={open ? "compass-pop open" : "compass-pop"} aria-hidden>
        <span className="compass-pop-value">方位の補正 {signed(value)}°</span>
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
          {ticks.map((d) => {
            const major = norm(d) % 45 === 0;
            const len = norm(d) % 15 === 0 ? 10 : 6;
            const x = xOf(d);
            return major ? (
              <text key={d} x={x} y={h / 2 + 5} textAnchor="middle" className="compass-trim-dir">
                {dirName(norm(d))}
              </text>
            ) : (
              <g key={d}>
                <line x1={x} x2={x} y1={0} y2={len} className="compass-trim-tick" />
                <line x1={x} x2={x} y1={h - len} y2={h} className="compass-trim-tick" />
              </g>
            );
          })}
          <line x1={w / 2} x2={w / 2} y1={0} y2={h} className="compass-trim-center" />
        </svg>
      </div>
    </>
  );
}
