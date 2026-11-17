// R6-1・R6-2 の見本：1日モードの③「この日の予報の移り変わり」。案A 折れ線／案B 発表ごとの行／案C 変わり目だけ。

import { Fragment, type ReactNode } from "react";
import { DATA, lineLook } from "../../../src/design/tokens";
import { WeatherIcon } from "../../../src/ui/WeatherIcon";
import { hourOf, issueLabel, KIND_NAME, KIND_SHORT, type Kind, leadLabel, md, skyText, type Slot, STATE_TEXT, type V } from "./model";

export const vNum = (v: V | null | undefined) => (v && v.s === "value" ? Number(v.v) : null);

/** 1つの値：値／「—」（気象庁が出していない：値なし・項目なし）／空（対象期間外）。 */
export function Val({ v, unit, tone, changed, dim, range = false }: { v: V | null | undefined; unit?: string; tone?: string; changed?: boolean; dim?: boolean; range?: boolean }) {
  if (v === null) return <span className="fh-out" aria-label="対象期間外" />;
  if (!v || v.s === "absent") return <span className="fh-dash" title="この発表には、この項目がない（項目なし）">—</span>;
  if (v.s === "none") return <span className="fh-dash" title="気象庁が値を出していない（値なし）">—</span>;
  return (
    <span className={`fh-val${tone ? ` tone-${tone}` : ""}${changed ? " changed" : ""}${dim ? " dim" : ""}`}>
      {v.v}
      {unit && <small>{unit}</small>}
      {range && v.lower != null && v.upper != null && <small className="fh-range">{`${v.lower}〜${v.upper}`}</small>}
    </span>
  );
}

/** 天気の名前は「後・時々・一時」の前でだけ折り返す（くもり後｜雨 と切らない）。 */
export const breakable = (name: string) => name.replace(/(後|時々|一時)/g, "\u200b$1");

/** 府県天気予報の6時間降水確率。4つとも「項目なし」（明後日など）なら「—」1つにする。 */
export function Pop6({ s }: { s: Slot }) {
  const p = s.values!.pop6!;
  if (p.every((v) => v && v.s === "absent")) return <Val v={{ s: "absent" }} />;
  return <>{p.map((v, i) => <Val key={i} v={v} tone="rain" changed={s.changed.has(`pop6-${i}`)} />)}</>;
}

const weatherOf = (s: Slot) => (s.values?.weather.s === "value" ? (s.values.weather as V & { name?: string; partial?: string | null }) : null);

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

function SlotHead({ s, selected, onSelect }: { s: Slot; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`fh-when${selected ? " on" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <b>
        {md(s.at.slice(0, 10))}
        <span>{hourOf(s.at)}時</span>
      </b>
      <small>
        {leadLabel(s.lead)}
        {!s.regular && "・臨時"}
        {s.shown?.info_type === "訂正" && <span className="fh-tag fix">訂正</span>}
        {s.shown && <span className="fh-src">{s.shown.source === "jma-xml" ? "電文" : "記録"}</span>}
      </small>
    </button>
  );
}

/** 同じ状態の空き（記録なしなど）が3回以上続くときは1行にまとめる。 */
function collapse(rows: Slot[]): (Slot | { run: Slot[] })[] {
  const out: (Slot | { run: Slot[] })[] = [];
  let run: Slot[] = [];
  const flush = () => {
    if (run.length >= 3) out.push({ run });
    else out.push(...run);
    run = [];
  };
  for (const s of rows) {
    if (s.state !== "ok" && s.state !== "cancelled" && (!run.length || run[0].state === s.state)) {
      run.push(s);
      continue;
    }
    flush();
    if (s.state !== "ok" && s.state !== "cancelled") run.push(s);
    else out.push(s);
  }
  flush();
  return out;
}

/** 案B：発表ごとの行。週間と府県天気予報は、区域も区切りも違うので別のまとまりにする。 */
export function TransitionTable({ slots, selected, onSelect, actual }: { slots: Slot[]; selected: string | null; onSelect: (k: string) => void; actual: ReactNode }) {
  const groups: { kind: Kind; rows: Slot[] }[] = [];
  for (const kind of ["VPFW50", "VPFD51"] as Kind[]) groups.push({ kind, rows: slots.filter((s) => s.kind === kind) });
  return (
    <div className="fh-tbl" role="table" aria-label="発表ごとの予報">
      {groups.map((g) => (
        <Fragment key={g.kind}>
          <div className="fh-group" role="row">
            <span>{KIND_NAME[g.kind]}</span>
            <small>{g.kind === "VPFW50" ? "天気・降水は高知県、気温は高知。降水確率は1日" : "天気・降水は中部、気温は高知。降水確率は6時間ごと"}</small>
          </div>
          <div className="fh-row fh-colhead" role="row">
            <span>発表</span>
            <span>天気</span>
            <span>{g.kind === "VPFW50" ? "降水" : "降水 0・6・12・18時"}</span>
            <span>最高／最低{g.kind === "VPFD51" ? <small>日中・朝</small> : null}</span>
          </div>
          {collapse(g.rows).map((s) => {
            if ("run" in s)
              return (
                <div key={s.run[0].key} className="fh-row gap" role="row">
                  <button className="fh-when" onClick={() => onSelect(s.run[0].key)}>
                    <b>
                      {md(s.run[0].at.slice(0, 10))}
                      <span>{hourOf(s.run[0].at)}時</span>
                    </b>
                    <small>〜 {issueLabel(s.run[s.run.length - 1].at)}</small>
                  </button>
                  <span className="fh-gapcell">
                    <StateTag s={s.run[0]} />
                    <small className="fh-runn">{s.run.length}回</small>
                  </span>
                </div>
              );
            const quiet = s.state === "ok" && s.changed.size === 0;
            const w = weatherOf(s);
            return (
              <div key={s.key} className={`fh-row${quiet ? " quiet" : ""}${selected === s.key ? " on" : ""}${s.state !== "ok" ? " gap" : ""}`} role="row">
                <SlotHead s={s} selected={selected === s.key} onSelect={() => onSelect(s.key)} />
                {s.state !== "ok" || !s.values ? (
                  <span className="fh-gapcell">
                    <StateTag s={s} />
                  </span>
                ) : (
                  <>
                    <span className={`fh-wx${s.changed.has("weather") ? " changed" : ""}`}>
                      <Wx s={s} />
                      <span className="fh-wxname">
                        {breakable(w?.name ?? "—")}
                        {w?.partial && <small>（{w.partial}）</small>}
                      </span>
                    </span>
                    <span className="fh-pop">
                      {s.kind === "VPFW50" ? (
                        <Val v={s.values.popDay} unit="%" tone="rain" changed={s.changed.has("pop")} />
                      ) : (
                        <Pop6 s={s} />
                      )}
                      {s.values.reliability && s.values.reliability.s === "value" && (
                        <span className={`fh-rel${s.changed.has("reliability") ? " changed" : ""}`} title="気象庁の週間予報の信頼度（アプリの信頼度とは別）">
                          信頼度{String(s.values.reliability.v)}
                        </span>
                      )}
                    </span>
                    <span className="fh-temp">
                      <Val v={s.values.max} tone="hot" changed={s.changed.has("max")} />
                      <small className="fh-sl">/</small>
                      <Val v={s.values.min} tone="cold" changed={s.changed.has("min")} />
                    </span>
                    {s.values.max.s === "value" && s.values.max.lower != null && (
                      <small className="fh-rangeline" title="気象庁の予測範囲">
                        予測範囲 最高 {s.values.max.lower}〜{s.values.max.upper}・最低 {s.values.min.s === "value" ? `${s.values.min.lower}〜${s.values.min.upper}` : "—"}
                      </small>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </Fragment>
      ))}
      {actual}
    </div>
  );
}

/** 案C：変わり目だけ。変わらなかった回はまとめて1行にする。 */
export function TransitionSteps({ slots, selected, onSelect, actual }: { slots: Slot[]; selected: string | null; onSelect: (k: string) => void; actual: ReactNode }) {
  type Item = { kind: "step"; s: Slot; prev: Slot | null } | { kind: "same"; from: Slot; to: Slot; n: number } | { kind: "gap"; s: Slot };
  const items: Item[] = [];
  const last: Partial<Record<Kind, Slot>> = {};
  let run: Slot[] = [];
  const flush = () => {
    if (run.length) items.push({ kind: "same", from: run[0], to: run[run.length - 1], n: run.length });
    run = [];
  };
  for (const s of slots) {
    if (s.state !== "ok") {
      flush();
      items.push({ kind: "gap", s });
      continue;
    }
    const p = last[s.kind] ?? null;
    last[s.kind] = s;
    if (p && !s.changed.size) {
      if (run.length && run[0].kind !== s.kind) flush();
      run.push(s);
      continue;
    }
    flush();
    items.push({ kind: "step", s, prev: p });
  }
  flush();
  const temps = (s: Slot) => (
    <span className="fh-temp">
      <Val v={s.values!.max} tone="hot" changed={s.changed.has("max")} />
      <small className="fh-sl">/</small>
      <Val v={s.values!.min} tone="cold" changed={s.changed.has("min")} />
    </span>
  );
  return (
    <ol className="fh-steps">
      {items.map((it, i) =>
        it.kind === "gap" ? (
          <li key={i} className={`fh-step gap${selected === it.s.key ? " on" : ""}`}>
            <button className="fh-step-btn" onClick={() => onSelect(it.s.key)}>
              <span className="fh-step-when">
                {issueLabel(it.s.at)}
                <small>{KIND_SHORT[it.s.kind]}</small>
              </span>
              <StateTag s={it.s} />
            </button>
          </li>
        ) : it.kind === "same" ? (
          <li key={i} className="fh-step same">
            <span className="fh-step-when">
              {it.n === 1 ? issueLabel(it.from.at) : `${issueLabel(it.from.at)}〜${issueLabel(it.to.at)}`}
              <small>{KIND_SHORT[it.from.kind]}</small>
            </span>
            <span className="fh-same">変わらず{it.n > 1 ? `（${it.n}回）` : ""}</span>
          </li>
        ) : (
          <li key={i} className={`fh-step${selected === it.s.key ? " on" : ""}${it.prev ? " change" : " first"}`}>
            <button className="fh-step-btn" onClick={() => onSelect(it.s.key)}>
              <span className="fh-step-when">
                {issueLabel(it.s.at)}
                <small>
                  {KIND_SHORT[it.s.kind]}・{leadLabel(it.s.lead)}
                  {it.s.shown?.info_type === "訂正" && <span className="fh-tag fix">訂正</span>}
                </small>
              </span>
              <span className="fh-step-body">
                <span className={`fh-wx${it.s.changed.has("weather") ? " changed" : ""}`}>
                  <Wx s={it.s} size={18} />
                  {weatherOf(it.s)?.name ?? "—"}
                  {weatherOf(it.s)?.partial && <small>（{weatherOf(it.s)!.partial}）</small>}
                </span>
                <span className="fh-pop">
                  {it.s.kind === "VPFW50" ? (
                    <Val v={it.s.values!.popDay} unit="%" tone="rain" changed={it.s.changed.has("pop")} />
                  ) : (
                    <Pop6 s={it.s} />
                  )}
                </span>
                {temps(it.s)}
              </span>
            </button>
          </li>
        ),
      )}
      {actual}
    </ol>
  );
}

// ---- 案A：折れ線（週間と府県天気予報を別の段に、同じ時間の軸で） ----------------------------------

// 幅 360 の端末でも文字が 11px を下回らないよう、描く幅は表示の幅より狭くとる（拡大して見せる）。
const W = 300;
const PAD_L = 26;
const PAD_R = 8;

export function TransitionChart({ slots, day, selected, onSelect }: { slots: Slot[]; day: string; selected: string | null; onSelect: (k: string) => void }) {
  if (!slots.length) return null;
  const t0 = Date.parse(slots[0].at);
  const t1 = Date.parse(`${day}T18:00:00+09:00`);
  const x = (iso: string) => PAD_L + ((Date.parse(iso) - t0) / (t1 - t0)) * (W - PAD_L - PAD_R);
  // 気温の軸は2つの段で同じ（同じ℃を同じ高さに）。
  const temps = slots.flatMap((s) => [vNum(s.values?.max), vNum(s.values?.min), s.values?.max.s === "value" ? s.values.max.upper : null, s.values?.min.s === "value" ? s.values.min.lower : null]).filter((v): v is number => v != null);
  const lo = Math.floor(Math.min(...temps) / 5) * 5 - (temps.length ? 0 : 5);
  const hi = Math.ceil(Math.max(...temps) / 5) * 5 + (temps.length ? 0 : 30);
  const lanes = (["VPFW50", "VPFD51"] as Kind[]).filter((k) => slots.some((s) => s.kind === k));
  const LANE_H = 150;
  const H_AXIS = 30;
  const height = lanes.length * LANE_H + H_AXIS;
  const days: string[] = [];
  for (let t = t0; t <= t1; t += 86_400_000) days.push(new Date(t + 9 * 3_600_000).toISOString().slice(0, 10));
  return (
    <div className="fh-chart">
      <svg width="100%" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="発表ごとの予報の移り変わり（折れ線）">
        {lanes.map((kind, li) => {
          const top = li * LANE_H;
          const ICON_Y = top + 18;
          const POP_TOP = top + 32;
          const POP_H = 24;
          const T_TOP = top + 74;
          const T_H = 64;
          const ty = (v: number) => T_TOP + T_H - ((v - lo) / (hi - lo)) * T_H;
          const ss = slots.filter((s) => s.kind === kind);
          const runs = (get: (s: Slot) => number | null) => {
            const out: { x: number; y: number; s: Slot }[][] = [];
            let cur: { x: number; y: number; s: Slot }[] = [];
            for (const s of ss) {
              const v = s.state === "ok" ? get(s) : null;
              if (v == null) {
                if (cur.length) out.push(cur);
                cur = [];
                continue;
              }
              cur.push({ x: x(s.at), y: ty(v), s });
            }
            if (cur.length) out.push(cur);
            return out;
          };
          const line = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
          const hot = lineLook("target", DATA.hot);
          const cold = lineLook("target", DATA.cold);
          // 発表がない回はまとめて帯にし、言葉で書く。
          const gaps: { from: Slot; to: Slot; state: Slot["state"] }[] = [];
          for (const s of ss)
            if (s.state !== "ok") {
              const g = gaps.at(-1);
              if (g && g.state === s.state && ss.indexOf(g.to) === ss.indexOf(s) - 1) g.to = s;
              else gaps.push({ from: s, to: s, state: s.state });
            }
          return (
            <g key={kind}>
              <text x={0} y={top + 9} className="fh-lane">
                {KIND_NAME[kind]}
                <tspan className="fh-lane-sub">{kind === "VPFW50" ? "　1日の値（高知県・高知）" : "　日中の最高・朝の最低（中部・高知）"}</tspan>
              </text>
              {/* 気温の目盛り */}
              {Array.from({ length: Math.floor((hi - lo) / (hi - lo > 15 ? 10 : 5)) + 1 }, (_, i) => lo + i * (hi - lo > 15 ? 10 : 5)).map((v) => (
                <g key={v}>
                  <line x1={PAD_L} x2={W - PAD_R} y1={ty(v)} y2={ty(v)} className="fh-grid" />
                  <text x={PAD_L - 4} y={ty(v) + 3.5} className="fh-tick" textAnchor="end">
                    {v}
                  </text>
                </g>
              ))}
              <text x={PAD_L - 4} y={POP_TOP + 8} className="fh-tick" textAnchor="end">
                %
              </text>
              <line x1={PAD_L} x2={W - PAD_R} y1={POP_TOP + POP_H} y2={POP_TOP + POP_H} className="fh-grid" />
              {gaps.map((g, i) => {
                const x1 = x(g.from.at) - 5;
                const x2 = x(g.to.at) + 5;
                return (
                  <g key={i} className={`fh-gapband ${g.state}`} onClick={() => onSelect(g.from.key)}>
                    <rect x={x1} y={top + 12} width={x2 - x1} height={LANE_H - 18} rx={3} />
                    <text x={(x1 + x2) / 2} y={T_TOP + T_H / 2} textAnchor="middle" className="fh-gaptext" writingMode={x2 - x1 < 46 ? "tb" : undefined}>
                      {STATE_TEXT[g.state]}
                    </text>
                  </g>
                );
              })}
              {ss.map((s) => {
                if (s.state !== "ok" || !s.values) return null;
                const cx = x(s.at);
                const on = selected === s.key;
                const pops = s.kind === "VPFW50" ? [s.values.popDay] : s.values.pop6!;
                const bw = s.kind === "VPFW50" ? 7 : 2.4;
                return (
                  <g key={s.key} onClick={() => onSelect(s.key)} className={`fh-col${on ? " on" : ""}${s.changed.size ? "" : " quiet"}`}>
                    <rect x={cx - 7} y={top + 11} width={14} height={LANE_H - 16} className="fh-hit" />
                    {on && <rect x={cx - 7} y={top + 11} width={14} height={LANE_H - 16} rx={3} className="fh-colsel" />}
                    <foreignObject x={cx - 8} y={ICON_Y - 8} width={16} height={16}>
                      <Wx s={s} size={16} />
                    </foreignObject>
                    {s.changed.has("weather") && <circle cx={cx} cy={ICON_Y + 10} r={1.6} className="fh-dot" />}
                    {pops.map((p, i) => {
                      const v = vNum(p);
                      if (v == null) return null;
                      const h = (v / 100) * POP_H;
                      const bx = s.kind === "VPFW50" ? cx - bw / 2 : cx - 5.2 + i * 2.8;
                      return <rect key={i} x={bx} y={POP_TOP + POP_H - h} width={bw} height={Math.max(h, 0.8)} rx={0.6} fill="var(--data-rain)" />;
                    })}
                    {s.kind === "VPFW50" && s.changed.has("pop") && vNum(s.values.popDay) != null && (
                      <text x={cx} y={POP_TOP + POP_H - ((vNum(s.values.popDay) ?? 0) / 100) * POP_H - 2} className="fh-vlabel tone-rain" textAnchor="middle">
                        {vNum(s.values.popDay)}
                      </text>
                    )}
                    {/* 週間の予測範囲：細い縦線 */}
                    {(["max", "min"] as const).map((k) => {
                      const v = s.values![k];
                      return v.s === "value" && v.lower != null && v.upper != null ? (
                        <line key={k} x1={cx} x2={cx} y1={ty(v.upper)} y2={ty(v.lower)} stroke={`var(--data-${k === "max" ? "hot" : "cold"})`} strokeWidth={1} opacity={0.45} />
                      ) : null;
                    })}
                  </g>
                );
              })}
              {runs((s) => vNum(s.values?.max)).map((r, i) => (
                <path key={`h${i}`} d={line(r)} fill="none" stroke={hot.stroke} strokeWidth={hot.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {runs((s) => vNum(s.values?.min)).map((r, i) => (
                <path key={`c${i}`} d={line(r)} fill="none" stroke={cold.stroke} strokeWidth={cold.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {(["max", "min"] as const).flatMap((k) =>
                runs((s) => vNum(s.values?.[k])).flatMap((r) =>
                  r.map((p, i) => {
                    // 値の文字は、変わった点と最後の点だけ（前の点と同じ値は書かない）。
                    const show = p.s.changed.has(k) || (i === r.length - 1 && !(r.length > 1 && r[i - 1].s.changed.has(k) && vNum(r[i - 1].s.values?.[k]) === vNum(p.s.values?.[k])));
                    return (
                      <g key={`${k}${p.s.key}`}>
                        <circle cx={p.x} cy={p.y} r={p.s.changed.has(k) ? 2.6 : 1.8} fill={`var(--data-${k === "max" ? "hot" : "cold"})`} />
                        {show && (
                          <text x={p.x} y={k === "max" ? p.y - 5 : p.y + 11} textAnchor="middle" className={`fh-vlabel tone-${k === "max" ? "hot" : "cold"}`}>
                            {vNum(p.s.values?.[k])}
                          </text>
                        )}
                      </g>
                    );
                  }),
                ),
              )}
            </g>
          );
        })}
        {/* 時間の軸：日付の区切りと「何日前」 */}
        {days.map((d) => {
          const xd = x(`${d}T00:00:00+09:00`);
          if (xd < PAD_L - 1) return null;
          const lead = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
          return (
            <g key={d}>
              <line x1={xd} x2={xd} y1={0} y2={height - H_AXIS + 4} className="fh-dayline" />
              <text x={xd + 2} y={height - H_AXIS + 14} className="fh-tick">
                {md(d)}
              </text>
              <text x={xd + 2} y={height - H_AXIS + 26} className="fh-tick quiet">
                {leadLabel(lead)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
