// R6-1・R6-2 の見本：1日モードの③「この日の予報の移り変わり」。
//   案A 折れ線／案B 発表ごとの行（2段）／案C 変わり目だけ／案D 組み合わせ（小さな折れ線＋行＋「変わった発表だけ」）。
// 区切りの違う値（週間の1日の降水確率と、府県天気予報の6時間の降水確率）は、同じ線・同じ列に置かない（R2）。

import { Fragment, type ReactNode, useState } from "react";
import { DATA, lineLook } from "../../../src/design/tokens";
import { Chip } from "../../../src/ui/kit";
import { WeatherIcon } from "../../../src/ui/WeatherIcon";
import {
  hourOf,
  issueLabel,
  KIND_NAME,
  KIND_SHORT,
  type Kind,
  leadLabel,
  md,
  skyText,
  type Slot,
  STATE_TEXT,
  type V,
} from "./model";

export const vNum = (v: V | null | undefined) =>
  v && v.s === "value" ? Number(v.v) : null;

/**
 * 1つの値：値／「—」（気象庁が出していない：値なし・項目なし）／空（対象期間外）。
 * 「—」の理由は title に頼らない（スマホでは読めない）：行やマスを押すと、下の「出どころ」に理由が出る。
 */
export function Val({
  v,
  unit,
  tone,
  changed,
}: {
  v: V | null | undefined;
  unit?: string;
  tone?: string;
  changed?: boolean;
}) {
  if (v === null) return <span className="fh-out" aria-label="対象期間外" />;
  if (!v || v.s === "absent")
    return (
      <span className="fh-dash" aria-label="項目なし">
        —
      </span>
    );
  if (v.s === "none")
    return (
      <span className="fh-dash" aria-label="値なし">
        —
      </span>
    );
  return (
    <span
      className={`fh-val${tone ? ` tone-${tone}` : ""}${changed ? " changed" : ""}`}
    >
      {v.v}
      {unit && <small>{unit}</small>}
    </span>
  );
}

/** 天気の名前は「後・時々・一時」の前でだけ折り返す（くもり後｜雨 と切らない）。 */
export const breakable = (name: string) =>
  name.replace(/(後|時々|一時)/g, "​$1");

/** 府県天気予報の6時間降水確率。4つとも「項目なし」（明後日など）なら「—」1つにする。 */
export function Pop6({ s }: { s: Slot }) {
  const p = s.values!.pop6!;
  if (p.every((v) => v && v.s === "absent")) return <Val v={{ s: "absent" }} />;
  return (
    <>
      {p.map((v, i) => (
        <Val key={i} v={v} tone="rain" changed={s.changed.has(`pop6-${i}`)} />
      ))}
    </>
  );
}

const weatherOf = (s: Slot) =>
  s.values?.weather.s === "value"
    ? (s.values.weather as V & { name?: string; partial?: string | null })
    : null;

export function Wx({ s, size = 20 }: { s: Slot; size?: number }) {
  const w = weatherOf(s);
  if (!w) return <span className="fh-dash">—</span>;
  return <WeatherIcon text={skyText(w.name ?? null)} size={size} />;
}

/** 発表がない回の札：「記録なし」「取れなかった」「取り消し」は言葉で出す（R5-1・R6-8）。 */
export function StateTag({ s }: { s: Slot }) {
  if (s.state === "ok") return null;
  return <span className={`fh-state ${s.state}`}>{STATE_TEXT[s.state]}</span>;
}

function When({ s, sub }: { s: Slot; sub?: ReactNode }) {
  return (
    <span className="fh-when">
      <b>
        {md(s.at.slice(0, 10))}
        <span>{hourOf(s.at)}時</span>
      </b>
      <small>
        {sub ?? leadLabel(s.lead)}
        {!s.regular && "・臨時"}
        {s.shown?.info_type === "訂正" && (
          <span className="fh-tag fix">訂正</span>
        )}
        {s.shown && (
          <span className="fh-src">
            {s.shown.source === "jma-xml" ? "電文" : "記録"}
          </span>
        )}
      </small>
    </span>
  );
}

/** 1つの発表の行（2段）：1段目 発表時刻と天気、2段目 降水確率と最高・最低。行ぜんたいが押せる（44px 以上）。 */
function SlotRow({
  s,
  selected,
  onSelect,
}: {
  s: Slot;
  selected: boolean;
  onSelect: (k: string) => void;
}) {
  const quiet = s.state === "ok" && s.changed.size === 0;
  const w = weatherOf(s);
  const v = s.values;
  return (
    <button
      className={`fh-row${quiet ? " quiet" : ""}${selected ? " on" : ""}${s.state !== "ok" ? " gap" : ""}`}
      onClick={() => onSelect(s.key)}
      aria-pressed={selected}
    >
      <span className="fh-r1">
        <When s={s} />
        {s.state !== "ok" || !v ? (
          <StateTag s={s} />
        ) : (
          <span
            className={`fh-wx${s.changed.has("weather") ? " changed" : ""}`}
          >
            <Wx s={s} />
            <span className="fh-wxname">
              {breakable(w?.name ?? "—")}
              {w?.partial && <small>（{w.partial}）</small>}
            </span>
          </span>
        )}
      </span>
      {s.state === "ok" && v && (
        <span className="fh-r2">
          <span className="fh-pop">
            <small className="fh-lbl">
              {s.kind === "VPFW50" ? "降水（1日）" : "降水（6時間）"}
            </small>
            {s.kind === "VPFW50" ? (
              <Val
                v={v.popDay}
                unit="%"
                tone="rain"
                changed={s.changed.has("pop")}
              />
            ) : (
              <Pop6 s={s} />
            )}
          </span>
          <span className="fh-temp">
            <small className="fh-lbl">
              {s.kind === "VPFW50" ? "最高／最低" : "日中／朝"}
            </small>
            <Val v={v.max} tone="hot" changed={s.changed.has("max")} />
            <small className="fh-sl">/</small>
            <Val v={v.min} tone="cold" changed={s.changed.has("min")} />
          </span>
          {v.reliability && v.reliability.s === "value" && (
            <span
              className={`fh-rel${s.changed.has("reliability") ? " changed" : ""}`}
            >
              信頼度{String(v.reliability.v)}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

type Item =
  | { t: "slot"; s: Slot }
  | { t: "gaps"; run: Slot[] }
  | { t: "same"; run: Slot[] };

/**
 * 1つの種類の発表を並べる。同じ状態の空き（記録なしなど）が3回以上続けば1行に。
 * `onlyChanged` のときは、前の発表から変わらなかった回をまとめた行にする（押すと開いて1つずつ見られる）。
 */
function itemsOf(rows: Slot[], onlyChanged: boolean): Item[] {
  const out: Item[] = [];
  let gaps: Slot[] = [];
  let same: Slot[] = [];
  let seenOk = false;
  const flush = () => {
    if (gaps.length >= 3) out.push({ t: "gaps", run: gaps });
    else for (const s of gaps) out.push({ t: "slot", s });
    if (same.length) out.push({ t: "same", run: same });
    gaps = [];
    same = [];
  };
  for (const s of rows) {
    const isGap = s.state !== "ok" && s.state !== "cancelled";
    if (isGap && !same.length && (!gaps.length || gaps[0].state === s.state)) {
      gaps.push(s);
      continue;
    }
    // 当日の発表は前の発表と比べないので、「変わらなかった発表」には数えない（いつも1行で出す）。
    if (
      onlyChanged &&
      s.state === "ok" &&
      s.lead > 0 &&
      seenOk &&
      s.changed.size === 0 &&
      !gaps.length
    ) {
      same.push(s);
      continue;
    }
    flush();
    if (isGap) gaps.push(s);
    else out.push({ t: "slot", s });
    if (s.state === "ok") seenOk = true;
  }
  flush();
  return out;
}

const GROUP_NOTE: Record<Kind, string> = {
  VPFW50: "天気・降水は高知県、気温は高知。降水確率は1日の値",
  VPFD51:
    "天気・降水は中部、気温は高知。降水確率は6時間ごと（0・6・12・18時から）",
};

/** 案B（と案D の下）：発表ごとの行。週間と府県天気予報は、区域も区切りも違うので別のまとまりにする。 */
export function TransitionRows({
  slots,
  selected,
  onSelect,
  actual,
  onlyChanged = false,
  openAll = false,
}: {
  slots: Slot[];
  selected: string | null;
  onSelect: (k: string) => void;
  actual: ReactNode;
  onlyChanged?: boolean;
  openAll?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen(
      (o) => new Set(o.has(k) ? [...o].filter((x) => x !== k) : [...o, k]),
    );
  return (
    <div className="fh-tbl" role="list" aria-label="発表ごとの予報">
      {(["VPFW50", "VPFD51"] as Kind[]).map((kind) => {
        const rows = slots.filter((s) => s.kind === kind);
        if (!rows.length) return null;
        return (
          <Fragment key={kind}>
            <div className="fh-group">
              <span>{KIND_NAME[kind]}</span>
              <small>{GROUP_NOTE[kind]}</small>
            </div>
            {itemsOf(rows, onlyChanged).map((it) => {
              if (it.t === "slot")
                return (
                  <SlotRow
                    key={it.s.key}
                    s={it.s}
                    selected={selected === it.s.key}
                    onSelect={onSelect}
                  />
                );
              const first = it.run[0];
              const last = it.run[it.run.length - 1];
              const k = first.key;
              const isOpen = openAll || open.has(k);
              const label =
                it.t === "gaps" ? (
                  <>
                    <StateTag s={first} />
                    <small className="fh-runn">{it.run.length}回</small>
                  </>
                ) : (
                  <span className="fh-same">
                    変わらなかった発表 {it.run.length}回
                  </span>
                );
              return (
                <Fragment key={k}>
                  <button
                    className={`fh-row fh-run${it.t === "gaps" ? " gap" : " quiet"}`}
                    onClick={() => toggle(k)}
                    aria-expanded={isOpen}
                  >
                    <span className="fh-r1">
                      <span className="fh-when">
                        <b>
                          {md(first.at.slice(0, 10))}
                          <span>{hourOf(first.at)}時</span>
                        </b>
                        <small>
                          {it.run.length > 1
                            ? `〜 ${issueLabel(last.at)}`
                            : leadLabel(first.lead)}
                        </small>
                      </span>
                      <span className="fh-runlabel">
                        {label}
                        <span className="fh-open">
                          {isOpen ? "閉じる" : "開く"}
                        </span>
                      </span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="fh-runbody">
                      {it.run.map((s) => (
                        <SlotRow
                          key={s.key}
                          s={s}
                          selected={selected === s.key}
                          onSelect={onSelect}
                        />
                      ))}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}
      {actual}
    </div>
  );
}

/** 案C：変わり目だけ。変わらなかった発表は数だけ出し、すべての発表に戻せる。 */
export function TransitionSteps({
  slots,
  selected,
  onSelect,
  actual,
}: {
  slots: Slot[];
  selected: string | null;
  onSelect: (k: string) => void;
  actual: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const unchanged = slots.filter(
    (s, i) =>
      s.state === "ok" &&
      s.lead > 0 &&
      s.changed.size === 0 &&
      slots.slice(0, i).some((p) => p.kind === s.kind && p.state === "ok"),
  ).length;
  return (
    <div className="fh-steps-wrap">
      <p className="fh-steps-head">
        <span>
          変わらなかった発表 <b>{unchanged}回</b>
        </span>
        <button
          className="chip sm"
          onClick={() => setAll(!all)}
          aria-pressed={all}
        >
          {all ? "変わった発表だけに戻す" : "すべての発表を見る"}
        </button>
      </p>
      <TransitionRows
        slots={slots}
        selected={selected}
        onSelect={onSelect}
        actual={actual}
        onlyChanged
        openAll={all}
      />
    </div>
  );
}

// ---- 案A：折れ線（週間と府県天気予報を別の段に、同じ時間の軸で） ----------------------------------

// 幅 360 の端末でも文字が 11px を下回らないよう、描く幅は表示の幅より狭くとる（拡大して見せる）。
const W = 300;
const PAD_L = 26;
const PAD_R = 8;
const POP6_NAME = ["0〜6時", "6〜12時", "12〜18時", "18〜24時"];

/**
 * 数値（降水確率・気温）だけを線にする。天気は絵を並べるだけで線で結ばない。発表がない回（取れなかった・
 * 記録なし・取り消し）で線は切れる。週間（1日の降水確率）と府県天気予報（6時間）は別の段で、6時間の降水確率は
 * 区切りを1つ選んで1本だけ引く（4本を重ねない）。発表を選ぶのは、下の 44px の札（線の上を押しても近い発表を選ぶ）。
 */
export function TransitionChart({
  slots,
  day,
  selected,
  onSelect,
  compact = false,
}: {
  slots: Slot[];
  day: string;
  selected: string | null;
  onSelect: (k: string) => void;
  compact?: boolean;
}) {
  const [pop6, setPop6] = useState(2);
  if (!slots.length) return null;
  const t0 = Date.parse(slots[0].at);
  const t1 = Date.parse(`${day}T18:00:00+09:00`);
  const x = (iso: string) =>
    PAD_L + ((Date.parse(iso) - t0) / (t1 - t0)) * (W - PAD_L - PAD_R);
  // 気温の軸は2つの段で同じ（同じ℃を同じ高さに）。
  const temps = slots
    .flatMap((s) => [vNum(s.values?.max), vNum(s.values?.min)])
    .filter((v): v is number => v != null);
  const lo = temps.length ? Math.floor(Math.min(...temps) / 5) * 5 : 0;
  const hi = temps.length ? Math.ceil(Math.max(...temps) / 5) * 5 : 30;
  const lanes = (["VPFW50", "VPFD51"] as Kind[]).filter((k) =>
    slots.some((s) => s.kind === k),
  );
  const LANE_H = compact ? 118 : 150;
  const H_AXIS = 30;
  const height = lanes.length * LANE_H + H_AXIS;
  const days: string[] = [];
  for (let t = t0; t <= t1; t += 86_400_000)
    days.push(new Date(t + 9 * 3_600_000).toISOString().slice(0, 10));
  const hot = lineLook("target", DATA.hot);
  const cold = lineLook("target", DATA.cold);
  const rain = lineLook("target", DATA.rain, { weight: "minor" });
  return (
    <div className={`fh-chart${compact ? " compact" : ""}`}>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label="発表ごとの予報の移り変わり（折れ線）"
      >
        {lanes.map((kind, li) => {
          const top = li * LANE_H;
          const ICON_Y = top + 20;
          const POP_TOP = top + 34;
          const POP_H = compact ? 18 : 26;
          const T_TOP = POP_TOP + POP_H + (compact ? 10 : 16);
          const T_H = LANE_H - (T_TOP - top) - 6;
          const ty = (v: number) =>
            T_TOP + T_H - ((v - lo) / (hi - lo || 1)) * T_H;
          const py = (v: number) => POP_TOP + POP_H - (v / 100) * POP_H;
          const ss = slots.filter((s) => s.kind === kind);
          // 途切れない区間ごとの点（発表がない回・値がない回で切れる）。
          const runs = (
            get: (s: Slot) => number | null,
            y: (v: number) => number,
          ) => {
            const out: { x: number; y: number; s: Slot }[][] = [];
            let cur: { x: number; y: number; s: Slot }[] = [];
            for (const s of ss) {
              const v = s.state === "ok" ? get(s) : null;
              if (v == null) {
                if (cur.length) out.push(cur);
                cur = [];
                continue;
              }
              cur.push({ x: x(s.at), y: y(v), s });
            }
            if (cur.length) out.push(cur);
            return out;
          };
          const path = (pts: { x: number; y: number }[]) =>
            pts
              .map(
                (p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
              )
              .join("");
          const popOf = (s: Slot) =>
            kind === "VPFW50"
              ? vNum(s.values?.popDay)
              : vNum(s.values?.pop6?.[pop6]);
          const popKey = kind === "VPFW50" ? "pop" : `pop6-${pop6}`;
          const gaps: { from: Slot; to: Slot; state: Slot["state"] }[] = [];
          for (const s of ss)
            if (s.state !== "ok") {
              const g = gaps.at(-1);
              if (
                g &&
                g.state === s.state &&
                ss.indexOf(g.to) === ss.indexOf(s) - 1
              )
                g.to = s;
              else gaps.push({ from: s, to: s, state: s.state });
            }
          const lines: {
            key: string;
            get: (s: Slot) => number | null;
            y: (v: number) => number;
            look: typeof hot;
            color: string;
            changedKey: string;
            above: boolean;
          }[] = [
            {
              key: "pop",
              get: popOf,
              y: py,
              look: rain,
              color: "rain",
              changedKey: popKey,
              above: true,
            },
            {
              key: "max",
              get: (s) => vNum(s.values?.max),
              y: ty,
              look: hot,
              color: "hot",
              changedKey: "max",
              above: true,
            },
            {
              key: "min",
              get: (s) => vNum(s.values?.min),
              y: ty,
              look: cold,
              color: "cold",
              changedKey: "min",
              above: false,
            },
          ];
          return (
            <g key={kind}>
              <text x={0} y={top + 9} className="fh-lane">
                {KIND_NAME[kind]}
                <tspan className="fh-lane-sub">
                  {kind === "VPFW50"
                    ? "　降水は1日"
                    : `　降水は${POP6_NAME[pop6]}`}
                </tspan>
              </text>
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
              {gaps.map((g, i) => {
                const x1 = x(g.from.at) - 5;
                const x2 = x(g.to.at) + 5;
                return (
                  <g key={i} className={`fh-gapband ${g.state}`}>
                    <rect
                      x={x1}
                      y={top + 12}
                      width={x2 - x1}
                      height={LANE_H - 16}
                      rx={3}
                    />
                    <text
                      x={(x1 + x2) / 2}
                      y={T_TOP + T_H / 2}
                      textAnchor="middle"
                      className="fh-gaptext"
                      writingMode={x2 - x1 < 46 ? "tb" : undefined}
                    >
                      {STATE_TEXT[g.state]}
                    </text>
                  </g>
                );
              })}
              {ss.map((s) =>
                s.state === "ok" && s.values ? (
                  <g key={s.key}>
                    {selected === s.key && (
                      <rect
                        x={x(s.at) - 7}
                        y={top + 12}
                        width={14}
                        height={LANE_H - 16}
                        rx={3}
                        className="fh-colsel"
                      />
                    )}
                    <foreignObject
                      x={x(s.at) - 8}
                      y={ICON_Y - 8}
                      width={16}
                      height={16}
                    >
                      <Wx s={s} size={16} />
                    </foreignObject>
                    {s.changed.has("weather") && (
                      <circle
                        cx={x(s.at)}
                        cy={ICON_Y + 10}
                        r={1.6}
                        className="fh-dot"
                      />
                    )}
                  </g>
                ) : null,
              )}
              {lines.map((l) =>
                runs(l.get, l.y).map((r, i) => (
                  <g key={`${l.key}${i}`}>
                    <path
                      d={path(r)}
                      fill="none"
                      stroke={l.look.stroke}
                      strokeWidth={l.look.strokeWidth}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {r.map((p, j) => {
                      const changed = p.s.changed.has(l.changedKey);
                      // 最後の点は、1つ前の点と同じ値で、その点に数字が出ているなら書かない（数字が重なる）。
                      const prev = r[j - 1];
                      const lastShown =
                        j === r.length - 1 &&
                        !(
                          prev &&
                          prev.s.changed.has(l.changedKey) &&
                          l.get(prev.s) === l.get(p.s)
                        );
                      return (
                        <g key={p.s.key}>
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={changed ? 2.6 : 1.6}
                            fill={`var(--data-${l.color})`}
                          />
                          {(changed || lastShown) && (
                            <text
                              x={p.x}
                              y={l.above ? p.y - 5 : p.y + 11}
                              textAnchor="middle"
                              className={`fh-vlabel tone-${l.color}`}
                            >
                              {l.get(p.s)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                )),
              )}
              {/* 線の上を押しても、いちばん近い発表を選ぶ（主な選び方は下の札） */}
              <rect
                x={PAD_L}
                y={top + 12}
                width={W - PAD_L - PAD_R}
                height={LANE_H - 16}
                className="fh-hit"
                onClick={(ev) => {
                  const m = (
                    ev.currentTarget.ownerSVGElement as SVGSVGElement
                  ).getScreenCTM();
                  if (!m) return;
                  const px = (ev.clientX - m.e) / m.a;
                  const near = ss.reduce((a, b) =>
                    Math.abs(x(b.at) - px) < Math.abs(x(a.at) - px) ? b : a,
                  );
                  onSelect(near.key);
                }}
              />
            </g>
          );
        })}
        {days.map((d) => {
          const xd = x(`${d}T00:00:00+09:00`);
          if (xd < PAD_L - 1) return null;
          const lead = Math.round(
            (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) /
              86_400_000,
          );
          return (
            <g key={d}>
              <line
                x1={xd}
                x2={xd}
                y1={0}
                y2={height - H_AXIS + 4}
                className="fh-dayline"
              />
              <text x={xd + 2} y={height - H_AXIS + 14} className="fh-tick">
                {md(d)}
              </text>
              <text
                x={xd + 2}
                y={height - H_AXIS + 26}
                className="fh-tick quiet"
              >
                {leadLabel(lead)}
              </text>
            </g>
          );
        })}
      </svg>
      {lanes.includes("VPFD51") && (
        <div className="chip-row fh-pop6">
          <small className="fh-lbl">府県の降水（6時間）</small>
          {POP6_NAME.map((n, i) => (
            <Chip key={n} size="sm" on={pop6 === i} onClick={() => setPop6(i)}>
              {n}
            </Chip>
          ))}
        </div>
      )}
      <div className="fh-picker" role="group" aria-label="発表を選ぶ">
        {slots.map((s) => (
          <button
            key={s.key}
            className={`fh-pick${selected === s.key ? " on" : ""}${s.state !== "ok" ? " gap" : ""}`}
            onClick={() => onSelect(s.key)}
            aria-pressed={selected === s.key}
          >
            <small>{KIND_SHORT[s.kind]}</small>
            <b>{md(s.at.slice(0, 10))}</b>
            <small>{hourOf(s.at)}時</small>
          </button>
        ))}
      </div>
    </div>
  );
}
