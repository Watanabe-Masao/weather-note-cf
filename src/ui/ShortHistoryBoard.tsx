// 短期の履歴と答え（テスト） (S0, #189): one day's 肌感, its short history S and how fast it moved,
// hour by hour from the new core (plain/shortHistory.ts), with the person's own answers of that day
// on the same time axis. For looking, before any model: whether answers part from the 肌感 where S
// does — and on which days the 肌感 moved unusually (cooling by day, warming by night), the days that
// can tell the time of day from the history. Nothing here changes the app's 肌感 or the models.

import { useContext, useEffect, useMemo, useState } from "react";
import { addDays } from "../../shared/dates";
import { stationLatLon } from "../../shared/sunTimes";
import { useReports } from "../beta/useReports";
import { SENSATIONS, type Report } from "../beta/reports";
import { type Estimate, type Exposure, hourOf, shortHistories } from "../core";
import { Priority } from "../data/plan";
import type { WeatherStore } from "../data/store";
import { DATA, LINE } from "../design/tokens";
import { FeelContext } from "./FeelBar";
import { Glyph, SectionHead, Segmented } from "./kit";
import { ModalSheet } from "./ModalSheet";

const valueOf = (e: Estimate | undefined) => (e && "value" in e ? e.value : null);
const f1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const signed = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`);
/** Daytime and night for "unusual" moves (hours JMA-style): 10–16時 by day, 22–5時 by night. */
const DAY_HOURS = [11, 12, 13, 14, 15, 16];
const NIGHT_HOURS = [23, 24, 1, 2, 3, 4, 5];
/** A move counts when the 肌感 changes at least this fast against the day's usual way (℃/h). */
const UNUSUAL_RATE = 0.3;

/** The JMA hour (1–24) and date of a report: its snapshot's, else from when it was sent. */
function hourOfReport(r: Report): { date: string; hour: number } {
  if (r.snapshot) return { date: r.snapshot.date, hour: r.snapshot.hour };
  const jst = new Date(Date.parse(r.at) + 9 * 3_600_000);
  return { date: jst.toISOString().slice(0, 10), hour: jst.getUTCHours() + 1 };
}

export function ShortHistoryBoard({ store, station, today, onClose }: { store: WeatherStore | null; station: string; today: string; onClose: () => void }) {
  const feel = useContext(FeelContext);
  const reports = useReports();
  const answered = useMemo(
    () => (reports ?? []).filter((r) => r.station === station).map((r) => ({ r, ...hourOfReport(r) })),
    [reports, station],
  );
  const lastAnswered = answered.find((a) => a.date <= today)?.date ?? addDays(today, -1);
  const [date, setDate] = useState<string | null>(null);
  const day = date ?? lastAnswered;
  const [exposure, setExposure] = useState<Exposure>("shade");
  const prev = addDays(day, -1);

  useEffect(() => {
    store?.wantHours(station, [prev, day], Priority.Visible, "short-history");
    return () => store?.wantHours(station, [], Priority.Visible, "short-history");
  }, [store, station, prev, day]);
  const rowsPrev = store?.getHours(station, prev).rows ?? [];
  const rowsDay = store?.getHours(station, day).rows ?? [];

  const site = useMemo(() => ({ anemometerHeight: feel.stationHeight, ...(stationLatLon(station) ?? { lat: null, lon: null }) }), [feel.stationHeight, station]);
  // Both 日かげ and 日なた: the graph shows the one chosen, each answer is read with its own place.
  const both = useMemo(() => {
    const byHour = (rows: typeof rowsDay, d: string) => Array.from({ length: 24 }, (_, i) => rows.find((r) => r.n === i + 1)).map((r) => (r ? hourOf(r, station) : null)).map((h) => (h && h.date === d ? h : null));
    const all = [...byHour(rowsPrev, prev), ...byHour(rowsDay, day)];
    const of = (e: Exposure) => shortHistories(all, site, { alpha: feel.alpha, absorb: feel.absorb }, e).slice(24).map((o, i) => ({ hour: i + 1, ...o }));
    return { shade: of("shade"), sun: of("sun") };
  }, [rowsPrev, rowsDay, prev, day, site, feel.alpha, feel.absorb, station]);
  const hours = both[exposure];

  const answers = answered.filter((a) => a.date === day).sort((a, b) => a.hour - b.hour);
  const unusualDay = hours.filter((h) => DAY_HOURS.includes(h.hour) && (valueOf(h.rate) ?? 0) <= -UNUSUAL_RATE).length;
  const unusualNight = hours.filter((h) => NIGHT_HOURS.includes(h.hour) && (valueOf(h.rate) ?? 0) >= UNUSUAL_RATE).length;
  const daysWithAnswers = [...new Set(answered.map((a) => a.date))].sort();
  const step = (dir: -1 | 1) => {
    const list = daysWithAnswers;
    const i = list.indexOf(day);
    const next = i < 0 ? list.filter((d) => (dir < 0 ? d < day : d > day)).at(dir < 0 ? -1 : 0) : list[i + dir];
    if (next) setDate(next);
  };

  // The graph: 肌感 and S through the day, answers as dots on the 肌感.
  const W = 340, H = 140, X0 = 30, X1 = W - 6, T = 8;
  const xs = (n: number) => X0 + ((n - 1) / 23) * (X1 - X0);
  const vals = hours.flatMap((h) => [valueOf(h.feel), valueOf(h.short)]).filter((v): v is number => v != null);
  const lo = vals.length ? Math.floor(Math.min(...vals) / 5) * 5 : 0;
  const hi = vals.length ? Math.ceil(Math.max(...vals) / 5) * 5 : 30;
  const ys = (v: number) => T + H - ((v - lo) / Math.max(5, hi - lo)) * H;
  const path = (pick: (h: (typeof hours)[number]) => number | null) => {
    let d = "", pen = false;
    for (const h of hours) {
      const v = pick(h);
      if (v == null) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${xs(h.hour).toFixed(1)},${ys(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += 5) ticks.push(v);
  // The rate: bars around 0.
  const H2 = 60, T2 = 10;
  const rmax = Math.max(1, Math.ceil(Math.max(0, ...hours.map((h) => Math.abs(valueOf(h.rate) ?? 0)))));
  const y2 = (v: number) => T2 + H2 / 2 - (v / rmax) * (H2 / 2);
  const bw = (X1 - X0) / 24 - 2;
  const at = (n: number) => hours.find((h) => h.hour === n);
  /** An answer's own place: 日なた or 日かげ; at night (not asked) the two are the same; 半々 has no 肌感 of its own. */
  const atFor = (n: number, place: Report["exposure"]) => (place === "mixed" ? undefined : both[place === "sun" ? "sun" : "shade"].find((h) => h.hour === n));
  const label = (s: number) => SENSATIONS.find((x) => x.value === s)?.label ?? "—";

  return (
    <ModalSheet title="短期の履歴と答え（テスト）" onClose={onClose} className="sun-test short-hist">
      <div className="sun-test-body">
        <p className="set-lead">
          その日の時間ごとの肌感と、前の時間の重み付き平均（短期の履歴 S）・変化の速さを、自分の答えと同じ時間の軸に並べます。モデルを作る前に、答えが肌感から離れる所で S も離れているかを見ます。アプリの表示とモデルは変えません。
        </p>
        <div className="sun-test-nav">
          <button className="chip sm" onClick={() => step(-1)} aria-label="答えのある前の日">
            <Glyph name="prev" size="12px" />
          </button>
          <b>{day}</b>
          <button className="chip sm" onClick={() => step(1)} aria-label="答えのある次の日">
            <Glyph name="next" size="12px" />
          </button>
        </div>
        <Segmented label="肌感" value={exposure} options={[{ id: "shade", label: "日かげ" }, { id: "sun", label: "日なた" }]} onChange={setExposure} />

        <div className="ds-lead">
          <p className="history-cmp-facts">
            <span>
              この日の答え <b>{answers.length}</b> 件
            </span>
            <span>
              いつもと違う動き：昼に冷えた時間 <b>{unusualDay}</b>・夜に暖まった時間 <b>{unusualNight}</b>
            </span>
          </p>
        </div>

        <SectionHead title="肌感と短期の履歴" />
        {rowsDay.length === 0 ? (
          <p className="set-help">時間ごとのデータを読み込んでいます…</p>
        ) : (
          <>
            <svg width="100%" viewBox={`0 0 ${W} ${T + H + 18}`} role="img" aria-label="肌感と短期の履歴 S の1日の推移、答えの時刻">
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={X0} x2={X1} y1={ys(v)} y2={ys(v)} stroke="var(--line-soft)" />
                  <text x={X0 - 4} y={ys(v) + 3.5} textAnchor="end" className="lt-axis">
                    {v}
                  </text>
                </g>
              ))}
              {/* JMA's hour n ends at n o'clock: 6時 under hour 6. The ends are left to the axis. */}
              {[6, 12, 18].map((n) => (
                <text key={n} x={xs(n)} y={T + H + 14} textAnchor="middle" className="lt-axis">
                  {n}時
                </text>
              ))}
              <path d={path((h) => valueOf(h.short))} fill="none" stroke={LINE.reference} strokeOpacity={LINE.referenceOpacity} strokeWidth={1.6} />
              <path d={path((h) => valueOf(h.feel))} fill="none" stroke={DATA.feel} strokeWidth={2.2} />
              {answers.map((a) => {
                const v = valueOf(at(a.hour)?.feel);
                return v == null ? null : <circle key={a.r.id} cx={xs(a.hour)} cy={ys(v)} r={4.5} fill="var(--surface-sheet, #1c2a3d)" stroke="var(--ink-primary)" strokeWidth={2} />;
              })}
            </svg>
            <p className="sun-test-legend">
              <Line color={DATA.feel} label={`肌感（${exposure === "sun" ? "日なた" : "日かげ"}）`} />
              <Line color={LINE.reference} opacity={LINE.referenceOpacity} width={1.6} label="短期の履歴 S（半減3時間）" />
              <span>
                <svg width="22" height="10" aria-hidden>
                  <circle cx="11" cy="5" r="4" fill="none" stroke="var(--ink-primary)" strokeWidth="2" />
                </svg>
                答えた時間
              </span>
            </p>

            <SectionHead title="変化の速さ（3時間）" />
            <svg width="100%" viewBox={`0 0 ${W} ${T2 + H2 + 10}`} role="img" aria-label="肌感の変化の速さ">
              <line x1={X0} x2={X1} y1={y2(0)} y2={y2(0)} stroke="var(--ink-tertiary)" />
              <text x={X0 - 4} y={y2(rmax) + 3.5} textAnchor="end" className="lt-axis">
                +{rmax}
              </text>
              <text x={X0 - 4} y={y2(-rmax) + 3.5} textAnchor="end" className="lt-axis">
                −{rmax}
              </text>
              {hours.map((h) => {
                const v = valueOf(h.rate);
                return v == null ? null : <rect key={h.hour} x={xs(h.hour) - bw / 2} width={bw} y={Math.min(y2(0), y2(v))} height={Math.max(0.5, Math.abs(y2(v) - y2(0)))} fill={DATA.feel} opacity={0.65} />;
              })}
            </svg>
            <p className="set-help">上は暖かくなっている途中、下は寒くなっている途中（℃/時）。</p>
          </>
        )}

        <SectionHead title="この日の答え" />
        {answers.length === 0 ? (
          <p className="set-help">この日の答えはありません。◀ ▶ で答えのある日へ移ります。</p>
        ) : (
          <div className="sun-test-table">
            <table>
              <thead>
                <tr>
                  <th>時</th>
                  <th>答え</th>
                  <th>場所</th>
                  <th>肌感</th>
                  <th>S</th>
                  <th>肌感−S</th>
                  <th>速さ</th>
                </tr>
              </thead>
              <tbody>
                {answers.map((a) => {
                  const h = atFor(a.hour, a.r.exposure);
                  const fv = valueOf(h?.feel);
                  const sv = valueOf(h?.short);
                  return (
                    <tr key={a.r.id}>
                      <td>{a.hour}</td>
                      <td>{label(a.r.sensation)}</td>
                      <td>{a.r.exposure === "sun" ? "日なた" : a.r.exposure === "shade" ? "日かげ" : a.r.exposure === "mixed" ? "半々" : "夜"}</td>
                      <td>{f1(fv)}</td>
                      <td>{f1(sv)}</td>
                      <td>{signed(fv != null && sv != null ? fv - sv : null)}</td>
                      <td>{signed(valueOf(h?.rate))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="set-help">表の肌感・S・速さは、答えたときの場所（日なた・日かげ）の値です。半々は肌感を1つに決めないので「—」。グラフは上の切り替えの値です。</p>
      </div>
    </ModalSheet>
  );
}

function Line({ color, label, opacity = 1, width = 2.2 }: { color: string; label: string; opacity?: number; width?: number }) {
  return (
    <span>
      <svg width="22" height="8" aria-hidden>
        <line x1="1" x2="21" y1="4" y2="4" stroke={color} strokeOpacity={opacity} strokeWidth={width} />
      </svg>
      {label}
    </span>
  );
}
