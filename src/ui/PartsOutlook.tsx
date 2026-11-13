// 朝・夕方の見込み (#118, everyday side): how the morning and the evening of a coming day will feel,
// in words. The parts are the sun's (shared/dayParts.ts), as on the hour graph. With β learned, the
// person's own: the likeliest level and, when close, the next one ("たぶん涼しい（寒いかも）"), with
// how sure it is. Otherwise, and for today before the day's first report, the app's levels.
// Words only: what to wear differs from person to person (渡辺さん, 2026-11-13).

import { useContext, useState } from "react";
import { BasisSheet } from "../beta/BasisSheet";
import { muIntervalOf } from "../beta/comfort";
import { dayParts, hoursIn } from "../../shared/dayParts";
import { levelOf, type Level, stepOf } from "../../shared/feel";
import type { WeatherStore } from "../data/store";
import { hourSeries } from "../dayDetail";
import { probabilities } from "../beta/comfort";
import { useDayComfortState } from "../beta/useDayComfort";
import { whyLine, whyTerms } from "../beta/engine/why";
import { dateLabel } from "../design/format";
import { FeelContext, levelColor, levelName } from "./FeelBar";

const OUTLOOK_PARTS = ["morning", "evening"] as const;
/** The next level is named when it has at least this probability. */
export const NEXT_SHOWN = 0.25;

/** How sure, from the likeliest step's probability: 3 dots ≥ 0.7, 2 ≥ 0.5, else 1. */
export const sureness = (p: number) => (p >= 0.7 ? 3 : p >= 0.5 ? 2 : 1);

/** The likeliest step and the next one (when close) on the shown scale, from 7-level probabilities. */
export function outlookWords(probs: number[], scale: 7 | 5 | 3): { first: number; second: number | null; p: number } {
  const steps = new Map<number, number>();
  probs.forEach((v, k) => {
    const s = stepOf(k as Level, scale);
    steps.set(s, (steps.get(s) ?? 0) + v);
  });
  const ranked = [...steps.entries()].sort((a, b) => b[1] - a[1]);
  const [first, p] = ranked[0];
  const next = ranked[1];
  return { first, second: next && next[1] >= NEXT_SHOWN ? next[0] : null, p };
}

export function PartsOutlook({ store, station, date, today }: { store: WeatherStore | null; station: string; date: string; today: string }) {
  const feel = useContext(FeelContext);
  const [basis, setBasis] = useState(false);
  const scale = feel.scale ?? 7;
  const hours = store?.getHours(station, date);
  const comfort = useDayComfortState(store, station, date >= today ? date : null, hours?.rows, "outlook");
  if (date < today || hours?.state !== "ready") return null;
  const series = hourSeries(hours.rows, "feel", feel);
  const parts = dayParts(date, station).filter((p) => (OUTLOOK_PARTS as readonly string[]).includes(p.id));
  const items = parts.map((part) => {
    const vs = hoursIn(part)
      .map((n) => series[n - 1]?.v)
      .filter((v): v is number => v != null);
    if (!vs.length) return { part, e: null as number | null };
    return { part, e: vs.reduce((a, b) => a + b, 0) / vs.length };
  });
  if (items.every((i) => i.e == null)) return null;
  const mine = comfort.st && !comfort.hidden ? comfort.st : null;
  const stepName = (s: number) => {
    const lv = ([0, 1, 2, 3, 4, 5, 6] as Level[]).find((l) => stepOf(l, scale) === s) ?? 3;
    return { name: levelName(lv, feel.scale), color: levelColor(lv, feel.scale) };
  };
  return (
    <section className="outlook" aria-label={`${dateLabel(date, { weekday: true })}の朝と夕方の見込み`}>
      <h4>
        {date === today ? "今日" : dateLabel(date, { weekday: true })}の見込み
        <small>{mine ? "あなた（β）" : "従来版"}・肌感（{feel.sun ? "日なた" : "日かげ"}）</small>
      </h4>
      <div className="outlook-rows">
        {items.map(({ part, e }) => {
          if (e == null)
            return (
              <div key={part.id} className="outlook-row">
                <span className="outlook-part">{part.label}</span>
                <span className="outlook-none">—</span>
              </div>
            );
          if (mine) {
            const w = outlookWords(probabilities(mine, e), scale);
            const a = stepName(w.first), b = w.second == null ? null : stepName(w.second);
            const dots = sureness(w.p);
            return (
              <div key={part.id} className="outlook-row">
                <span className="outlook-part">{part.label}</span>
                <span className="outlook-word">
                  <i style={{ background: a.color }} />
                  {dots === 3 ? "" : "たぶん"}
                  {a.name}
                  {b && <small>（{b.name}かも）</small>}
                </span>
                <span className="outlook-sure" aria-label={`確かさ ${dots}/3`}>
                  {"●".repeat(dots)}
                  {"○".repeat(3 - dots)}
                </span>
              </div>
            );
          }
          const lv = levelOf(e, feel);
          return (
            <div key={part.id} className="outlook-row">
              <span className="outlook-part">{part.label}</span>
              <span className="outlook-word">
                <i style={{ background: levelColor(lv, feel.scale) }} />
                {levelName(lv, feel.scale)}
              </span>
              <span className="outlook-sure">肌感 {e.toFixed(1)}</span>
            </div>
          );
        })}
      </div>
      {mine && comfort.ens && comfort.x && (() => {
        const why = whyLine(whyTerms(comfort.ens, comfort.x));
        return why ? (
          <p className="outlook-why">
            <b>なぜ</b> {why}。
          </p>
        ) : null;
      })()}
      {comfort.hidden && <p className="basis-note">あなた（β）の見込みは、今日の最初の記録の後に出ます。</p>}
      {mine && comfort.ens && comfort.x && (() => {
        // Two kinds of uncertainty, kept apart (#118): the person's own value (narrows with answers) and the forecast's (not in).
        const [lo, hi] = muIntervalOf(comfort.ens, comfort.x);
        return (
          <p className="basis-note">
            予報の肌感に、記録から学んだあなたの段を当てた見込みです（β・検証中）。確かさは ●●● ほど確か。ぶれは2つあります：あなたのちょうどよいの中心の幅 ±{((hi - lo) / 2).toFixed(1)}（答えが増えると狭まります）と、予報そのもののぶれ（ここには入っていません）。
          </p>
        );
      })()}
      {mine && (
        <button className="chip sm outlook-basis" onClick={() => setBasis(true)}>
          計算の根拠を見る
        </button>
      )}
      {basis && <BasisSheet store={store} station={station} target={date} other={null} onClose={() => setBasis(false)} />}
    </section>
  );
}
