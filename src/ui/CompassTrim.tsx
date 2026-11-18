import { type PointerEvent, useRef, useState } from "react";
import { Button, IconButton } from "./kit";
import { CloseIcon } from "./icons";
import { dirName } from "./moonParts";
import { useDrawnWidth } from "./useDrawnWidth";

/** 1° を何 px で描くか（目盛りの細かさ）。なぞった量 ÷ これ が直す角度。 */
const PX_PER_DEG = 4;
const LIMIT = 180;

const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

/**
 * コンパス補正（2026-11-19）：方位の目盛りを左右になぞって、実際の景色と太陽・月の位置を合わせる。
 * 閉じているときは「コンパス補正」のボタンだけ。開くと、真ん中の線が今向いている方位を指す目盛りと「×」が出る。
 * 目盛りを右へなぞると方位が小さく（左へ）、左へなぞると大きく（右へ）ずれる。←→ キーで 1°、PageUp/PageDown で 10°。
 */
export function CompassTrim({ value, onChange, heading }: { value: number; onChange: (v: number) => void; heading: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const width = useDrawnWidth(ref, [open], 240) || 240;
  const drag = useRef<{ x: number; v: number } | null>(null);
  const clamp = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, Math.round(v)));

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        コンパス補正{value !== 0 ? ` ${signed(value)}°` : ""}
      </Button>
    );
  }
  const w = width;
  const h = 44;
  const half = w / 2 / PX_PER_DEG;
  const ticks: number[] = [];
  for (let d = Math.ceil((heading - half) / 5) * 5; d <= heading + half; d += 5) ticks.push(d);
  const xOf = (d: number) => w / 2 + (d - heading) * PX_PER_DEG;
  const norm = (d: number) => ((d % 360) + 360) % 360;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, v: value };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onChange(clamp(drag.current.v - (e.clientX - drag.current.x) / PX_PER_DEG));
  };
  const up = () => {
    drag.current = null;
  };

  return (
    <div className="compass-trim">
      <span className="compass-trim-value" aria-hidden>
        コンパス補正 {signed(value)}°
      </span>
      <div className="compass-trim-row">
        <IconButton size="sm" label="コンパス補正を閉じる" onClick={() => setOpen(false)}>
          <CloseIcon />
        </IconButton>
        <div
          ref={ref}
          className="compass-trim-scale"
          role="slider"
          tabIndex={0}
          data-no-sheet-drag
          aria-label="コンパス補正（目盛りを左右になぞる）"
          aria-valuemin={-LIMIT}
          aria-valuemax={LIMIT}
          aria-valuenow={value}
          aria-valuetext={`${signed(value)}°・いま ${dirName(heading)} ${Math.round(norm(heading))}°`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={(e) => {
            const step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -10, PageUp: 10 }[e.key];
            if (step === undefined) return;
            e.preventDefault();
            onChange(clamp(value + step));
          }}
        >
          <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
            {ticks.map((d) => {
              const major = norm(d) % 45 === 0;
              const mid = !major && norm(d) % 15 === 0;
              const len = major ? 0 : mid ? 10 : 6;
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
        {value !== 0 && (
          <Button size="sm" onClick={() => onChange(0)}>
            0°に
          </Button>
        )}
      </div>
    </div>
  );
}
