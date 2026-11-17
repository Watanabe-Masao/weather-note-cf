// 予報の履歴 R6 の見本：週間と府県天気予報を「1枚のグラフ」に（渡辺さんの指示、2026-11-17）。
// 2つの描き分け（AB）：
//   tone … 週間を一段落ち着いた色、府県天気予報をはっきりした色。点は 週間 ○／府県 ●
//   dash … 週間を破線、府県天気予報を実線。点は同じ
// 1本につなぐ（渡辺さん、2026-11-17）。ただし週間→府県天気予報のつなぎ目は細い点線にする（降水確率は
// 1日と6時間で区切りが違い、気温も「最高・最低」と「日中の最高・朝の最低」で別の値のため）。長押し（0.28秒）で補助線を出し、そのまま横になぞると、
// 指の下の発表が上の文に出る（アプリの日別グラフと同じ操作。ただのスワイプは日送りに使うため）。

import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Chip } from "../../../src/ui/kit";
import { lineLook, DATA } from "../../../src/design/tokens";
import { hourOf, KIND_SHORT, type Kind, leadLabel, md, type Slot, STATE_TEXT } from "./model";
import { vNum, Wx } from "./Transition";

export type OneMode = "tone" | "dash";

const W = 300;
const PAD_L = 26;
const PAD_R = 8;
const POP6_NAME = ["0〜6時", "6〜12時", "12〜18時", "18〜24時"];
const HOLD_MS = 280;

/** 週間の線の色（tone のとき）：同じ色相で一段落ち着かせる。透明度ではなく面の色と混ぜる（見本だけの仮の値）。 */
const quiet = (c: string) => `color-mix(in srgb, var(--data-${c}) 55%, var(--surface-raised))`;

export function OneChart({
  slots,
  day,
  mode,
  focus,
  onScrub,
  onSelect,
}: {
  slots: Slot[];
  day: string;
  mode: OneMode;
  focus: string | null;
  onScrub: (key: string | null, phase: "move" | "end") => void;
  onSelect: (key: string) => void;
}) {
  const [pop6, setPop6] = useState(2);
  const timer = useRef<number | null>(null);
  const scrubbing = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  if (!slots.length) return null;
  const t0 = Date.parse(slots[0].at);
  const t1 = Date.parse(`${day}T18:00:00+09:00`);
  const x = (iso: string) => PAD_L + ((Date.parse(iso) - t0) / (t1 - t0)) * (W - PAD_L - PAD_R);
  const temps = slots.flatMap((s) => [vNum(s.values?.max), vNum(s.values?.min)]).filter((v): v is number => v != null);
  const lo = temps.length ? Math.floor(Math.min(...temps) / 5) * 5 : 0;
  const hi = temps.length ? Math.ceil(Math.max(...temps) / 5) * 5 : 30;
  const ICON_Y = 22;
  const POP_TOP = 38;
  const POP_H = 30;
  const T_TOP = POP_TOP + POP_H + 18;
  const T_H = 92;
  const H_AXIS = 30;
  const height = T_TOP + T_H + 8 + H_AXIS;
  const ty = (v: number) => T_TOP + T_H - ((v - lo) / (hi - lo || 1)) * T_H;
  const py = (v: number) => POP_TOP + POP_H - (v / 100) * POP_H;
  const days: string[] = [];
  for (let t = t0; t <= t1; t += 86_400_000) days.push(new Date(t + 9 * 3_600_000).toISOString().slice(0, 10));
  const width = (c: "hot" | "cold" | "rain") => lineLook("target", DATA[c], c === "rain" ? { weight: "minor" } : {}).strokeWidth;
  const firstFd = slots.find((s) => s.kind === "VPFD51");

  // 1本につなぐ：府県天気予報が始まるまでは週間、そこからは府県天気予報。週間のうち、府県天気予報が始まった
  // あとの回は、線にせず ○ だけ置く（同じ時刻に2つの値があると線が行き来するため）。
  // 切り替える所は値ごとに決める：府県天気予報で、その値が最初に出た回（明後日の分は降水確率・気温がない）。
  type Pt = { x: number; y: number; s: Slot; v: number };
  const lineOf = (get: (s: Slot) => number | null, y: (v: number) => number) => {
    const firstFdValue = slots.find((s) => s.kind === "VPFD51" && s.state === "ok" && get(s) != null);
    const switchAt = firstFdValue ? Date.parse(firstFdValue.at) : Infinity;
    const used = slots.filter((s) => (s.kind === "VPFW50" ? Date.parse(s.at) < switchAt : Date.parse(s.at) >= switchAt));
    const late = slots.filter((s) => s.kind === "VPFW50" && Date.parse(s.at) >= switchAt);
    const runs: Pt[][] = [];
    let cur: Pt[] = [];
    for (const s of used) {
      const v = s.state === "ok" ? get(s) : null;
      if (v == null) {
        if (cur.length) runs.push(cur);
        cur = [];
        continue;
      }
      cur.push({ x: x(s.at), y: y(v), s, v });
    }
    if (cur.length) runs.push(cur);
    const dots = late.flatMap((s) => {
      const v = s.state === "ok" ? get(s) : null;
      return v == null ? [] : [{ x: x(s.at), y: y(v), s, v }];
    });
    return { runs, dots };
  };
  const popOf = (s: Slot) => (s.kind === "VPFW50" ? vNum(s.values?.popDay) : vNum(s.values?.pop6?.[pop6]));
  const lines = [
    { key: "pop", c: "rain" as const, ...lineOf(popOf, py), changedKey: (s: Slot) => (s.kind === "VPFW50" ? "pop" : `pop6-${pop6}`), above: true },
    { key: "max", c: "hot" as const, ...lineOf((s) => vNum(s.values?.max), ty), changedKey: () => "max", above: true },
    { key: "min", c: "cold" as const, ...lineOf((s) => vNum(s.values?.min), ty), changedKey: () => "min", above: false },
  ];
  const strokeOf = (kind: Kind, c: string) => (kind === "VPFW50" && mode === "tone" ? quiet(c) : `var(--data-${c})`);
  const seg = (a: Pt, b: Pt) => `M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`;

  const nearest = (clientX: number) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const px = (clientX - m.e) / m.a;
    return slots.reduce((a, b) => (Math.abs(x(b.at) - px) < Math.abs(x(a.at) - px) ? b : a));
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
        /* ポインタがもう離れている */
      }
      const s = nearest(cx);
      if (s) onScrub(s.key, "move");
    }, HOLD_MS);
  };
  const move = (ev: RPointerEvent<SVGRectElement>) => {
    if (!scrubbing.current) return;
    ev.preventDefault();
    const s = nearest(ev.clientX);
    if (s) onScrub(s.key, "move");
  };
  const up = (ev: RPointerEvent<SVGRectElement>) => {
    const wasScrub = scrubbing.current;
    clear();
    scrubbing.current = false;
    if (wasScrub) {
      const s = nearest(ev.clientX);
      onScrub(s?.key ?? null, "end");
    } else {
      // 短く押しただけ：その発表を選ぶ（出どころが下に出る）。
      const s = nearest(ev.clientX);
      if (s) onSelect(s.key);
    }
  };
  const focusSlot = slots.find((s) => s.key === focus) ?? null;

  return (
    <div className={`fh-chart fh-one ${mode}`}>
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label="発表ごとの予報の移り変わり（1枚のグラフ）"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* 軸 */}
        {[lo, hi].map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={ty(v)} y2={ty(v)} className="fh-grid" />
            <text x={PAD_L - 4} y={ty(v) + 3.5} className="fh-tick" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <line x1={PAD_L} x2={W - PAD_R} y1={POP_TOP + POP_H} y2={POP_TOP + POP_H} className="fh-grid" />
        <text x={PAD_L - 4} y={POP_TOP + POP_H} className="fh-tick" textAnchor="end">
          %
        </text>
        {/* 週間 → 府県天気予報 の切り替わり */}
        {firstFd && (
          <g className="fh-one-switch">
            <line x1={x(firstFd.at) - 6} x2={x(firstFd.at) - 6} y1={4} y2={height - H_AXIS + 4} />
            <text x={x(firstFd.at) - 3} y={10} className="fh-tick">
              府県
            </text>
          </g>
        )}
        {/* 取れなかった・記録なしなどの回 */}
        {slots
          .filter((s) => s.state !== "ok")
          .map((s) => (
            <rect key={`g${s.key}`} x={x(s.at) - 4} y={POP_TOP - 4} width={8} height={T_TOP + T_H - POP_TOP + 8} rx={2} className={`fh-one-gap ${s.state}`} />
          ))}
        {/* 指の下の発表 */}
        {focusSlot && <line x1={x(focusSlot.at)} x2={x(focusSlot.at)} y1={8} y2={T_TOP + T_H + 4} className="fh-one-cursor" />}
        {/* 天気の絵（線で結ばない） */}
        {slots.map((s) =>
          s.state === "ok" && s.values ? (
            <foreignObject key={`w${s.key}`} x={x(s.at) - 7} y={ICON_Y - 7} width={14} height={14} className={s.kind === "VPFW50" ? "fh-one-wk" : ""}>
              <Wx s={s} size={14} />
            </foreignObject>
          ) : null,
        )}
        {/* 値の線：1本につなぐ。週間の区間・府県天気予報の区間で描き分け、つなぎ目（週間→府県）は細い点線。 */}
        {lines.map((l) => (
          <g key={l.key}>
            {l.runs.map((r, i) =>
              r.slice(1).map((p, j) => {
                const a = r[j];
                const bridge = a.s.kind !== p.s.kind;
                const kind = bridge ? "VPFD51" : p.s.kind;
                return (
                  <path
                    key={`${i}-${j}`}
                    d={seg(a, p)}
                    fill="none"
                    stroke={strokeOf(kind, l.c)}
                    strokeWidth={bridge ? 1.2 : width(l.c)}
                    strokeDasharray={bridge ? "1 3" : p.s.kind === "VPFW50" && mode === "dash" ? "4 3" : undefined}
                    strokeLinecap="round"
                    className={bridge ? "fh-one-bridge" : undefined}
                  />
                );
              }),
            )}
            {[...l.runs.flat(), ...l.dots].map((p) => {
              const weekly = p.s.kind === "VPFW50";
              const isLate = l.dots.includes(p);
              const stroke = isLate ? quiet(l.c) : strokeOf(p.s.kind, l.c);
              const changed = !isLate && p.s.changed.has(l.changedKey(p.s));
              const on = focus === p.s.key;
              return (
                <g key={`${l.key}${p.s.key}`}>
                  <circle cx={p.x} cy={p.y} r={on ? 3.4 : changed ? 2.8 : isLate ? 1.8 : 2} fill={weekly ? "var(--surface-raised)" : stroke} stroke={stroke} strokeWidth={weekly ? 1.2 : 0} />
                  {(changed || on) && (
                    <text x={p.x} y={l.above ? p.y - 5 : p.y + 11} textAnchor="middle" className={`fh-vlabel tone-${l.c}`}>
                      {p.v}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
        {/* 日付 */}
        {days.map((d) => {
          const xd = x(`${d}T00:00:00+09:00`);
          if (xd < PAD_L - 1) return null;
          const lead = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
          return (
            <g key={d}>
              <line x1={xd} x2={xd} y1={T_TOP + T_H + 4} y2={height - H_AXIS + 4} className="fh-dayline" />
              <text x={xd + 2} y={height - H_AXIS + 14} className="fh-tick">
                {md(d)}
              </text>
              <text x={xd + 2} y={height - H_AXIS + 26} className="fh-tick quiet">
                {leadLabel(lead)}
              </text>
            </g>
          );
        })}
        {/* 押す・長押しでなぞる所（グラフ全体） */}
        <rect
          x={PAD_L - 6}
          y={0}
          width={W - PAD_L - PAD_R + 12}
          height={T_TOP + T_H + 8}
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
          <svg width="26" height="10" aria-hidden="true">
            <line x1="1" x2="25" y1="5" y2="5" stroke={mode === "tone" ? quiet("hot") : "var(--data-hot)"} strokeWidth="2" strokeDasharray={mode === "dash" ? "4 3" : undefined} />
            <circle cx="13" cy="5" r="2.6" fill="var(--surface-raised)" stroke={mode === "tone" ? quiet("hot") : "var(--data-hot)"} strokeWidth="1.2" />
          </svg>
          週間（降水は1日）
        </span>
        <span>
          <svg width="26" height="10" aria-hidden="true">
            <line x1="1" x2="25" y1="5" y2="5" stroke="var(--data-hot)" strokeWidth="2" />
            <circle cx="13" cy="5" r="2.6" fill="var(--data-hot)" />
          </svg>
          府県天気予報（降水は{POP6_NAME[pop6]}）
        </span>
      </div>
      <div className="chip-row fh-pop6">
        <small className="fh-lbl">府県の降水（6時間）</small>
        {POP6_NAME.map((n, i) => (
          <Chip key={n} size="sm" on={pop6 === i} onClick={() => setPop6(i)}>
            {n}
          </Chip>
        ))}
      </div>
      <p className="fh-note">押すと、その発表を選びます。長押しして横になぞると、指の下の発表が上の文に出ます。</p>
    </div>
  );
}

/** 上の文（赤の枠）：指の下・選んだ発表の中身と、1つ前の同じ種類の発表からの変化。 */
export function FocusSay({ s, slots }: { s: Slot; slots: Slot[] }) {
  const head = `${leadLabel(s.lead)}（${md(s.at.slice(0, 10))} ${hourOf(s.at)}時の${KIND_SHORT[s.kind]}）`;
  if (s.state !== "ok" || !s.values) {
    return (
      <div className="fh-focus">
        <p className="fh-focus-head">{head}</p>
        <p>{STATE_TEXT[s.state]}</p>
      </div>
    );
  }
  const v = s.values;
  const num = (x: { s: string; v?: unknown } | null | undefined, unit: string) => (x && x.s === "value" ? `${x.v}${unit}` : "—");
  const name = v.weather.s === "value" ? ((v.weather as { name?: string }).name ?? "—") : "—";
  const pop =
    s.kind === "VPFW50"
      ? `降水確率 ${num(v.popDay, "%")}`
      : `降水確率 ${v.pop6!.map((p, i) => (p === null ? null : `${POP6_NAME[i]} ${num(p, "%")}`)).filter(Boolean).join("・")}`;
  const temp = s.kind === "VPFW50" ? `最高 ${num(v.max, "℃")}・最低 ${num(v.min, "℃")}` : `日中の最高 ${num(v.max, "℃")}・朝の最低 ${num(v.min, "℃")}`;
  const i = slots.indexOf(s);
  const prev = slots.slice(0, i).reverse().find((p) => p.kind === s.kind && p.state === "ok");
  const change =
    s.lead === 0
      ? "当日の発表は途中からの値なので、前の発表とは比べない"
      : !prev
        ? "この日を予報した最初の発表"
        : s.changed.size === 0
          ? `前の発表（${md(prev.at.slice(0, 10))} ${hourOf(prev.at)}時）から変わらなかった`
          : `前の発表（${md(prev.at.slice(0, 10))} ${hourOf(prev.at)}時）から変わった：${[...s.changed].map((k) => (k === "weather" ? "天気" : k === "max" ? "最高" : k === "min" ? "最低" : "降水確率")).filter((x, j, a) => a.indexOf(x) === j).join("・")}`;
  return (
    <div className="fh-focus">
      <p className="fh-focus-head">{head}</p>
      <p>
        <b>{name}</b>、{pop}、{temp}
      </p>
      <p className="fh-focus-change">{change}</p>
    </div>
  );
}
