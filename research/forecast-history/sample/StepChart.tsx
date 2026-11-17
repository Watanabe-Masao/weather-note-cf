// 予報の履歴 R6 の見本：案G「気温は階段と幅の帯、降水確率は濃淡のマス」（2026-11-17）。
// - 横は発表の時刻（等間隔）。予報は次の発表まで変わらないので、気温は斜めに結ばず、次の発表まで水平に
//   伸ばして発表の所で段差にする（その時点で何と予報されていたかを正確に読める）。
// - 週間予報の「予測範囲」（最高 25〜29℃ など）を帯で描く。日が近づくと帯が細くなる＝予報が絞られていく。
// - 降水確率は線にしない。発表ごとに、週間は1マス（1日）、府県天気予報は縦に4マス（0〜6・6〜12・12〜18・
//   18〜24時、上から）。確率が高いほど濃い。区切りの違いがマスの数でそのまま見え、選ぶ・まとめるが要らない。
// - 週間と府県天気予報は色の濃さで描き分ける（週間は落ち着いた色）。気温は種類が変わる所で線を切る
//   （「最高」と「日中の最高」は別の値）。

import { useRef, type PointerEvent as RPointerEvent } from "react";
import { svgTextSize, useDrawnWidth } from "../../../src/ui/useDrawnWidth";
import { DATA, lineLook } from "../../../src/design/tokens";
import { hourOf, md, primaryAt, type Slot, type V } from "./model";
import { vNum, Wx } from "./Transition";

const W = 300;
const PAD_L = 26;
const PAD_R = 8;
const HOLD_MS = 280;
const quiet = (c: string) =>
  `color-mix(in srgb, var(--data-${c}) 55%, var(--surface-raised))`;
/** 降水確率のマスの色：確率の割合だけ雨の色を混ぜる（0% は面の色、100% は雨の色）。 */
const cell = (p: number) =>
  `color-mix(in srgb, var(--data-rain) ${Math.round(12 + p * 0.88)}%, var(--surface-inset))`;

export function StepChart({
  slots,
  day,
  focus,
  onScrub,
  onSelect,
  recent = false,
  axis = "date",
}: {
  slots: Slot[];
  day: string;
  focus: string | null;
  /** 新しい発表を強く、古い発表を控えめに描く（ECMWF の重ね描きの考え方）。気温の線と帯だけ。マスの濃さは確率なので変えない。 */
  recent?: boolean;
  /** 横の目盛り：date＝日付だけ（時の数字を出さない）、clock＝発表の時刻を時計の絵で。 */
  axis?: "date" | "clock";
  onScrub: (key: string | null, phase: "move" | "end") => void;
  onSelect: (key: string) => void;
}) {
  const timer = useRef<number | null>(null);
  const scrubbing = useRef(false);
  const lastKey = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drawn = useDrawnWidth(svgRef);
  // 数字は画面の上で xs（11px）になる大きさ（SVG の中は描く幅の単位なので、測って直す）。
  const fs = svgTextSize("xs", 300, drawn, 330);
  if (!slots.length) return null;

  const times = [...new Set(slots.map((z) => z.at))].sort(
    (a, b) => Date.parse(a) - Date.parse(b),
  );
  const SPAN = W - PAD_L - PAD_R;
  const step = SPAN / times.length;
  // 発表 k の区間は [PAD_L + k*step, PAD_L + (k+1)*step]。点はその左端、マスは区間の中。
  const xi = (iso: string) => PAD_L + times.indexOf(iso) * step;
  const xEnd = (iso: string) => xi(iso) + step;

  const temps = slots.flatMap((s) => {
    const out: number[] = [];
    for (const k of ["max", "min"] as const) {
      const v = s.values?.[k];
      if (v && v.s === "value") {
        out.push(Number(v.v));
        if (v.lower != null) out.push(v.lower);
        if (v.upper != null) out.push(v.upper);
      }
    }
    return out;
  });
  const lo = temps.length ? Math.floor(Math.min(...temps) / 5) * 5 : 0;
  const hi = temps.length ? Math.ceil(Math.max(...temps) / 5) * 5 : 30;
  const ICON_Y = 11;
  const BAND_Y = 38; // 「1日ごと（週間）」「6時間ごと（府県）」の帯
  const CELL_TOP = 46;
  const ROW = Math.ceil(fs + 4); // 6時間の1マスの高さ（数字が入る）
  const CELL_H = ROW * 4;
  const T_TOP = CELL_TOP + CELL_H + 16;
  const T_H = 96;
  const AX = T_TOP + T_H + 4;
  const height = AX + (axis === "clock" ? 32 : 18);
  const ty = (v: number) => T_TOP + T_H - ((v - lo) / (hi - lo || 1)) * T_H;
  const width = (c: "hot" | "cold") => lineLook("target", DATA[c]).strokeWidth;

  const ok = slots.filter((s) => s.state === "ok" && s.values);
  // 同じ時刻に週間と府県天気予報があるときは、その値を持っている方を描く。両方持っていれば府県天気予報
  // （詳しい方）。府県天気予報の明後日の分は降水確率・気温がないので、そこは週間のまま。
  const pick = (t: string, has: (s: Slot) => boolean) => {
    const at = ok.filter((s) => s.at === t);
    return (
      at.find((s) => s.kind === "VPFD51" && has(s)) ??
      at.find((s) => s.kind === "VPFW50" && has(s)) ??
      null
    );
  };
  const hasPop = (s: Slot) =>
    s.kind === "VPFW50"
      ? vNum(s.values?.popDay) != null
      : (s.values?.pop6 ?? []).some((q) => vNum(q) != null);
  const popAt = new Map(times.map((t) => [t, pick(t, hasPop)] as const));
  const shownAt = new Map(times.map((t) => [t, pick(t, () => true)] as const));
  const series = times.map((t) => shownAt.get(t) ?? null);
  const tempSeries = (k: "max" | "min") =>
    times.map((t) => pick(t, (s) => vNum(s.values?.[k]) != null));

  // 気温の階段：同じ種類が続く間は1本、種類が変わる所・値がない所で切る。
  const stairs = (k: "max" | "min") => {
    const runs: {
      kind: Slot["kind"];
      pts: { x0: number; x1: number; y: number; v: number; s: Slot }[];
    }[] = [];
    for (const s of tempSeries(k)) {
      const v = s ? vNum(s.values?.[k]) : null;
      if (!s || v == null) {
        runs.push({ kind: "VPFW50", pts: [] });
        continue;
      }
      const last = runs.at(-1);
      const p = { x0: xi(s.at), x1: xEnd(s.at), y: ty(v), v, s };
      if (last && last.pts.length && last.kind === s.kind) last.pts.push(p);
      else runs.push({ kind: s.kind, pts: [p] });
    }
    return runs.filter((r) => r.pts.length);
  };
  // 古さ（0 = いちばん新しい、1 = いちばん古い）。
  const age = (iso: string) =>
    times.length > 1
      ? (times.length - 1 - times.indexOf(iso)) / (times.length - 1)
      : 0;
  const fade = (base: string, iso: string) =>
    recent
      ? `color-mix(in srgb, ${base} ${Math.round(100 - 60 * age(iso))}%, var(--surface-raised))`
      : base;
  const path = (pts: { x0: number; x1: number; y: number }[]) =>
    pts
      .map(
        (p, i) =>
          `${i ? `L${p.x0.toFixed(1)},${p.y.toFixed(1)}` : `M${p.x0.toFixed(1)},${p.y.toFixed(1)}`}L${p.x1.toFixed(1)},${p.y.toFixed(1)}`,
      )
      .join("");

  const nearest = (clientX: number) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const px = (clientX - m.e) / m.a;
    const k = Math.min(
      times.length - 1,
      Math.max(0, Math.floor((px - PAD_L) / step)),
    );
    const t = times[k];
    return primaryAt(slots, t);
  };
  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const down = (ev: RPointerEvent<SVGRectElement>) => {
    const cx = ev.clientX;
    const el = ev.currentTarget;
    const id = ev.pointerId;
    clear();
    timer.current = window.setTimeout(() => {
      scrubbing.current = true;
      try {
        el.setPointerCapture(id);
      } catch {
        /* もう離れている */
      }
      const s = nearest(cx);
      if (s) {
        lastKey.current = s.key;
        onScrub(s.key, "move");
      }
    }, HOLD_MS);
  };
  const move = (ev: RPointerEvent<SVGRectElement>) => {
    if (!scrubbing.current) return;
    ev.preventDefault();
    const s = nearest(ev.clientX);
    if (s) {
      lastKey.current = s.key;
      onScrub(s.key, "move");
    }
  };
  const up = (ev: RPointerEvent<SVGRectElement>) => {
    const was = scrubbing.current;
    clear();
    scrubbing.current = false;
    if (was) onScrub(lastKey.current, "end");
    else {
      const s = nearest(ev.clientX);
      if (s) onSelect(s.key);
    }
  };
  const focusSlot = slots.find((s) => s.key === focus) ?? null;
  const band = (v: V | null | undefined) =>
    v && v.s === "value" && v.lower != null && v.upper != null
      ? { lo: v.lower, hi: v.upper }
      : null;

  return (
    <div className="fh-chart fh-one fh-step">
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${height}`}
        className="fh-one-svg"
        role="img"
        aria-label="発表ごとの予報の移り変わり（気温は階段、降水確率はマス）"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* 選んだ発表の区間 */}
        {focusSlot && (
          <rect
            x={xi(focusSlot.at)}
            y={2}
            width={step}
            height={AX - 2}
            rx={3}
            className="fh-colsel"
          />
        )}
        {/* 天気の絵 */}
        {series.map((s) =>
          s ? (
            <foreignObject
              key={`w${s.key}`}
              x={xi(s.at) + step / 2 - 7}
              y={ICON_Y - 7}
              width={14}
              height={14}
            >
              <Wx s={s} size={14} />
            </foreignObject>
          ) : null,
        )}
        {/* 帯：ここまでは1日ごと（週間）、ここからは6時間ごと（府県天気予報）。境目に点線 */}
        {(() => {
          const fd = times.find((t) => popAt.get(t)?.kind === "VPFD51");
          const xs = fd ? xi(fd) : null;
          const band = (x0: number, x1: number, label: string) =>
            x1 - x0 > 20 ? (
              <g className="fh-band">
                <line
                  x1={x0 + 2}
                  x2={x1 - 2}
                  y1={BAND_Y}
                  y2={BAND_Y}
                  markerStart="url(#fh-arr-l)"
                  markerEnd="url(#fh-arr-r)"
                />
                <text
                  x={(x0 + x1) / 2}
                  y={BAND_Y - 3}
                  textAnchor="middle"
                  fontSize={fs}
                >
                  {label}
                </text>
              </g>
            ) : null;
          return (
            <g>
              <defs>
                <marker
                  id="fh-arr-r"
                  viewBox="0 0 6 6"
                  refX="5"
                  refY="3"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto"
                >
                  <path d="M0,0 L6,3 L0,6" className="fh-band-arrow" />
                </marker>
                <marker
                  id="fh-arr-l"
                  viewBox="0 0 6 6"
                  refX="1"
                  refY="3"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto"
                >
                  <path d="M6,0 L0,3 L6,6" className="fh-band-arrow" />
                </marker>
              </defs>
              {band(PAD_L, xs ?? W - PAD_R, "1日ごと（週間）")}
              {xs != null && band(xs, W - PAD_R, "6時間ごと（府県）")}
              {xs != null && (
                <line
                  x1={xs}
                  x2={xs}
                  y1={BAND_Y - 10}
                  y2={CELL_TOP + CELL_H + 2}
                  className="fh-band-split"
                />
              )}
            </g>
          );
        })()}
        {/* 降水確率のマス：左に時間帯（府県天気予報の4マスは上から 0〜6・6〜12・12〜18・18〜24時） */}
        {["0-6", "6-12", "12-18", "18-24"].map((n, i) => (
          <text
            key={n}
            x={PAD_L - 3}
            y={CELL_TOP + i * ROW + ROW / 2 + fs * 0.35}
            textAnchor="end"
            fontSize={fs * 0.92 < 11 ? fs : fs * 0.92}
            className="fh-tick"
          >
            {n.split("-")[0]}
          </text>
        ))}
        <text
          x={PAD_L - 3}
          y={CELL_TOP - 2}
          textAnchor="end"
          fontSize={fs}
          className="fh-tick quiet"
        >
          時
        </text>
        {times.map((t) => {
          const s = popAt.get(t);
          const gx = xi(t) + 1;
          const gw = step - 2;
          const num = (p: number, cy: number) => (
            <text
              x={gx + gw / 2}
              y={cy + fs * 0.35}
              textAnchor="middle"
              fontSize={fs}
              className="fh-step-val"
            >
              {p}
            </text>
          );
          if (!s) {
            const gap = slots.find((z) => z.at === t);
            return (
              <rect
                key={`c${t}`}
                x={gx}
                y={CELL_TOP}
                width={gw}
                height={CELL_H}
                rx={2}
                className={`fh-step-gap ${gap?.state ?? ""}`}
              />
            );
          }
          if (s.kind === "VPFW50") {
            const p = vNum(s.values?.popDay);
            return (
              <g key={`c${t}`}>
                <rect
                  x={gx}
                  y={CELL_TOP}
                  width={gw}
                  height={CELL_H}
                  rx={2}
                  style={{ fill: p == null ? "transparent" : cell(p) }}
                  className={p == null ? "fh-step-none" : "fh-step-cell"}
                />
                {p != null && num(p, CELL_TOP + CELL_H / 2)}
              </g>
            );
          }
          return (
            <g key={`c${t}`}>
              {(s.values?.pop6 ?? []).map((q, i) => {
                const p = vNum(q);
                const y = CELL_TOP + i * ROW;
                return (
                  <g key={i}>
                    <rect
                      x={gx}
                      y={y + 0.5}
                      width={gw}
                      height={ROW - 1}
                      rx={1.5}
                      style={{ fill: p == null ? "transparent" : cell(p) }}
                      className={p == null ? "fh-step-none" : "fh-step-cell"}
                    />
                    {p != null && num(p, y + ROW / 2)}
                  </g>
                );
              })}
            </g>
          );
        })}
        {/* 当日の発表（対象日に出た発表）をまとめて枠で囲む：どこからが当日か */}
        {(() => {
          const today = times.filter((t) => t.slice(0, 10) === day);
          if (!today.length) return null;
          const x0 = xi(today[0]) + 0.5;
          const x1 = xEnd(today[today.length - 1]) - 0.5;
          return (
            <g className="fh-step-today">
              <rect x={x0} y={2} width={x1 - x0} height={AX - 2} rx={4} />
            </g>
          );
        })()}
        {/* 気温の軸 */}
        {[lo, hi].map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={ty(v)}
              y2={ty(v)}
              className="fh-grid"
            />
            <text
              x={PAD_L - 4}
              y={ty(v) + 3.5}
              className="fh-tick"
              textAnchor="end"
            >
              {v}
            </text>
          </g>
        ))}
        {/* 予測範囲（帯） */}
        {(["max", "min"] as const).map((k) =>
          tempSeries(k).map((s) => {
            const b = s && s.kind === "VPFW50" ? band(s.values?.[k]) : null;
            return b ? (
              <rect
                key={`b${k}${s!.key}`}
                x={xi(s!.at)}
                y={ty(b.hi)}
                width={step}
                height={Math.max(1, ty(b.lo) - ty(b.hi))}
                className={`fh-step-band ${k}`}
                style={
                  recent
                    ? {
                        opacity: undefined,
                        fill: `color-mix(in srgb, var(--data-${k === "max" ? "hot" : "cold"}) ${Math.round(18 - 12 * age(s!.at))}%, transparent)`,
                      }
                    : undefined
                }
              />
            ) : null;
          }),
        )}
        {/* 気温の階段 */}
        {(["max", "min"] as const).map((k) =>
          stairs(k).map((r, i) => {
            const c = k === "max" ? "hot" : "cold";
            const stroke = r.kind === "VPFW50" ? quiet(c) : `var(--data-${c})`;
            return (
              <g key={`${k}${i}`}>
                {recent ? (
                  r.pts.map((p, j) => (
                    <path
                      key={`s${p.s.key}`}
                      d={`${j ? `M${r.pts[j - 1].x1.toFixed(1)},${r.pts[j - 1].y.toFixed(1)}L${p.x0.toFixed(1)},${p.y.toFixed(1)}` : `M${p.x0.toFixed(1)},${p.y.toFixed(1)}`}L${p.x1.toFixed(1)},${p.y.toFixed(1)}`}
                      fill="none"
                      stroke={fade(stroke, p.s.at)}
                      strokeWidth={width(c) * (1 - 0.45 * age(p.s.at))}
                      strokeLinejoin="round"
                    />
                  ))
                ) : (
                  <path
                    d={path(r.pts)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={width(c)}
                    strokeLinejoin="round"
                  />
                )}
                {r.pts.map((p, j) => {
                  const changed = j === 0 || p.v !== r.pts[j - 1].v;
                  const on = focus === p.s.key;
                  return changed || on ? (
                    <text
                      key={p.s.key}
                      x={(p.x0 + p.x1) / 2}
                      y={k === "max" ? p.y - 5 : p.y + 12}
                      textAnchor="middle"
                      className={`fh-vlabel tone-${c}`}
                    >
                      {p.v}
                    </text>
                  ) : null;
                })}
              </g>
            );
          }),
        )}
        {/* 目盛り：発表の時刻（時）と日付 */}
        {times.map((t, k) => {
          const date = t.slice(0, 10);
          const prev = times[k - 1];
          const newDay = !prev || prev.slice(0, 10) !== date;
          return (
            <g key={`t${t}`}>
              {newDay && prev && (
                <line
                  x1={xi(t)}
                  x2={xi(t)}
                  y1={CELL_TOP - 2}
                  y2={height - 2}
                  className="fh-dayline"
                />
              )}
              {axis === "clock" && (
                <Clock cx={xi(t) + step / 2} cy={AX + 9} hour={hourOf(t)} />
              )}
              {newDay &&
                (() => {
                  // その日の発表の列の真ん中に日付（最初の日だけ月を書く。対象日は「当日」）
                  const last = times
                    .filter((z) => z.slice(0, 10) === date)
                    .at(-1)!;
                  const cx = (xi(t) + xEnd(last)) / 2;
                  const label =
                    date === day
                      ? "当日"
                      : k === 0
                        ? md(date)
                        : `${Number(date.slice(8, 10))}日`;
                  return (
                    <text
                      x={cx}
                      y={height - 4}
                      textAnchor="middle"
                      className={`fh-tick${date === day ? " fh-today-label" : " quiet"}`}
                    >
                      {label}
                    </text>
                  );
                })()}
            </g>
          );
        })}
        <rect
          x={PAD_L}
          y={0}
          width={SPAN}
          height={AX}
          className="fh-hit fh-one-hit"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => {
            clear();
            if (scrubbing.current) onScrub(null, "end");
            scrubbing.current = false;
          }}
        />
      </svg>
      <div className="fh-one-legend">
        <span>
          <i className="fh-step-swatch" style={{ background: cell(20) }} />
          <i className="fh-step-swatch" style={{ background: cell(50) }} />
          <i className="fh-step-swatch" style={{ background: cell(90) }} />
          降水確率
        </span>
        <span>
          <i className="fh-box one" />
          1日全体（週間）
        </span>
        <span>
          <i className="fh-box four" />
          6時間ごと（府県）
        </span>
        <span>
          <i className="fh-step-swatch band" />
          予測範囲
        </span>
        <span>
          <svg width="26" height="10" aria-hidden="true">
            <path
              d="M1,7 L12,7 L12,3 L25,3"
              fill="none"
              stroke={quiet("hot")}
              strokeWidth="2"
            />
          </svg>
          週間
        </span>
        <span>
          <svg width="26" height="10" aria-hidden="true">
            <path
              d="M1,7 L12,7 L12,3 L25,3"
              fill="none"
              stroke="var(--data-hot)"
              strokeWidth="2"
            />
          </svg>
          府県
        </span>
      </div>
    </div>
  );
}

/**
 * 時計の絵：短い針で時刻（12時間の文字盤）。午前は白い文字盤、午後は塗った文字盤（5時と17時を見分ける）。
 */
function Clock({ cx, cy, hour }: { cx: number; cy: number; hour: number }) {
  const r = 5;
  const a = ((hour % 12) / 12) * 2 * Math.PI;
  const pm = hour >= 12;
  return (
    <g className={`fh-clock${pm ? " pm" : ""}`} aria-label={`${hour}時`}>
      <circle cx={cx} cy={cy} r={r} />
      <line
        x1={cx}
        y1={cy}
        x2={cx + Math.sin(a) * (r - 1.6)}
        y2={cy - Math.cos(a) * (r - 1.6)}
      />
    </g>
  );
}
