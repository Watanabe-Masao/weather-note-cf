// 予報の履歴 R6 の見本：週間と府県天気予報を「1枚のグラフ」に（渡辺さんの指示、2026-11-17）。
// 2つの描き分け（AB）：
//   tone … 週間を一段落ち着いた色、府県天気予報をはっきりした色。点は 週間 ○／府県 ●
//   dash … 週間を破線、府県天気予報を実線。点は同じ
// 1本につなぐ（渡辺さん、2026-11-17）。ただし週間→府県天気予報のつなぎ目は細い点線にする（降水確率は
// 1日と6時間で区切りが違い、気温も「最高・最低」と「日中の最高・朝の最低」で別の値のため）。長押し（0.28秒）で補助線を出し、そのまま横になぞると、
// 指の下の発表が上の文に出る（アプリの日別グラフと同じ操作。ただのスワイプは日送りに使うため）。

import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { lineLook, DATA } from "../../../src/design/tokens";
import {
  hourOf,
  KIND_SHORT,
  type Kind,
  hasNumbers,
  leadLabel,
  md,
  skyText,
  type Slot,
  STATE_TEXT,
} from "./model";
import { vNum, Wx } from "./Transition";
import { WeatherIcon } from "../../../src/ui/WeatherIcon";

export type OneMode = "tone" | "dash";

const W = 300;
const PAD_L = 26;
const PAD_R = 8;
const HOLD_MS = 280;

/** 週間の線の色（tone のとき）：同じ色相で一段落ち着かせる。透明度ではなく面の色と混ぜる（見本だけの仮の値）。 */
const quiet = (c: string) =>
  `color-mix(in srgb, var(--data-${c}) 55%, var(--surface-raised))`;

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
  const timer = useRef<number | null>(null);
  const scrubbing = useRef(false);
  // なぞっている間に最後に指の下にあった発表（離したときはこれを残す：離す瞬間に広がりが戻って位置がずれるため）
  const lastKey = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // 指でなぞっている所（横の位置、0〜1）。そこを中心にグラフを広げる。
  const [center, setCenter] = useState<number | null>(null);
  if (!slots.length) return null;
  // 範囲は最初の発表から最後の発表まで（その先の空きは描かない）。最後の発表の絵が欠けないよう右に少し余白。
  const SPAN = W - PAD_L - PAD_R - 10;
  // 横の目盛りは「発表の時刻」：発表を等しい間隔で並べる（時刻の長さどおりにしない）。同じ時刻の週間と
  // 府県天気予報は同じ位置。
  const times = [...new Set(slots.map((z) => z.at))].sort(
    (a, b) => Date.parse(a) - Date.parse(b),
  );
  const baseU = (iso: string) =>
    times.length > 1 ? times.indexOf(iso) / (times.length - 1) : 0.5;
  // 動的に広げる：指の下（なぞっていなければ選んだ発表）を中心に、近くほど広く、遠くほど詰めて描く
  // （魚眼。中心の位置は動かないので、指の下の発表がずれない）。中心のあたりは約 (K+1) 倍（2.6 倍）に広がる。
  const K = 1.6;
  const focusSlot0 = slots.find((s) => s.key === focus) ?? null;
  const c = center ?? (focusSlot0 ? baseU(focusSlot0.at) : null);
  const warp = (u: number) => {
    if (c == null) return u;
    if (u >= c) {
      const r = 1 - c || 1;
      const d = (u - c) / r;
      return c + (((K + 1) * d) / (K * d + 1)) * r;
    }
    const r = c || 1;
    const d = (c - u) / r;
    return c - (((K + 1) * d) / (K * d + 1)) * r;
  };
  const unwarp = (w: number) => {
    if (c == null) return w;
    if (w >= c) {
      const r = 1 - c || 1;
      const g = (w - c) / r;
      return c + (g / (K + 1 - K * g)) * r;
    }
    const r = c || 1;
    const g = (c - w) / r;
    return c - (g / (K + 1 - K * g)) * r;
  };
  const x = (iso: string) => PAD_L + warp(baseU(iso)) * SPAN;
  const temps = slots
    .flatMap((s) => [vNum(s.values?.max), vNum(s.values?.min)])
    .filter((v): v is number => v != null);
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
  const width = (c: "hot" | "cold" | "rain") =>
    lineLook("target", DATA[c], c === "rain" ? { weight: "minor" } : {})
      .strokeWidth;
  const firstFd = slots.find((s) => s.kind === "VPFD51");

  // 1本につなぐ：府県天気予報が始まるまでは週間、そこからは府県天気予報。週間のうち、府県天気予報が始まった
  // あとの回は、線にせず ○ だけ置く（同じ時刻に2つの値があると線が行き来するため）。
  // 切り替える所は値ごとに決める：府県天気予報で、その値が最初に出た回（明後日の分は降水確率・気温がない）。
  type Pt = { x: number; y: number; s: Slot; v: number };
  const lineOf = (
    get: (s: Slot) => number | null,
    y: (v: number) => number,
  ) => {
    const firstFdValue = slots.find(
      (s) => s.kind === "VPFD51" && s.state === "ok" && get(s) != null,
    );
    const switchAt = firstFdValue ? Date.parse(firstFdValue.at) : Infinity;
    const used = slots.filter((s) =>
      s.kind === "VPFW50"
        ? Date.parse(s.at) < switchAt
        : Date.parse(s.at) >= switchAt,
    );
    const late = slots.filter(
      (s) => s.kind === "VPFW50" && Date.parse(s.at) >= switchAt,
    );
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
  // 府県天気予報の降水確率は、選ばずに1本にする：その発表の6時間ごとの値のうち最も高いもの。
  // 4つの値は、その発表を押す・なぞると棒で出る。
  const pop6s = (s: Slot) =>
    (s.values?.pop6 ?? [])
      .map((p) => vNum(p))
      .filter((v): v is number => v != null);
  const popOf = (s: Slot) =>
    s.kind === "VPFW50"
      ? vNum(s.values?.popDay)
      : pop6s(s).length
        ? Math.max(...pop6s(s))
        : null;
  const lines = [
    {
      key: "pop",
      c: "rain" as const,
      ...lineOf(popOf, py),
      changedKey: (s: Slot) =>
        s.kind === "VPFW50"
          ? "pop"
          : [0, 1, 2, 3].some((i) => s.changed.has(`pop6-${i}`))
            ? `pop6-${[0, 1, 2, 3].find((i) => s.changed.has(`pop6-${i}`))}`
            : "pop6-none",
      above: true,
    },
    {
      key: "max",
      c: "hot" as const,
      ...lineOf((s) => vNum(s.values?.max), ty),
      changedKey: () => "max",
      above: true,
    },
    {
      key: "min",
      c: "cold" as const,
      ...lineOf((s) => vNum(s.values?.min), ty),
      changedKey: () => "min",
      above: false,
    },
  ];
  const strokeOf = (kind: Kind, c: string) =>
    kind === "VPFW50" && mode === "tone" ? quiet(c) : `var(--data-${c})`;
  const seg = (a: Pt, b: Pt) =>
    `M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`;

  const nearest = (clientX: number) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const px = (clientX - m.e) / m.a;
    const u = Math.min(
      1,
      Math.max(0, unwarp(Math.min(1, Math.max(0, (px - PAD_L) / SPAN)))),
    );
    // 同じ時刻に週間と府県天気予報があるときは、線に乗っている府県天気予報を選ぶ。
    const score = (z: Slot) =>
      Math.abs(baseU(z.at) - u) + (z.kind === "VPFD51" ? 0 : 1e-9);
    return { u, s: slots.reduce((a, b) => (score(b) < score(a) ? b : a)) };
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
      const n = nearest(cx);
      if (n) {
        setCenter(n.u);
        lastKey.current = n.s.key;
        onScrub(n.s.key, "move");
      }
    }, HOLD_MS);
  };
  const move = (ev: RPointerEvent<SVGRectElement>) => {
    if (!scrubbing.current) return;
    ev.preventDefault();
    const n = nearest(ev.clientX);
    if (n) {
      setCenter(n.u);
      lastKey.current = n.s.key;
      onScrub(n.s.key, "move");
    }
  };
  const up = (ev: RPointerEvent<SVGRectElement>) => {
    const wasScrub = scrubbing.current;
    clear();
    scrubbing.current = false;
    const n = nearest(ev.clientX);
    setCenter(null);
    if (wasScrub) onScrub(lastKey.current ?? n?.s.key ?? null, "end");
    // 短く押しただけ：その発表を選ぶ（出どころが下に出る）。
    else if (n) onSelect(n.s.key);
  };
  const focusSlot = slots.find((s) => s.key === focus) ?? null;

  return (
    <div className={`fh-chart fh-one ${mode}`}>
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${height}`}
        className="fh-one-svg"
        role="img"
        aria-label="発表ごとの予報の移り変わり（1枚のグラフ）"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* 軸 */}
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
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={POP_TOP + POP_H}
          y2={POP_TOP + POP_H}
          className="fh-grid"
        />
        <text
          x={PAD_L - 4}
          y={POP_TOP + POP_H}
          className="fh-tick"
          textAnchor="end"
        >
          %
        </text>
        {/* 週間 → 府県天気予報 の切り替わり */}
        {firstFd && (
          <g className="fh-one-switch">
            <line
              x1={x(firstFd.at) - 6}
              x2={x(firstFd.at) - 6}
              y1={4}
              y2={height - H_AXIS + 4}
            />
            <text x={x(firstFd.at) - 3} y={10} className="fh-tick">
              府県
            </text>
          </g>
        )}
        {/* 取れなかった・記録なしなどの回 */}
        {slots
          .filter((s) => s.state !== "ok")
          .map((s) => (
            <rect
              key={`g${s.key}`}
              x={x(s.at) - 4}
              y={POP_TOP - 4}
              width={8}
              height={T_TOP + T_H - POP_TOP + 8}
              rx={2}
              className={`fh-one-gap ${s.state}`}
            />
          ))}
        {/* 指の下の発表 */}
        {focusSlot && (
          <line
            x1={x(focusSlot.at)}
            x2={x(focusSlot.at)}
            y1={8}
            y2={T_TOP + T_H + 4}
            className="fh-one-cursor"
          />
        )}
        {/* 天気の絵（線で結ばない） */}
        {slots.map((s) =>
          s.state === "ok" && s.values ? (
            <foreignObject
              key={`w${s.key}`}
              x={x(s.at) - 7}
              y={ICON_Y - 7}
              width={14}
              height={14}
              className={s.kind === "VPFW50" ? "fh-one-wk" : ""}
            >
              <Wx s={s} size={14} />
            </foreignObject>
          ) : null,
        )}
        {/* 広げた所の府県天気予報：6時間ごとの降水確率を4本の棒で（0〜6・6〜12・12〜18・18〜24時） */}
        {focusSlot0 &&
          focusSlot0.kind === "VPFD51" &&
          focusSlot0.state === "ok" &&
          focusSlot0.values?.pop6 && (
            <g className="fh-one-bars">
              {focusSlot0.values.pop6.map((p, i) => {
                const v = vNum(p);
                const bx = x(focusSlot0.at) + (i - 1.5) * 7 - 2.5;
                return v == null ? (
                  <rect
                    key={i}
                    x={bx}
                    y={POP_TOP + POP_H - 1}
                    width={5}
                    height={1}
                    className="fh-one-bar none"
                  />
                ) : (
                  <rect
                    key={i}
                    x={bx}
                    y={py(v)}
                    width={5}
                    height={Math.max(1, POP_TOP + POP_H - py(v))}
                    rx={1}
                    className="fh-one-bar"
                  />
                );
              })}
            </g>
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
                    strokeDasharray={
                      bridge
                        ? "1 3"
                        : p.s.kind === "VPFW50" && mode === "dash"
                          ? "4 3"
                          : undefined
                    }
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
              const fx = focusSlot ? x(focusSlot.at) : null;
              // 指の下の発表の数字と重なる近くの数字は出さない
              const changed =
                !isLate &&
                p.s.changed.has(l.changedKey(p.s)) &&
                (fx == null || focus === p.s.key || Math.abs(p.x - fx) > 14);
              const on = focus === p.s.key;
              return (
                <g key={`${l.key}${p.s.key}`}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={on ? 3.4 : changed ? 2.8 : isLate ? 1.8 : 2}
                    fill={weekly ? "var(--surface-raised)" : stroke}
                    stroke={stroke}
                    strokeWidth={weekly ? 1.2 : 0}
                  />
                  {(changed || on) && (
                    <text
                      x={p.x}
                      y={l.above ? p.y - 5 : p.y + 11}
                      textAnchor="middle"
                      className={`fh-vlabel tone-${l.c}`}
                    >
                      {p.v}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
        {/* 目盛り：発表の時刻ごと（時）、その下に日付。日が変わる所に区切り線。 */}
        {times.map((t, k) => {
          const xt = x(t);
          const date = t.slice(0, 10);
          const prev = times[k - 1];
          const newDay = !prev || prev.slice(0, 10) !== date;
          const gapPrev = prev ? xt - x(prev) : Infinity;
          const gapNext = times[k + 1] ? x(times[k + 1]) - xt : Infinity;
          const room = Math.min(gapPrev, gapNext);
          // その日の最初の発表から、次の日の最初の発表までの幅（日付の文字が入るか）
          const nextDay = times
            .slice(k + 1)
            .find((z) => z.slice(0, 10) !== date);
          const dayRoom = (nextDay ? x(nextDay) : W - PAD_R) - xt;
          const lead = Math.round(
            (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
              86_400_000,
          );
          return (
            <g key={t}>
              {newDay && prev && (
                <line
                  x1={(xt + x(prev)) / 2}
                  x2={(xt + x(prev)) / 2}
                  y1={T_TOP + T_H + 2}
                  y2={height - 2}
                  className="fh-dayline"
                />
              )}
              <line
                x1={xt}
                x2={xt}
                y1={T_TOP + T_H + 2}
                y2={T_TOP + T_H + 6}
                className="fh-dayline"
              />
              {room >= 12 && (
                <text
                  x={xt}
                  y={T_TOP + T_H + 16}
                  textAnchor="middle"
                  className="fh-tick"
                >
                  {hourOf(t)}
                </text>
              )}
              {newDay && (dayRoom >= 28 || date === day) && (
                <text
                  x={Math.min(
                    xt - 4,
                    W - (dayRoom >= 54 || date === day ? 50 : 28),
                  )}
                  y={height - 4}
                  className="fh-tick quiet"
                >
                  {md(date)}
                  {dayRoom >= 54 || date === day ? ` ${leadLabel(lead)}` : ""}
                </text>
              )}
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
            setCenter(null);
            scrubbing.current = false;
          }}
        />
      </svg>
      <div className="fh-one-legend">
        <span>
          <svg width="26" height="10" aria-hidden="true">
            <line
              x1="1"
              x2="25"
              y1="5"
              y2="5"
              stroke={mode === "tone" ? quiet("hot") : "var(--data-hot)"}
              strokeWidth="2"
              strokeDasharray={mode === "dash" ? "4 3" : undefined}
            />
            <circle
              cx="13"
              cy="5"
              r="2.6"
              fill="var(--surface-raised)"
              stroke={mode === "tone" ? quiet("hot") : "var(--data-hot)"}
              strokeWidth="1.2"
            />
          </svg>
          週間
        </span>
        <span>
          <svg width="26" height="10" aria-hidden="true">
            <line
              x1="1"
              x2="25"
              y1="5"
              y2="5"
              stroke="var(--data-hot)"
              strokeWidth="2"
            />
            <circle cx="13" cy="5" r="2.6" fill="var(--data-hot)" />
          </svg>
          府県
        </span>
      </div>
    </div>
  );
}

/**
 * 上の枠：指の下・選んだ発表を、文で説明せず画面の形で出す（アプリの1日モードの頭と、時間帯の表）。
 * - 天気の絵、最高／最低（前の同じ種類の発表からの差を ▲▼ で）、何の発表かの札。
 * - 降水確率の表：府県天気予報は 00-06・06-12・12-18・18-24 の4つ、週間は「1日」の1つ。値がない所は「---」。
 *   前の発表から変わった値は太字と ▲▼。
 * - 同じ時刻にもう一方の種類の発表もあれば、同じ形で小さく並べる。
 * - 週間の信頼度 A/B/C は、アプリ独自の信頼度の札と取り違えないよう、札にせず「信頼度」と書く。
 */
type Num = { s: string; v?: unknown } | null | undefined;
const numOf = (x: Num) => (x && x.s === "value" ? Number(x.v) : null);

function Delta({ now, before }: { now: number | null; before: number | null }) {
  if (now == null || before == null || now === before) return null;
  const d = now - before;
  return (
    <small className={`fh-delta ${d > 0 ? "up" : "down"}`}>
      {d > 0 ? `▲${d}` : `▼${-d}`}
    </small>
  );
}

function PopTable({ s, prev }: { s: Slot; prev: Slot | null }) {
  const v = s.values!;
  if (s.kind === "VPFW50") {
    const p = numOf(v.popDay);
    const b = prev?.values ? numOf(prev.values.popDay) : null;
    return (
      <div className="fh-ptab one">
        <span className="h">1日</span>
        <span className={`v${p != null && b != null && p !== b ? " ch" : ""}`}>
          {p == null ? "---" : `${p}%`}
          <Delta now={p} before={b} />
        </span>
      </div>
    );
  }
  const names = ["00-06", "06-12", "12-18", "18-24"];
  return (
    <div className="fh-ptab">
      {names.map((n) => (
        <span key={n} className="h">
          {n}
        </span>
      ))}
      {/* 時間帯ごとの天気（3時間ごとの天気を2つずつ）。自前の電文にだけあるので、ないときは行ごと出さない。 */}
      {v.wx3 &&
        [0, 1, 2, 3].map((c) => (
          <span key={`w${c}`} className="w">
            {[v.wx3![c * 2], v.wx3![c * 2 + 1]].map((t, k) =>
              t ? (
                <WeatherIcon
                  key={k}
                  text={skyText(t)}
                  size={20}
                  night={(c * 2 + k) * 3 < 6 || (c * 2 + k) * 3 >= 18}
                />
              ) : (
                <span key={k} className="w-none" />
              ),
            )}
          </span>
        ))}
      {v.pop6!.map((q, i) => {
        const p = numOf(q);
        // 当日の発表で、始まりが発表の時刻より前の時間帯は「過ぎた（過ぎつつある）」時間帯：値がなくても当然。
        const past =
          q === null || (s.lead === 0 && p == null && i * 6 <= hourOf(s.at));
        const b = prev?.values?.pop6 ? numOf(prev.values.pop6[i]) : null;
        return (
          <span
            key={i}
            // q が null：その時間帯はもう過ぎている（当日の発表は途中から）。文字を出さず、枠だけ控えめに。
            className={`v${past ? " past" : ""}${p != null && b != null && p !== b ? " ch" : ""}`}
          >
            {past ? "" : p == null ? "---" : `${p}%`}
            <Delta now={p} before={b} />
          </span>
        );
      })}
    </div>
  );
}

function Issue({
  s,
  slots,
  small = false,
}: {
  s: Slot;
  slots: Slot[];
  small?: boolean;
}) {
  const v = s.values!;
  const i = slots.indexOf(s);
  // 前の同じ種類の発表（当日は途中からの値なので比べない＝差を出さない）。
  const prev =
    s.lead === 0
      ? null
      : (slots
          .slice(0, i)
          .reverse()
          .find((p) => p.kind === s.kind && p.state === "ok" && p.values) ??
        null);
  const mx = numOf(v.max);
  const mn = numOf(v.min);
  const rel =
    s.kind === "VPFW50" && v.reliability?.s === "value"
      ? String(v.reliability.v)
      : null;
  return (
    <div className={`fh-issue${small ? " small" : ""}`}>
      <div className="dd-hero">
        <span className="dd-pic">
          <Wx s={s} size={small ? 32 : 52} />
        </span>
        {numOf(v.max) != null || numOf(v.min) != null ? (
          <span className="dd-temps">
            <span className="tone-hot">{mx ?? "—"}</span>
            <Delta
              now={mx}
              before={prev?.values ? numOf(prev.values.max) : null}
            />
            <span className="dd-slash">/</span>
            <span className="tone-cold">{mn ?? "—"}</span>
            <Delta
              now={mn}
              before={prev?.values ? numOf(prev.values.min) : null}
            />
            <small>℃</small>
          </span>
        ) : (
          <span className="dd-temps" />
        )}
        <span className="dd-kind">
          <span className={`fh-kchip ${s.kind}`}>{KIND_SHORT[s.kind]}</span>
          {md(s.at.slice(0, 10))} {hourOf(s.at)}時
          <span className="fh-lead">{leadLabel(s.lead)}</span>
          {!prev && s.lead > 0 && <span className="fh-lead">最初</span>}
          {rel && <span className="fh-lead">信頼度{rel}</span>}
        </span>
      </div>
      {hasNumbers(s) && <PopTable s={s} prev={prev} />}
    </div>
  );
}

export function FocusSay({ s, slots }: { s: Slot; slots: Slot[] }) {
  if (s.state !== "ok" || !s.values) {
    return (
      <div className="fh-focus">
        <div className="dd-hero">
          <span className="dd-pic fh-focus-nopic" aria-hidden="true" />
          <span className="dd-temps">
            <span className="fh-focus-state">{STATE_TEXT[s.state]}</span>
          </span>
          <span className="dd-kind">
            <span className={`fh-kchip ${s.kind}`}>{KIND_SHORT[s.kind]}</span>
            {md(s.at.slice(0, 10))} {hourOf(s.at)}時
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="fh-focus">
      <Issue s={s} slots={slots} />
    </div>
  );
}
