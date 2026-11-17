// 2段のグラフで横軸を共有する（design-system 4.1）：上は地点の雨の強さ（5分ごと、mm/h）、下は1時間の降水量（mm）。
// 値は画像の色から読んだ段（RAIN_LEVELS）なので、縦は段の目盛り（1・5・10・20・30・50・80）で、等間隔ではない。
// 「今」の線・予測の網かけ・選んだ時刻は上下を通して1本、時刻の目盛りは下に1組。データの無い所は「なし」、
// 取れなかった所は破線の枠（下の段は「×」も）、雨なしは空白、予測は灰の網かけ。
import { useRef, type PointerEvent as RPE } from "react";
import { levelHex, type RainFrame } from "../../../shared/rainNow";
import { ForecastHatch } from "../kit";
import { clockOf, frameKey, type Level } from "./rainNowData";

const W = 330;
const PAD_L = 26;
const PAD_R = 8;
export const SPANS = { "6": { from: -180, to: 180, tick: 60 }, "12": { from: -240, to: 480, tick: 120 }, "24": { from: -360, to: 1080, tick: 180 } } as const;
export type Span = keyof typeof SPANS;
/** 縦の目盛り：段の境目（段 i の上の端）。 */
const LEVEL_TICKS = [
  { at: 1, label: "1" },
  { at: 3, label: "10" },
  { at: 5, label: "30" },
  { at: 8, label: "80" },
];

export function RainNowGraph({
  now,
  m,
  span,
  onPick,
  frames,
  hours,
  levels,
}: {
  now: string;
  m: number;
  span: Span;
  onPick: (m: number) => void;
  frames: RainFrame[];
  hours: RainFrame[];
  levels: Map<string, Level>;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const { from, to, tick } = SPANS[span];
  const x = (t: number) => PAD_L + ((t - from) / (to - from)) * (W - PAD_L - PAD_R);
  const R1 = { top: 16, base: 92 };
  const R2 = { top: 116, base: 182 };
  const H = 214;
  // 段 l（0〜7）の棒の高さ：段の数で（l+1）/8
  const y1 = (l: number) => R1.base - ((l + 1) / 8) * (R1.base - R1.top);
  const y2 = (l: number) => R2.base - ((l + 1) / 8) * (R2.base - R2.top);
  const inView = (t0: number, t1: number) => t1 > from && t0 < to;
  const cx = (t: number) => Math.max(PAD_L, Math.min(W - PAD_R, x(t)));
  const five = frames.filter((f) => f.kind !== "hourly");
  const lastFrame = frames.at(-1)?.m ?? 0;
  const pick = (e: RPE<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = from + ((px - PAD_L) / (W - PAD_L - PAD_R)) * (to - from);
    // 地図のこまのいちばん近いものへ（1時間の量のこまは、その1時間の中なら）
    const hit = frames.find((f) => f.kind === "hourly" && t > f.m - 60 && t <= f.m);
    const near = five.reduce<RainFrame | null>((a, f) => (a == null || Math.abs(f.m - t) < Math.abs(a.m - t) ? f : a), null);
    const choice = hit ?? (near && Math.abs(near.m - t) <= 5 ? near : null) ?? (t > lastFrame ? frames.at(-1) : near);
    if (choice) onPick(choice.m);
  };
  const sel = frames.find((f) => f.m === m);
  // 下の段で囲む1時間：1時間の量のこまならその1時間、5分のこまならその時刻を含む1時間
  const hh = sel?.kind === "hourly" ? sel : hours.find((h) => m > h.m - 60 && m <= h.m);
  const selHour = hh ? { a: hh.m - 60, b: hh.m } : null;
  const ticks: number[] = [];
  for (let t = Math.ceil(from / tick) * tick; t <= to; t += tick) ticks.push(t);
  const fiveFrom = five[0]?.m ?? 0;
  const fiveTo = (five.at(-1)?.m ?? 0) + 5;
  const hourFrom = hours.length ? hours[0].m - 60 : 0;
  const hourTo = hours.at(-1)?.m ?? 0;
  const none = (a: number, b: number, r: { top: number; base: number }) =>
    from < b && a < to && cx(b) - cx(a) > 24 ? (
      <text x={(cx(a) + cx(b)) / 2} y={(r.top + r.base) / 2 + 4} textAnchor="middle" className="rn-none">
        なし
      </text>
    ) : null;
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="rn-graph"
      role="img"
      aria-label="地点の雨：強さ（5分ごと）と1時間の降水量。横の時刻は上下で共通"
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), pick(e))}
      onPointerMove={(e) => e.buttons && pick(e)}
    >
      <defs>
        <ForecastHatch id="rn-fc" />
      </defs>
      {[R1, R2].map((r, k) => (
        <rect key={k} x={x(0)} y={r.top} width={W - PAD_R - x(0)} height={r.base - r.top} fill="url(#rn-fc)" />
      ))}
      {ticks.map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={R1.top} y2={R2.base} className="rn-grid" />
      ))}
      <text x={PAD_L} y={R1.top - 5} className="rn-row">
        雨の強さ mm/h（5分ごと）
      </text>
      <text x={PAD_L} y={R2.top - 5} className="rn-row">
        1時間の降水量 mm
      </text>
      {LEVEL_TICKS.map((v) => (
        <text key={`a${v.at}`} x={PAD_L - 4} y={y1(v.at - 1) + 4} textAnchor="end" className="rn-tick">
          {v.label}
        </text>
      ))}
      {LEVEL_TICKS.filter((v) => v.at !== 3).map((v) => (
        <text key={`b${v.at}`} x={PAD_L - 4} y={y2(v.at - 1) + 4} textAnchor="end" className="rn-tick">
          {v.label}
        </text>
      ))}
      <line x1={PAD_L} x2={W - PAD_R} y1={R1.base} y2={R1.base} className="rn-axis" />
      <line x1={PAD_L} x2={W - PAD_R} y1={R2.base} y2={R2.base} className="rn-axis" />
      {/* 上：5分ごとの強さ（そのこまの5分の幅） */}
      {five.map((f) => {
        if (!inView(f.m, f.m + 5)) return null;
        const l = levels.get(frameKey(f));
        const x0 = cx(f.m) + 0.3;
        const w = Math.max(0.6, cx(f.m + 5) - cx(f.m) - 0.6);
        if (l === "missing" || l === "unread") return <rect key={f.m} x={x0} y={R1.top} width={w} height={R1.base - R1.top} className="rn-missbox" />;
        if (typeof l !== "number" || l < 0) return null;
        return <rect key={f.m} x={x0} y={y1(l)} width={w} height={R1.base - y1(l)} style={{ fill: levelHex(l) }} />;
      })}
      {five.length ? (
        <>
          {none(from, fiveFrom, R1)}
          {none(fiveTo, to, R1)}
        </>
      ) : (
        none(from, to, R1)
      )}
      {/* 下：1時間の降水量（その1時間の幅）。これまでは解析雨量、これからは今後の雨 */}
      {hours.map((f) => {
        const t0 = f.m - 60;
        if (!inView(t0, f.m)) return null;
        const l = levels.get(frameKey(f));
        if (l === "missing" || l === "unread")
          return (
            <g key={`${f.m}${f.basetime}`}>
              <rect x={cx(t0) + 0.5} y={R2.top} width={cx(f.m) - cx(t0) - 1} height={R2.base - R2.top} className="rn-missbox" />
              <text x={(cx(t0) + cx(f.m)) / 2} y={R2.base - 4} textAnchor="middle" className="rn-none">
                ×
              </text>
            </g>
          );
        if (typeof l !== "number" || l < 0) return null;
        return <rect key={`${f.m}${f.basetime}`} x={cx(t0) + 0.5} y={y2(l)} width={cx(f.m) - cx(t0) - 1} height={R2.base - y2(l)} style={{ fill: levelHex(l) }} />;
      })}
      {hours.length ? (
        <>
          {none(from, hourFrom, R2)}
          {none(hourTo, to, R2)}
        </>
      ) : (
        none(from, to, R2)
      )}
      {sel && sel.kind !== "hourly" && inView(m, m + 5) && <rect x={cx(m)} y={R1.top} width={Math.max(2, cx(m + 5) - cx(m))} height={R1.base - R1.top} className="rn-sel" />}
      {selHour && inView(selHour.a, selHour.b) && <rect x={cx(selHour.a)} y={R2.top} width={cx(selHour.b) - cx(selHour.a)} height={R2.base - R2.top} className="rn-sel" />}
      <line x1={x(0)} x2={x(0)} y1={R1.top - 2} y2={R2.base + 2} className="rn-now" />
      {ticks
        .filter((t) => t > from && t < to)
        .map((t) => (
          <text key={t} x={x(t)} y={R2.base + 15} textAnchor="middle" className={`rn-tick${t === 0 ? " now" : ""}`}>
            {t === 0 ? "今" : clockOf(now, t)}
          </text>
        ))}
      <text x={(PAD_L + x(0)) / 2} y={H - 2} textAnchor="middle" className="rn-tick">
        これまで
      </text>
      <text x={(x(0) + W - PAD_R) / 2} y={H - 2} textAnchor="middle" className="rn-tick">
        これから
      </text>
    </svg>
  );
}
