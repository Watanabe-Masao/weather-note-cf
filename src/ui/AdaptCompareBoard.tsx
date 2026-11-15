// 慣れの比べ板（テスト） (Model Explorer の最初の比較, #189): the station's own days through the new
// core, with only the long baseline swapped — 慣れ-L1 (30日の単純平均) or 慣れ-L2 (重み付きの平均) —
// and the same boundary shift and seven-step judge on both (src/core/compare/adaptation.ts). Shows
// where the two part and how far the boundaries move apart; on a chosen day, the hours whose step
// changes. Nothing here changes the app's 肌感 or the models.

import { useContext, useEffect, useMemo, useState } from "react";
import { addDays } from "../../shared/dates";
import { type ComparedDay, compareAdaptation, dayOf, type Estimate, hourOf, LEVEL_NAMES, level7Settings, windPersonSettings } from "../core";
import { Priority } from "../data/plan";
import type { WeatherStore } from "../data/store";
import { DATA, LINE } from "../design/tokens";
import { FeelContext } from "./FeelBar";
import { SectionHead, Segmented } from "./kit";
import { ModalSheet } from "./ModalSheet";

const PERIODS = [
  { id: "30", label: "1か月" },
  { id: "91", label: "3か月" },
  { id: "365", label: "1年" },
] as const;
type Period = (typeof PERIODS)[number]["id"];
/** Days read before the period, so its first day already has a baseline (the longer of the two windows). */
const LEAD_DAYS = 60;
/** Month names on the axis: at least this far apart, and this far from the right end (viewBox units). */
const MONTH_GAP = 26;
const MONTH_END = 16;

const valueOf = (e: Estimate) => ("value" in e ? e.value : null);
const f1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const signed = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`);
const REASON: Record<string, string> = { tooShort: "前の日が足りない", missingInput: "材料がない", outOfDomain: "範囲の外", noRow: "行がない" };
const reasonText = (k: string) => k.replace(/\b(tooShort|missingInput|outOfDomain|noRow)\b/g, (m) => REASON[m] ?? m);

export function AdaptCompareBoard({ store, station, today, onClose }: { store: WeatherStore | null; station: string; today: string; onClose: () => void }) {
  const feel = useContext(FeelContext);
  const [period, setPeriod] = useState<Period>("91");
  const end = addDays(today, -1);
  const span = Number(period);
  const dates = useMemo(() => Array.from({ length: span + LEAD_DAYS }, (_, i) => addDays(end, i - span - LEAD_DAYS + 1)), [end, span]);
  const [chosen, setChosen] = useState(end);

  useEffect(() => {
    store?.prefetch(station, dates, "adapt-compare", Priority.Visible);
    return () => store?.prefetch(station, [], "adapt-compare");
  }, [store, station, dates]);
  useEffect(() => {
    store?.wantHours(station, [chosen], Priority.Visible, "adapt-compare");
    return () => store?.wantHours(station, [], Priority.Visible, "adapt-compare");
  }, [store, station, chosen]);

  const views = dates.map((d) => store?.getDay(station, d));
  const loaded = views.filter((v) => v?.state === "ready").length;
  const hourRows = store?.getHours(station, chosen).rows ?? [];

  const result = useMemo(() => {
    const days: ComparedDay[] = dates.map((d, i) => {
      const row = views[i]?.row;
      return {
        date: d,
        day: row ? dayOf(row, station) : null,
        hours: d === chosen ? hourRows.map((r) => hourOf(r, station)).filter((h) => h != null) : [],
      };
    });
    return compareAdaptation(days, { anemometerHeight: feel.stationHeight }, { feel: { windPerson: windPersonSettings(feel.alpha) }, level: level7Settings(feel.thresholds) });
    // `views` changes identity every render; its contents are keyed by `loaded`.
  }, [dates, loaded, chosen, hourRows, feel, station]);

  const shown = result.days.slice(LEAD_DAYS);
  const comparable = shown.filter((d) => d.delta != null);
  const largest = comparable.reduce<number | null>((m, d) => (m == null || Math.abs(d.delta!) > Math.abs(m) ? d.delta! : m), null);
  const leftOut = shown.length - comparable.length;
  const reasons = new Map<string, number>();
  for (const d of shown)
    if (d.delta == null) {
      const k = [`L1: ${"absent" in d.l1 ? d.l1.absent : "—"}`, `L2: ${"absent" in d.l2 ? d.l2.absent : "—"}`].filter((s) => !s.endsWith("—")).join("・") || "—";
      reasons.set(k, (reasons.get(k) ?? 0) + 1);
    }
  const day = result.days.find((d) => d.date === chosen);
  const hours = day?.hours ?? [];
  const differ = hours.filter((h) => h.differs).length;
  const judged = hours.filter((h) => valueOf(h.level1) != null && valueOf(h.level2) != null).length;

  // The two graphs share the days' axis.
  const W = 340, X0 = 30, X1 = W - 6;
  const xs = (i: number) => X0 + (shown.length > 1 ? (i / (shown.length - 1)) * (X1 - X0) : 0);
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((x - X0) / (X1 - X0)) * (shown.length - 1));
    const d = shown[Math.max(0, Math.min(shown.length - 1, i))];
    if (d) setChosen(d.date);
  };
  const ci = shown.findIndex((d) => d.date === chosen);

  // Graph 1: the day's mean, L1, L2.
  const H1 = 150, T1 = 8;
  const temps = shown.map((_, i) => views[i + LEAD_DAYS]?.row?.temp).map((v) => (typeof v === "number" ? v : null));
  const l1 = shown.map((d) => valueOf(d.l1));
  const l2 = shown.map((d) => valueOf(d.l2));
  const all = [...temps, ...l1, ...l2].filter((v): v is number => v != null);
  const lo = all.length ? Math.floor(Math.min(...all) / 5) * 5 : 0;
  const hi = all.length ? Math.ceil(Math.max(...all) / 5) * 5 : 30;
  const y1 = (v: number) => T1 + H1 - ((v - lo) / Math.max(5, hi - lo)) * H1;
  const path = (vs: (number | null)[], y: (v: number) => number) => {
    let d = "";
    let pen = false;
    vs.forEach((v, i) => {
      if (v == null) return void (pen = false);
      d += `${pen ? "L" : "M"}${xs(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const ticks1: number[] = [];
  for (let v = lo; v <= hi; v += 5) ticks1.push(v);

  // Graph 2: Δb around 0.
  const H2 = 90, T2 = 6;
  const dmax = Math.max(1, Math.ceil(Math.max(0, ...comparable.map((d) => Math.abs(d.delta!)))));
  const y2 = (v: number) => T2 + H2 / 2 - (v / dmax) * (H2 / 2);
  const bw = Math.max(1, (X1 - X0) / Math.max(1, shown.length) - 0.6);
  // Month names at each 1st; one never closer than MONTH_GAP to the one before, nor past the end.
  const monthTicks: { d: (typeof shown)[number]; i: number }[] = [];
  shown.forEach((d, i) => {
    if (!(d.date.endsWith("-01") || i === 0) || xs(i) > X1 - MONTH_END) return;
    const last = monthTicks.at(-1);
    if (last && xs(i) - xs(last.i) < MONTH_GAP) {
      if (last.i === 0) monthTicks.pop(); // the period's first day gives way to a real 1st
      else return;
    }
    monthTicks.push({ d, i });
  });

  const L1C = DATA.mean;
  const L2C = DATA.feel;

  return (
    <ModalSheet title="慣れの比べ方（テスト）" onClose={onClose} className="sun-test adapt-cmp">
      <div className="sun-test-body">
        <p className="set-lead">
          慣れ-L1（30日の単純平均）と慣れ-L2（重み付きの平均）だけを入れ替えて、ほかは同じ計算（境目のずれ・7段の判定）にしたとき、どこで違うかを見ます。アプリの表示とモデルは変えません。
        </p>
        <Segmented label="期間" value={period} options={PERIODS.map((p) => ({ id: p.id, label: p.label }))} onChange={setPeriod} />
        {loaded < dates.length && <p className="set-help">日別のデータを読み込んでいます…（{loaded}／{dates.length} 日）</p>}

        <div className="ds-lead adapt-cmp-lead">
          <p className="adapt-cmp-facts">
            <span>
              比べた日 <b>{comparable.length}</b> 日{leftOut ? `（比べられない ${leftOut} 日）` : ""}
            </span>
            <span>
              境目の差の最大 <b>{signed(largest)}</b>℃
            </span>
            <span>
              {chosen.slice(5).replace("-", "/")}：段が違った時間 <b>{differ}</b>／{judged}
            </span>
          </p>
        </div>

        <SectionHead title="気温と慣れ" />
        <svg width="100%" viewBox={`0 0 ${W} ${T1 + H1 + 18}`} role="img" aria-label="日平均気温と、慣れ L1・L2 の推移" onPointerDown={pick}>
          {ticks1.map((v) => (
            <g key={v}>
              <line x1={X0} x2={X1} y1={y1(v)} y2={y1(v)} stroke="var(--line-soft)" />
              <text x={X0 - 4} y={y1(v) + 3.5} textAnchor="end" className="lt-axis">
                {v}
              </text>
            </g>
          ))}
          {monthTicks.map(({ d, i }) => (
            <text key={d.date} x={xs(i)} y={T1 + H1 + 14} textAnchor="start" className="lt-axis">
              {Number(d.date.slice(5, 7))}月
            </text>
          ))}
          {ci >= 0 && <line x1={xs(ci)} x2={xs(ci)} y1={T1} y2={T1 + H1} stroke="var(--ink-secondary)" strokeWidth={1} />}
          <path d={path(temps, y1)} fill="none" stroke={LINE.reference} strokeOpacity={LINE.referenceOpacity} strokeWidth={1} />
          <path d={path(l1, y1)} fill="none" stroke={L1C} strokeWidth={2.2} />
          <path d={path(l2, y1)} fill="none" stroke={L2C} strokeWidth={2.2} />
        </svg>
        <p className="sun-test-legend">
          <Sample color={LINE.reference} opacity={LINE.referenceOpacity} width={1} label="日平均気温" />
          <Sample color={L1C} label="慣れ-L1（30日の単純平均）" />
          <Sample color={L2C} label="慣れ-L2（重み付きの平均、α 0.8）" />
        </p>

        <SectionHead title="境目の差（L2 − L1）" />
        <svg width="100%" viewBox={`0 0 ${W} ${T2 + H2 + 18}`} role="img" aria-label="7段の境目の差 L2 − L1" onPointerDown={pick}>
          {[dmax, 0, -dmax].map((v) => (
            <g key={v}>
              <line x1={X0} x2={X1} y1={y2(v)} y2={y2(v)} stroke={v === 0 ? "var(--ink-tertiary)" : "var(--line-soft)"} />
              <text x={X0 - 4} y={y2(v) + 3.5} textAnchor="end" className="lt-axis">
                {v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0"}
              </text>
            </g>
          ))}
          {monthTicks.map(({ d, i }) => (
            <text key={d.date} x={xs(i)} y={T2 + H2 + 14} textAnchor="start" className="lt-axis">
              {Number(d.date.slice(5, 7))}月
            </text>
          ))}
          {shown.map((d, i) =>
            d.delta == null ? null : (
              <rect key={d.date} x={xs(i) - bw / 2} width={bw} y={Math.min(y2(0), y2(d.delta))} height={Math.max(0.5, Math.abs(y2(d.delta) - y2(0)))} fill={L2C} opacity={d.date === chosen ? 1 : 0.6} />
            ),
          )}
          {ci >= 0 && <line x1={xs(ci)} x2={xs(ci)} y1={T2} y2={T2 + H2} stroke="var(--ink-secondary)" strokeWidth={1} />}
        </svg>
        <p className="set-help">上なら L2 の方が境目が高い（同じ肌感でも寒い側に判定されやすい）。グラフをタップするとその日を選びます。</p>

        <SectionHead title={`${chosen.slice(5).replace("-", "/")} の時間ごと`}>
          <small className="section-note">
            境目のずれ L1 {signed(day ? valueOf(day.shift1) : null)}・L2 {signed(day ? valueOf(day.shift2) : null)}℃
          </small>
        </SectionHead>
        {hours.length === 0 ? (
          <p className="set-help">時間ごとのデータを読み込んでいます…</p>
        ) : (
          <div className="sun-test-table">
            <table>
              <thead>
                <tr>
                  <th>時</th>
                  <th>肌感（日かげ）</th>
                  <th>L1 の段</th>
                  <th>L2 の段</th>
                </tr>
              </thead>
              <tbody>
                {hours.map((h) => {
                  const a = valueOf(h.level1);
                  const b = valueOf(h.level2);
                  return (
                    <tr key={h.hour} className={h.differs ? "adapt-cmp-diff" : undefined}>
                      <td>{h.hour}</td>
                      <td>{f1(valueOf(h.feel))}</td>
                      <td>{a == null ? "—" : LEVEL_NAMES[a]}</td>
                      <td>{b == null ? "—" : LEVEL_NAMES[b]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {reasons.size > 0 && (
          <>
            <SectionHead title="比べられない日" />
            <ul className="adapt-cmp-reasons">
              {[...reasons].map(([k, n]) => (
                <li key={k}>
                  {reasonText(k)}：{n} 日
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </ModalSheet>
  );
}

function Sample({ color, label, opacity = 1, width = 2.2 }: { color: string; label: string; opacity?: number; width?: number }) {
  return (
    <span>
      <svg width="22" height="8" aria-hidden>
        <line x1="1" x2="21" y1="4" y2="4" stroke={color} strokeOpacity={opacity} strokeWidth={width} />
      </svg>
      {label}
    </span>
  );
}
