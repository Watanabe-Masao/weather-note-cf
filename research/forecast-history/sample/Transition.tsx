// R6-1・R6-2 の見本：1日モードの③「この日の予報の移り変わり」。
// 案A 折れ線／案B 発表ごとの行（2段）／案C 変わり目だけ／組み合わせ（上に案A の小さなグラフ、下に案B、案C は絞り込み）。

import { Fragment, type ReactNode, useRef, useState } from "react";
import { DATA, lineLook } from "../../../src/design/tokens";
import { Glyph, Segmented } from "../../../src/ui/kit";
import { svgTextSize, useDrawnWidth } from "../../../src/ui/useDrawnWidth";
import { WeatherIcon } from "../../../src/ui/WeatherIcon";
import { hourOf, issueLabel, KIND_NAME, KIND_SHORT, type Kind, leadLabel, md, skyText, type Slot, STATE_NOTE, STATE_TEXT, type V } from "./model";
import { NOTE, Why } from "./Why";

export const vNum = (v: V | null | undefined) => (v && v.s === "value" ? Number(v.v) : null);

/** 1つの値：値／「—」（気象庁が出していない：値なし・項目なし、押すと理由）／空（対象期間外、押すと理由）。 */
export function Val({ v, unit, tone, changed, dim, range = false }: { v: V | null | undefined; unit?: string; tone?: string; changed?: boolean; dim?: boolean; range?: boolean }) {
  if (v === null)
    return (
      <Why note={NOTE.out} className="fh-out-btn">
        <span className="fh-out" />
      </Why>
    );
  if (!v || v.s === "absent")
    return (
      <Why note={NOTE.absent}>
        <span className="fh-dash">—</span>
      </Why>
    );
  if (v.s === "none")
    return (
      <Why note={NOTE.none}>
        <span className="fh-dash">—</span>
      </Why>
    );
  return (
    <span className={`fh-val${tone ? ` tone-${tone}` : ""}${changed ? " changed" : ""}${dim ? " dim" : ""}`}>
      {v.v}
      {unit && <small>{unit}</small>}
      {range && v.lower != null && v.upper != null && <small className="fh-range">{`${v.lower}〜${v.upper}`}</small>}
    </span>
  );
}

/** 天気の名前は「後・時々・一時」の前でだけ折り返す（くもり後｜雨 と切らない）。 */
export const breakable = (name: string) => name.replace(/(後|時々|一時)/g, "​$1");

/** 府県天気予報の6時間降水確率。4つとも「項目なし」（明後日など）なら「—」1つにする。 */
export function Pop6({ s }: { s: Slot }) {
  const p = s.values!.pop6!;
  if (p.every((v) => v && v.s === "absent")) return <Val v={{ s: "absent" }} />;
  return <>{p.map((v, i) => <Val key={i} v={v} tone="rain" changed={s.changed.has(`pop6-${i}`)} />)}</>;
}

const weatherOf = (s: Slot) => (s.values?.weather.s === "value" ? (s.values.weather as V & { name?: string; partial?: string | null }) : null);

export function Wx({ s, size = 20 }: { s: Slot; size?: number }) {
  const w = weatherOf(s);
  if (!w) {
    const v = s.values?.weather;
    return (
      <Why note={v && v.s === "none" ? NOTE.none : NOTE.absent}>
        <span className="fh-dash">—</span>
      </Why>
    );
  }
  return <WeatherIcon text={skyText(w.name ?? null)} size={size} />;
}

/** 発表がない回の札：「記録なし」「取れなかった」「取り消し」は言葉で出す（R5-1・R6-8）。押すと理由。 */
export function StateTag({ s, plain = false }: { s: Slot; plain?: boolean }) {
  if (s.state === "ok") return null;
  const tag = <span className={`fh-state ${s.state}`}>{STATE_TEXT[s.state]}</span>;
  if (plain) return tag;
  return <Why note={{ title: STATE_TEXT[s.state], text: STATE_NOTE[s.state] }}>{tag}</Why>;
}

/** 当日の発表は途中からの値なので比べない：変わらなかった、とも言わない。 */
const comparable = (s: Slot) => s.state === "ok" && s.lead > 0;

function SlotHead({ s, selected, onSelect }: { s: Slot; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`fh-when${selected ? " on" : ""}`} onClick={(e) => (e.stopPropagation(), onSelect())} aria-pressed={selected}>
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

/** 案B の1行（2段）：1段目に発表時刻と天気、2段目に降水確率と最高・最低。360 と 390 で同じ並び。 */
function SlotRow({ s, selected, onSelect, inRun = false }: { s: Slot; selected: string | null; onSelect: (k: string) => void; inRun?: boolean }) {
  const on = selected === s.key;
  const quiet = s.state === "ok" && s.changed.size === 0;
  if (s.state !== "ok" || !s.values)
    return (
      <div className={`fh-row gap${on ? " on" : ""}${inRun ? " inrun" : ""}`} role="row" onClick={() => onSelect(s.key)}>
        <SlotHead s={s} selected={on} onSelect={() => onSelect(s.key)} />
        <span className="fh-line1">
          <StateTag s={s} />
        </span>
      </div>
    );
  const w = weatherOf(s);
  const v = s.values;
  return (
    <div className={`fh-row${quiet ? " quiet" : ""}${on ? " on" : ""}${inRun ? " inrun" : ""}`} role="row" onClick={() => onSelect(s.key)}>
      <SlotHead s={s} selected={on} onSelect={() => onSelect(s.key)} />
      <span className="fh-line1 fh-wx">
        <Wx s={s} />
        <span className={`fh-wxname${s.changed.has("weather") ? " changed" : ""}`}>
          {breakable(w?.name ?? "—")}
          {w?.partial && <small>（{w.partial}）</small>}
        </span>
        {v.reliability && v.reliability.s === "value" && (
          <Why note={NOTE.reliability} className={`fh-rel${s.changed.has("reliability") ? " changed" : ""}`}>
            信頼度{String(v.reliability.v)}
          </Why>
        )}
      </span>
      <span className="fh-line2">
        <span className="fh-pop">
          <small className="fh-lbl">降水</small>
          {s.kind === "VPFW50" ? <Val v={v.popDay} unit="%" tone="rain" changed={s.changed.has("pop")} /> : <Pop6 s={s} />}
        </span>
        <span className="fh-temp">
          <small className="fh-lbl">最高</small>
          <Val v={v.max} tone="hot" changed={s.changed.has("max")} />
          <small className="fh-lbl">最低</small>
          <Val v={v.min} tone="cold" changed={s.changed.has("min")} />
        </span>
      </span>
      {v.max.s === "value" && v.max.lower != null && (
        <small className="fh-rangeline">
          予測範囲 最高 {v.max.lower}〜{v.max.upper}・最低 {v.min.s === "value" ? `${v.min.lower}〜${v.min.upper}` : "—"}
        </small>
      )}
    </div>
  );
}

type Group = { cat: "same" | Slot["state"]; run: Slot[] };

/**
 * 行をまとめる：同じ状態の空き（記録なしなど）が3回以上続くとき、
 * 「変わった発表だけ」のときは変わらなかった発表（当日の発表は比べないので除く）。
 */
function collapse(rows: Slot[], changedOnly: boolean): (Slot | Group)[] {
  const out: (Slot | Group)[] = [];
  let g: Group | null = null;
  let seenOk = false;
  const flush = () => {
    if (g) {
      if (g.cat === "same" || g.run.length >= 3) out.push(g);
      else out.push(...g.run);
    }
    g = null;
  };
  for (const s of rows) {
    const same = changedOnly && comparable(s) && s.changed.size === 0 && seenOk;
    if (s.state === "ok") seenOk = true;
    const cat: Group["cat"] | null = same ? "same" : s.state !== "ok" && s.state !== "cancelled" ? s.state : null;
    if (cat && g && g.cat === cat) {
      g.run.push(s);
      continue;
    }
    flush();
    if (cat) g = { cat, run: [s] };
    else out.push(s);
  }
  flush();
  return out;
}

/** まとめた行：押すと開いて1つずつ見られる。 */
function GroupRow({ g, open, onToggle }: { g: Group; open: boolean; onToggle: () => void }) {
  const a = g.run[0];
  const b = g.run[g.run.length - 1];
  return (
    <button className={`fh-grouprow${g.cat === "same" ? " same" : " gap"}`} onClick={onToggle} aria-expanded={open}>
      <span className="fh-grouprow-when">
        {issueLabel(a.at)}
        {g.run.length > 1 && <small>〜 {issueLabel(b.at)}</small>}
      </span>
      <span className="fh-grouprow-what">
        {g.cat === "same" ? <span className="fh-same">変わらなかった発表</span> : <StateTag s={a} plain />}
        <small className="fh-runn">{g.run.length}回</small>
      </span>
      <span className="fh-grouprow-open">
        {open ? "閉じる" : "開く"}
        <Glyph name={open ? "up" : "down"} />
      </span>
    </button>
  );
}

/** 案B：発表ごとの行。週間と府県天気予報は、区域も区切りも違うので別のまとまりにする。 */
export function TransitionTable({
  slots,
  selected,
  onSelect,
  actual,
  changedOnly = false,
  onShowAll,
}: {
  slots: Slot[];
  selected: string | null;
  onSelect: (k: string) => void;
  actual: ReactNode;
  changedOnly?: boolean;
  onShowAll?: () => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((o) => (o.has(k) ? new Set([...o].filter((x) => x !== k)) : new Set([...o, k])));
  const groups: { kind: Kind; items: (Slot | Group)[] }[] = (["VPFW50", "VPFD51"] as Kind[]).map((kind) => ({ kind, items: collapse(slots.filter((s) => s.kind === kind), changedOnly) }));
  const sameN = groups.flatMap((g) => g.items).reduce((n, it) => n + ("run" in it && it.cat === "same" ? it.run.length : 0), 0);
  return (
    <div className="fh-tbl" role="table" aria-label="発表ごとの予報">
      {changedOnly && <SameCount n={sameN} onShowAll={onShowAll} />}
      {groups.map((g) => (
        <Fragment key={g.kind}>
          <div className="fh-group" role="row">
            <span>{KIND_NAME[g.kind]}</span>
            <small>
              {g.kind === "VPFW50"
                ? "天気・降水は高知県、気温は高知。降水確率は1日"
                : "天気・降水は中部、気温は高知（日中の最高・朝の最低）。降水確率は6時間ごと（0・6・12・18時から）"}
            </small>
          </div>
          {g.items.map((it) => {
            if (!("run" in it)) return <SlotRow key={it.key} s={it} selected={selected} onSelect={onSelect} />;
            const k = `${it.cat}|${it.run[0].key}`;
            const isOpen = open.has(k) || it.run.some((s) => s.key === selected);
            return (
              <Fragment key={k}>
                <GroupRow g={it} open={isOpen} onToggle={() => toggle(k)} />
                {isOpen && it.run.map((s) => <SlotRow key={s.key} s={s} selected={selected} onSelect={onSelect} inRun />)}
              </Fragment>
            );
          })}
        </Fragment>
      ))}
      {actual}
    </div>
  );
}

/** 「変わらなかった発表 N 回」と、全部の発表に戻る操作。 */
function SameCount({ n, onShowAll }: { n: number; onShowAll?: () => void }) {
  return (
    <div className="fh-samecount">
      <span>
        変わらなかった発表 <b>{n}回</b>
        {n ? "（まとめた行を押すと開く）" : ""}
      </span>
      {onShowAll && (
        <button className="fh-linkbtn" onClick={onShowAll}>
          全部の発表を見る
        </button>
      )}
    </div>
  );
}

/** 案C：変わり目だけ。変わらなかった回はまとめて1行にし、押すと開く。 */
export function TransitionSteps({ slots, selected, onSelect, actual, onShowAll }: { slots: Slot[]; selected: string | null; onSelect: (k: string) => void; actual: ReactNode; onShowAll?: () => void }) {
  type Item = { kind: "step"; s: Slot; prev: Slot | null } | { kind: "same"; run: Slot[] } | { kind: "gap"; s: Slot } | { kind: "gaprun"; run: Slot[] };
  const [open, setOpen] = useState<Set<string>>(new Set());
  const items: Item[] = [];
  const last: Partial<Record<Kind, Slot>> = {};
  let run: Slot[] = [];
  let gaps: Slot[] = [];
  const flushGaps = () => {
    // 同じ状態の空きが3回以上続くときは1行にまとめる（案B と同じ）。
    if (gaps.length >= 3 && gaps[0].state !== "cancelled") items.push({ kind: "gaprun", run: gaps });
    else items.push(...gaps.map((s) => ({ kind: "gap" as const, s })));
    gaps = [];
  };
  const flush = () => {
    if (run.length) items.push({ kind: "same", run });
    run = [];
  };
  for (const s of slots) {
    if (s.state !== "ok") {
      flush();
      if (gaps.length && gaps[0].state !== s.state) flushGaps();
      gaps.push(s);
      continue;
    }
    flushGaps();
    const p = last[s.kind] ?? null;
    last[s.kind] = s;
    if (p && comparable(s) && !s.changed.size) {
      if (run.length && run[0].kind !== s.kind) flush();
      run.push(s);
      continue;
    }
    flush();
    items.push({ kind: "step", s, prev: p });
  }
  flush();
  flushGaps();
  const sameN = items.reduce((n, it) => n + (it.kind === "same" ? it.run.length : 0), 0);
  const body = (s: Slot) => (
    <span className="fh-step-body">
      <span className={`fh-wx${s.changed.has("weather") ? " changed" : ""}`}>
        <Wx s={s} size={18} />
        <span className="fh-wxname">{breakable(weatherOf(s)?.name ?? "—")}</span>
        {weatherOf(s)?.partial && <small>（{weatherOf(s)!.partial}）</small>}
      </span>
      <span className="fh-pop">
        <small className="fh-lbl">降水</small>
        {s.kind === "VPFW50" ? <Val v={s.values!.popDay} unit="%" tone="rain" changed={s.changed.has("pop")} /> : <Pop6 s={s} />}
      </span>
      <span className="fh-temp">
        <small className="fh-lbl">最高</small>
        <Val v={s.values!.max} tone="hot" changed={s.changed.has("max")} />
        <small className="fh-lbl">最低</small>
        <Val v={s.values!.min} tone="cold" changed={s.changed.has("min")} />
      </span>
    </span>
  );
  const step = (s: Slot, cls: string) => (
    <li key={s.key} className={`fh-step ${cls}${selected === s.key ? " on" : ""}`}>
      <button className="fh-step-btn" onClick={() => onSelect(s.key)} aria-pressed={selected === s.key}>
        <span className="fh-step-when">
          {issueLabel(s.at)}
          <small>
            {KIND_SHORT[s.kind]}・{leadLabel(s.lead)}
            {s.lead === 0 && "（比べない）"}
            {s.shown?.info_type === "訂正" && <span className="fh-tag fix">訂正</span>}
          </small>
        </span>
        {body(s)}
      </button>
    </li>
  );
  return (
    <div className="fh-stepsbox">
      <SameCount n={sameN} onShowAll={onShowAll} />
      <ol className="fh-steps">
        {items.map((it) => {
          if (it.kind === "gap")
            return (
              <li key={it.s.key} className={`fh-step gap${selected === it.s.key ? " on" : ""}`}>
                <button className="fh-step-btn" onClick={() => onSelect(it.s.key)} aria-pressed={selected === it.s.key}>
                  <span className="fh-step-when">
                    {issueLabel(it.s.at)}
                    <small>{KIND_SHORT[it.s.kind]}</small>
                  </span>
                  <StateTag s={it.s} plain />
                </button>
              </li>
            );
          if (it.kind === "step") return step(it.s, it.prev ? (it.s.changed.size ? "change" : "first") : "first");
          const k = `${it.kind}|${it.run[0].key}`;
          const isOpen = open.has(k) || it.run.some((s) => s.key === selected);
          return (
            <Fragment key={k}>
              <li className="fh-step same">
                <GroupRow
                  g={{ cat: it.kind === "same" ? "same" : it.run[0].state, run: it.run }}
                  open={isOpen}
                  onToggle={() => setOpen((o) => (o.has(k) ? new Set([...o].filter((x) => x !== k)) : new Set([...o, k])))}
                />
              </li>
              {isOpen &&
                it.run.map((s) =>
                  it.kind === "same" ? (
                    step(s, "inrun")
                  ) : (
                    <li key={s.key} className={`fh-step gap inrun${selected === s.key ? " on" : ""}`}>
                      <button className="fh-step-btn" onClick={() => onSelect(s.key)} aria-pressed={selected === s.key}>
                        <span className="fh-step-when">
                          {issueLabel(s.at)}
                          <small>{KIND_SHORT[s.kind]}</small>
                        </span>
                        <StateTag s={s} plain />
                      </button>
                    </li>
                  ),
                )}
            </Fragment>
          );
        })}
        {actual}
      </ol>
    </div>
  );
}

// ---- 案A：折れ線（週間と府県天気予報を別の段に、同じ時間の軸で） ----------------------------------
// 線にするのは数値（降水確率・気温）だけ。天気は絵を置くだけで線で結ばない。取得失敗などの空きで線を切る。
// 6時間の降水確率と1日の降水確率は別の段（同じ線にしない）。府県の6時間は、区切りを1つ選んで1本の線にする。

const W = 300;
const PAD_L = 26;
const PAD_R = 10;
const POP6_NAME = ["0〜6時", "6〜12時", "12〜18時", "18〜24時"];

export function TransitionChart({ slots, day, selected, onSelect, compact = false }: { slots: Slot[]; day: string; selected: string | null; onSelect: (k: string) => void; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drawn = useDrawnWidth(box);
  const [period, setPeriod] = useState<"0" | "1" | "2" | "3">("2");
  if (!slots.length) return null;
  const fsXs = svgTextSize("xs", W, drawn, 300);
  const fsSm = svgTextSize("sm", W, drawn, 300);
  const t0 = Date.parse(slots[0].at);
  const t1 = Date.parse(`${day}T18:00:00+09:00`);
  const x = (iso: string) => PAD_L + ((Date.parse(iso) - t0) / (t1 - t0)) * (W - PAD_L - PAD_R);
  // 気温の軸は2つの段で同じ（同じ℃を同じ高さに）。
  const temps = slots
    .flatMap((s) => [vNum(s.values?.max), vNum(s.values?.min), !compact && s.values?.max.s === "value" ? s.values.max.upper : null, !compact && s.values?.min.s === "value" ? s.values.min.lower : null])
    .filter((v): v is number => v != null);
  const lo = temps.length ? Math.floor(Math.min(...temps) / 5) * 5 : 0;
  const hi = temps.length ? Math.ceil(Math.max(...temps) / 5) * 5 : 30;
  const span = Math.max(hi - lo, 5);
  const lanes = (["VPFW50", "VPFD51"] as Kind[]).filter((k) => slots.some((s) => s.kind === k));
  const LANE_H = compact ? 136 : 168;
  const H_AXIS = 30;
  const height = lanes.length * LANE_H + H_AXIS;
  const days: string[] = [];
  for (let t = t0 - 86_400_000; t <= t1; t += 86_400_000) days.push(new Date(t + 9 * 3_600_000).toISOString().slice(0, 10));
  const pi = Number(period);
  const popOf = (s: Slot) => (s.kind === "VPFW50" ? s.values?.popDay : s.values?.pop6?.[pi]);

  // 押した所に一番近い発表（その段の中で）。押せる範囲は段の高さ全部。
  const pick = (e: React.PointerEvent<SVGRectElement>, kind: Kind) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const ss = slots.filter((s) => s.kind === kind);
    const near = ss.reduce((a, s) => (Math.abs(x(s.at) - p.x) < Math.abs(x(a.at) - p.x) ? s : a), ss[0]);
    if (near) onSelect(near.key);
  };
  const i = slots.findIndex((s) => s.key === selected);
  const cur = i >= 0 ? slots[i] : null;

  return (
    <div className={`fh-chart${compact ? " compact" : ""}`} ref={box}>
      {lanes.includes("VPFD51") && (
        <div className="fh-chart-ctl">
          <small>府県の降水確率</small>
          <Segmented label="府県の6時間降水確率の区切り" value={period} onChange={setPeriod} options={POP6_NAME.map((n, i) => ({ id: String(i) as "0", label: n }))} />
        </div>
      )}
      <svg
        ref={svg}
        width="100%"
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label="発表ごとの予報の移り変わり（折れ線）"
        style={{ ["--fs-xs" as string]: `${fsXs}px`, ["--fs-sm" as string]: `${fsSm}px` }}
      >
        {lanes.map((kind, li) => {
          const top = li * LANE_H;
          const ICON_Y = top + 26;
          const POP_TOP = top + 42;
          const POP_H = compact ? 26 : 34;
          const T_TOP = POP_TOP + POP_H + 14;
          const T_H = LANE_H - (T_TOP - top) - 10;
          const ty = (v: number) => T_TOP + T_H - ((v - lo) / span) * T_H;
          const py = (v: number) => POP_TOP + POP_H - (v / 100) * POP_H;
          const ss = slots.filter((s) => s.kind === kind);
          type P = { x: number; y: number; s: Slot };
          const runs = (get: (s: Slot) => number | null, y: (v: number) => number) => {
            const out: P[][] = [];
            let cur: P[] = [];
            for (const s of ss) {
              const v = s.state === "ok" ? get(s) : null;
              // 発表がない回（取得失敗・記録なし・取り消し）と値がない回で線を切る。
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
          const line = (pts: P[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
          const looks = { max: lineLook("target", DATA.hot), min: lineLook("target", DATA.cold), pop: lineLook("target", DATA.rain) };
          const series: { k: "max" | "min" | "pop"; get: (s: Slot) => number | null; y: (v: number) => number; changed: (s: Slot) => boolean; color: string; above: boolean }[] = [
            { k: "pop", get: (s) => vNum(popOf(s)), y: py, changed: (s) => (kind === "VPFW50" ? s.changed.has("pop") : s.changed.has(`pop6-${pi}`)), color: "var(--data-rain)", above: true },
            { k: "max", get: (s) => vNum(s.values?.max), y: ty, changed: (s) => s.changed.has("max"), color: "var(--data-hot)", above: true },
            { k: "min", get: (s) => vNum(s.values?.min), y: ty, changed: (s) => s.changed.has("min"), color: "var(--data-cold)", above: false },
          ];
          // 発表がない回はまとめて帯にし、言葉で書く。
          const gaps: { from: Slot; to: Slot; state: Slot["state"] }[] = [];
          for (const s of ss)
            if (s.state !== "ok") {
              const g = gaps.at(-1);
              if (g && g.state === s.state && ss.indexOf(g.to) === ss.indexOf(s) - 1) g.to = s;
              else gaps.push({ from: s, to: s, state: s.state });
            }
          // 目盛りの間は文字の高さより広く（重ならないように）。
          const step = [5, 10, 20].find((st) => (st / span) * T_H >= fsXs * 1.3) ?? 20;
          // 空きの帯の言葉：狭い帯は縦書き。隣どうしで重ならないよう、言葉の位置だけ少しずらす。
          const bandTop = POP_TOP - 4;
          const bandH = LANE_H - (POP_TOP - top) - 2;
          const labelX: number[] = [];
          gaps.forEach((g, i) => {
            const c = (x(g.from.at) + x(g.to.at)) / 2;
            labelX.push(i && labelX[i - 1] + fsXs * 1.15 > c && x(g.from.at) - x(gaps[i - 1].to.at) < 30 ? labelX[i - 1] + fsXs * 1.15 : c);
          });
          for (let i = labelX.length - 1; i >= 0; i--) if (labelX[i] > W - PAD_R - fsXs / 2) labelX[i] = Math.min(labelX[i], (labelX[i + 1] ?? W - PAD_R + fsXs * 0.6) - fsXs * 1.15);
          return (
            <g key={kind}>
              <text x={0} y={top + 11} className="fh-lane">
                {KIND_NAME[kind]}
                <tspan className="fh-lane-sub">{kind === "VPFW50" ? "　降水確率（1日）%・気温 ℃" : `　降水確率（${POP6_NAME[pi]}）%・気温 ℃`}</tspan>
              </text>
              {/* 降水確率の目盛り（0・100%） */}
              <line x1={PAD_L} x2={W - PAD_R} y1={py(0)} y2={py(0)} className="fh-grid" />
              <line x1={PAD_L} x2={W - PAD_R} y1={py(100)} y2={py(100)} className="fh-grid" />
              <text x={PAD_L - 4} y={py(100) + 4} className="fh-tick" textAnchor="end">
                100
              </text>
              <text x={PAD_L - 4} y={py(0) + 1} className="fh-tick" textAnchor="end">
                0
              </text>

              {/* 気温の目盛り */}
              {Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => lo + i * step).map((v) => (
                <g key={v}>
                  <line x1={PAD_L} x2={W - PAD_R} y1={ty(v)} y2={ty(v)} className="fh-grid" />
                  <text x={PAD_L - 4} y={ty(v) + 3.5} className="fh-tick" textAnchor="end">
                    {v}
                  </text>
                </g>
              ))}
              {gaps.map((g, i) => {
                const x1 = x(g.from.at) - 5;
                const x2 = x(g.to.at) + 5;
                return (
                  <g key={i} className={`fh-gapband ${g.state}`}>
                    <rect x={x1} y={bandTop} width={x2 - x1} height={bandH} rx={3} />
                    <text x={labelX[i]} y={x2 - x1 < 46 ? bandTop + bandH / 2 : T_TOP + T_H / 2} textAnchor="middle" dominantBaseline={x2 - x1 < 46 ? "central" : undefined} className="fh-gaptext" writingMode={x2 - x1 < 46 ? "tb" : undefined}>
                      {STATE_TEXT[g.state]}
                    </text>
                  </g>
                );
              })}
              {cur && cur.kind === kind && <rect x={x(cur.at) - 7} y={top + 14} width={14} height={LANE_H - 18} rx={3} className="fh-colsel" />}
              {/* 天気：絵を置くだけ（線で結ばない） */}
              {ss.map((s) =>
                s.state !== "ok" || !s.values ? null : (
                  <g key={s.key}>
                    <foreignObject x={x(s.at) - 8} y={ICON_Y - 8} width={16} height={16}>
                      <Wx s={s} size={16} />
                    </foreignObject>
                    {s.changed.has("weather") && <circle cx={x(s.at)} cy={ICON_Y + 10} r={1.6} className="fh-dot" />}
                  </g>
                ),
              )}
              {/* 週間の予測範囲：細い縦線 */}
              {!compact &&
                ss.flatMap((s) =>
                  s.state !== "ok" || !s.values
                    ? []
                    : (["max", "min"] as const).map((k) => {
                        const v = s.values![k];
                        return v.s === "value" && v.lower != null && v.upper != null ? (
                          <line key={`${s.key}${k}`} x1={x(s.at)} x2={x(s.at)} y1={ty(v.upper)} y2={ty(v.lower)} stroke={`var(--data-${k === "max" ? "hot" : "cold"})`} strokeWidth={1} opacity={0.45} />
                        ) : null;
                      }),
                )}
              {series.map((sr) =>
                runs(sr.get, sr.y).map((r, i) => (
                  <path key={`${sr.k}${i}`} d={line(r)} fill="none" stroke={looks[sr.k].stroke} strokeWidth={looks[sr.k].strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
                )),
              )}
              {series.flatMap((sr) =>
                runs(sr.get, sr.y).flatMap((r) => {
                  // 値の文字は、変わった点と最後の点だけ。近すぎる文字は、新しい方（右）を残して省く（重ねない）。
                  const want = r.map((p, i) => (!compact ? sr.changed(p.s) || i === r.length - 1 : i === r.length - 1));
                  let keptX = Infinity;
                  for (let i = r.length - 1; i >= 0; i--) {
                    if (!want[i]) continue;
                    if (keptX - r[i].x < fsXs * 1.7) want[i] = false;
                    else keptX = r[i].x;
                  }
                  return r.map((p, i) => {
                    const show = want[i];
                    const v = sr.get(p.s);
                    return (
                      <g key={`${sr.k}${p.s.key}`}>
                        <circle cx={p.x} cy={p.y} r={sr.changed(p.s) ? 2.6 : 1.8} fill={sr.color} />
                        {show && (
                          <text x={p.x} y={sr.above ? p.y - 5 : p.y + 12} textAnchor="middle" className={`fh-vlabel tone-${sr.k === "pop" ? "rain" : sr.k === "max" ? "hot" : "cold"}`}>
                            {v}
                          </text>
                        )}
                      </g>
                    );
                  });
                }),
              )}
              {/* 押す場所：段の高さ全部。押した所に一番近い発表を選ぶ */}
              <rect x={0} y={top} width={W} height={LANE_H} className="fh-hit" onPointerUp={(e) => pick(e, kind)} />
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
              <text x={xd + 2} y={height - H_AXIS + 15} className="fh-tick">
                {md(d)}
              </text>
              <text x={xd + 2} y={height - H_AXIS + 28} className="fh-tick quiet">
                {leadLabel(lead)}
              </text>
            </g>
          );
        })}
      </svg>
      {/* 発表を1つずつ選ぶ（押せる範囲 44px）。グラフを押すと一番近い発表が選ばれる。 */}
      <div className="fh-stepper">
        <button className="fh-navbtn" aria-label="前の発表" onClick={() => onSelect(slots[i > 0 ? i - 1 : slots.length - 1].key)} disabled={i === 0}>
          <Glyph name="prev" />
        </button>
        <span className="fh-stepper-now">
          {cur ? (
            <>
              <b>{issueLabel(cur.at)}</b> {KIND_SHORT[cur.kind]}・{leadLabel(cur.lead)}
              {cur.state !== "ok" && (
                <>
                  {" "}
                  <StateTag s={cur} plain />
                </>
              )}
            </>
          ) : (
            <span className="fh-note">グラフか ‹ › で発表を選ぶ</span>
          )}
        </span>
        <button className="fh-navbtn" aria-label="次の発表" onClick={() => onSelect(slots[i >= 0 && i < slots.length - 1 ? i + 1 : i >= 0 ? i : 0].key)} disabled={i === slots.length - 1}>
          <Glyph name="next" />
        </button>
      </div>
    </div>
  );
}
