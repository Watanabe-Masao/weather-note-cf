// その夜の月（日食なら太陽）の通り道（2026-11-20 渡辺さん「ここの工夫」）：イベントの説明の下半分を、文字の並びから
// 一枚の夜空の絵にする。空を南から見上げた形：横は方角（左が東、真ん中が南、右が西）、縦は高さ。地平線の上の通り道を、
// その時間の天気で描き分ける（晴れ間は光る実線、雲で見えにくい時間は点線、天気の分からない時間は淡い線）。
// 3時間ごとに時刻の点、満月の瞬間・食のいちばん深い時刻に光る点。食の間は太く。出と入り（食は始めと終わり）は呼ぶ側の
// 計算（大気差を入れた出入り）を両端に添える。天気は高知の観測所の記録・予報（shared/dayWeather.ts skyHidden）。
import { type CSSProperties, useMemo, useRef } from "react";
import { addDays } from "../../shared/dates";
import { clockOf } from "../../shared/dayParts";
import { skyHidden } from "../../shared/dayWeather";
import { moonTopo } from "../../shared/moon";
import type { SkyEvent } from "../../shared/skyEvents";
import { solarAltitude, solarAzimuth } from "../../shared/sunTimes";
import type { WeatherRow } from "../../shared/types";
import { svgTextSize, useDrawnWidth } from "./useDrawnWidth";

const W = 340;
const H = 150;
const PAD = { left: 14, right: 14, top: 24, bottom: 24 };
/** 横に描く方角の幅（北東 45° 〜 北西 315°）。 */
const AZ = { from: 45, to: 315 } as const;
const STEP_MIN = 10;
/** 両端の札のまわりで、時刻の文字を出さない幅（描く単位）。 */
const END_CLEAR = 46;
const HOUR_MS = 3_600_000;
const jstMin = (ms: number) => {
  const d = new Date(ms + 9 * HOUR_MS);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
};

type Look = "clear" | "cloud" | "unknown";

export interface PathWeather {
  /** その日と翌日の毎時の記録・予報（日付ごと）。 */
  rows: Record<string, WeatherRow[]>;
  station: string;
}

/** 両端の札（出と入り、食は始めと終わり）：時刻の文字。 */
export interface PathEnds {
  from: string | null;
  to: string | null;
}

export function EventPath({ event, date, lat, lon, weather, ends }: { event: SkyEvent; date: string; lat: number; lon: number; weather: PathWeather; ends: PathEnds }) {
  const solar = event.kind.startsWith("solar");
  // 見る窓：満月・月食は その日の12時〜翌日の12時、日食は その日の4時〜21時。
  const t0 = Date.parse(`${date}T${solar ? "04" : "12"}:00:00+09:00`);
  const t1 = t0 + (solar ? 17 : 24) * HOUR_MS;
  const posAt = (t: number) => {
    if (!solar) {
      const m = moonTopo(t, lat, lon);
      return { alt: m.altitude, az: m.azimuth };
    }
    const j = jstMin(t);
    return { alt: solarAltitude(j.date, j.min, lat, lon), az: solarAzimuth(j.date, j.min, lat, lon) };
  };
  const pts = useMemo(() => {
    const out: { t: number; alt: number; az: number }[] = [];
    for (let t = t0; t <= t1; t += STEP_MIN * 60_000) out.push({ t, ...posAt(t) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t0, t1, solar, lat, lon]);
  // 夜（昼）に出ている一続きの間：瞬間を含む間、無ければいちばん長い間。
  const arc = useMemo(() => {
    const runs: (typeof pts)[] = [];
    let cur: typeof pts | null = null;
    for (const p of pts) {
      if (p.alt >= 0) {
        if (!cur) runs.push((cur = []));
        cur.push(p);
      } else cur = null;
    }
    return runs.find((r) => r[0].t <= event.at && r.at(-1)!.t >= event.at) ?? runs.sort((a, b) => b.length - a.length)[0] ?? [];
  }, [pts, event.at]);
  const lookOf = (t: number): Look => {
    const j = jstMin(t);
    const rows = weather.rows[j.date];
    if (!rows?.length) return "unknown";
    const s = skyHidden(rows, Math.floor(j.min / 60) + 1, weather.station);
    return !s ? "unknown" : s.hidden ? "cloud" : "clear";
  };
  const top = Math.max(30, ...arc.map((p) => p.alt));
  const x = (az: number) => PAD.left + ((Math.min(AZ.to, Math.max(AZ.from, az)) - AZ.from) / (AZ.to - AZ.from)) * (W - PAD.left - PAD.right);
  const y = (alt: number) => H - PAD.bottom - (Math.max(0, alt) / top) * (H - PAD.top - PAD.bottom);
  const segs = useMemo(() => {
    const out: { look: Look; d: string; inSpan: boolean }[] = [];
    let cur: { look: Look; d: string; inSpan: boolean } | null = null;
    for (let i = 0; i < arc.length - 1; i++) {
      const a = arc[i];
      const b = arc[i + 1];
      const look = lookOf(a.t);
      const inSpan = !!event.span && a.t >= event.span.from && a.t <= event.span.to;
      if (!cur || cur.look !== look || cur.inSpan !== inSpan) {
        cur = { look, inSpan, d: `M${x(a.az).toFixed(1)},${y(a.alt).toFixed(1)}` };
        out.push(cur);
      }
      cur.d += ` L${x(b.az).toFixed(1)},${y(b.alt).toFixed(1)}`;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arc, weather, event.span]);
  // 3時間ごとの時刻の点（地平線の上だけ）。
  // 両端の札（出・入り）と重なる所は、時刻の文字を出さない（点だけ）。
  const endX = [arc[0], arc.at(-1)].filter(Boolean).map((p) => x(p!.az));
  const marks = arc.filter((p) => jstMin(p.t).min % 180 === 0).map((p) => ({ ...p, text: endX.every((ex) => Math.abs(ex - x(p.az)) > END_CLEAR) && Math.abs(p.t - event.at) > 90 * 60_000 }));
  const peak = posAt(event.at);
  const showPeak = peak.alt >= 0;
  const svg = useRef<SVGSVGElement>(null);
  const fs = svgTextSize("xs", W, useDrawnWidth(svg));
  const label = solar ? "日食の最大" : event.kind === "full" ? "満月" : "いちばん深い";
  const first = arc[0];
  const last = arc.at(-1);
  const ground = H - PAD.bottom;
  // 両端の札（出・入り）は地平線のすぐ上に置く。通り道は端から斜めに昇るので、札の高さを抜けるまでの横の距離だけ内側へ
  // ずらし、線と字が重ならないようにする（11/23 渡辺さん、iPhone で「16:10 出」「翌7:22 入」が線に重なっていた）。
  const clearOf = (run: typeof arc) => {
    const p0 = run[0];
    if (!p0) return 0;
    const hit = run.find((p) => ground - y(p.alt) >= fs + 6);
    return hit ? Math.abs(x(hit.az) - x(p0.az)) + 2 : 0;
  };
  const fromX = first ? Math.max(PAD.left, x(first.az)) + clearOf(arc) : 0;
  const toX = last ? Math.min(W - PAD.right, x(last.az)) - clearOf([...arc].reverse()) : 0;
  return (
    <svg ref={svg} className="event-path" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${solar ? "太陽" : "月"}の通り道（南を向いて見上げた空。左が東、右が西）。光る実線は晴れ間、点線は雲で見えにくい時間`}>
      {/* 地平線 */}
      <line className="event-path-ground" x1={PAD.left} x2={W - PAD.right} y1={ground} y2={ground} />
      {[
        [90, "東"],
        [180, "南"],
        [270, "西"],
      ].map(([az, name]) => (
        <text key={name} x={x(az as number)} y={ground + 4 + fs} textAnchor="middle" fontSize={fs} className="event-path-label">
          {name}
        </text>
      ))}
      {/* 通り道（見え方で描き分け） */}
      {segs.map((s, i) => (
        <path key={i} d={s.d} className={`event-path-line ${s.look}${s.inSpan ? " span" : ""}`} />
      ))}
      {/* 3時間ごとの時刻 */}
      {marks.map((p) => (
        <g key={p.t}>
          <circle cx={x(p.az)} cy={y(p.alt)} r={2} className="event-path-mark" />
          {p.text && (
            <text x={x(p.az)} y={y(p.alt) + fs + 3} textAnchor="middle" fontSize={fs} className="event-path-label">
              {Math.floor(jstMin(p.t).min / 60)}時
            </text>
          )}
        </g>
      ))}
      {/* 両端：出と入り（食は始めと終わり） */}
      {first && ends.from && (
        <text x={fromX} y={ground - 5} textAnchor="start" fontSize={fs} className="event-path-label strong">
          {ends.from}
        </text>
      )}
      {last && ends.to && (
        <text x={toX} y={ground - 5} textAnchor="end" fontSize={fs} className="event-path-label strong">
          {ends.to}
        </text>
      )}
      {/* 瞬間 */}
      {showPeak && (
        <g className="event-path-peak" style={{ "--px": `${x(peak.az)}px` } as CSSProperties}>
          <circle cx={x(peak.az)} cy={y(peak.alt)} r={10} className="halo" />
          <circle cx={x(peak.az)} cy={y(peak.alt)} r={4.5} className="dot" />
          <text x={x(peak.az)} y={Math.max(fs, y(peak.alt) - 13)} textAnchor={x(peak.az) > W - 70 ? "end" : x(peak.az) < 70 ? "start" : "middle"} fontSize={fs} className="event-path-label strong">
            {label} {clockOf(jstMin(event.at).min)}
          </text>
        </g>
      )}
    </svg>
  );
}

/** 通り道の天気に使う日：その日と翌日。 */
export function pathDays(date: string): string[] {
  return [date, addDays(date, 1)];
}
