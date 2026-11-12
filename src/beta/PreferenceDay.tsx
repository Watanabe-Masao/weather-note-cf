// #63 P4: the person's preferences on the day's conditions — which way they would want to feel,
// and which drink temperature they would choose — in the basis sheet, under the centre and range.
//
// While the rules of MATH-09 are not met (PREF_RULES), only the answers so far and what is still
// missing are shown, never an index. Once met: the index P(+1) − P(−1) with its 95% interval and
// the three probabilities; when the interval holds 0 it says so in words ("no clear lean") rather
// than showing a number as if it meant something. Like the centre, today's is shown only after the
// day's first report (anchoring). Nothing here changes the feeling model (MODEL_VERSION).

import { useContext, useMemo } from "react";
import type { WeatherStore } from "../data/store";
import { daytimeFeel, type FeelSettings } from "../../shared/feel";
import { DRINK_PREFERENCES, type Report, THERMAL_PREFERENCES } from "./reports";
import { fitPreference, PREF_DEFAULT, type PrefObs, predictPreference, preferenceLearning, preferenceObservations, type PreferenceKind } from "./preferenceModel";
import { useCentreVisible, useReports } from "./useReports";
import { baselineOf } from "./useBaseline";
import { BetaContext } from "./settings";
import { preferenceText } from "../flows/screenFlows";

const DAY = 86_400_000;
/** "Before" for the comparison with oneself: answers older than this many days. */
const PAST_DAYS = 21;

const KINDS: { kind: PreferenceKind; title: string; plus: string; minus: string; labels: readonly { id: string; label: string }[] }[] = [
  { kind: "thermal", title: "どう感じたいか", plus: "暖かくしたい", minus: "涼しくしたい", labels: THERMAL_PREFERENCES },
  { kind: "drink", title: "飲み物の温度", plus: "温かい飲み物", minus: "冷たい飲み物", labels: DRINK_PREFERENCES },
];


function One({ obs, past, k, e, a, now }: { obs: PrefObs[]; past: PrefObs[]; k: (typeof KINDS)[number]; e: number; a: number; now: number }) {
  const fit = useMemo(() => fitPreference(obs, { withFeeling: false, halfLifeDays: PREF_DEFAULT.halfLifeDays, now }), [obs, now]);
  const at = obs.length ? predictPreference(fit, { e, a }) : null;
  const lr = preferenceLearning(obs, fit, at);
  const counts = [1, 0, -1].map((v) => obs.filter((o) => o.k === v).length) as [number, number, number];
  // Oneself before: the same conditions, from answers older than PAST_DAYS only.
  const pastFit = lr.show && at && past.length ? fitPreference(past, { withFeeling: false, halfLifeDays: PREF_DEFAULT.halfLifeDays, now: now - PAST_DAYS * DAY }) : null;
  const pastAt = pastFit ? predictPreference(pastFit, { e, a }) : null;
  const pastView = pastFit && pastAt ? { index: pastAt.index, shown: preferenceLearning(past, pastFit, pastAt).show } : null;
  // The words are decided in preferenceText (src/flows/screenFlows.ts, tested).
  return <li>{preferenceText(k, counts, at, lr, pastView, PAST_DAYS).text}</li>;
}

export function PreferenceDay({ store, station, date, feel }: { store: WeatherStore | null; station: string; date: string; feel: FeelSettings }) {
  const reports = useReports();
  const visible = useCentreVisible()(date);
  const rows = store?.getHours(station, date).rows ?? [];
  const e = daytimeFeel(rows, { ...feel, sun: true }, station) ?? daytimeFeel(rows, { ...feel, sun: false }, station);
  const beta = useContext(BetaContext);
  const base = baselineOf(store, station, date, beta.alpha);
  const now = useMemo(() => Date.now(), [reports]); // eslint-disable-line react-hooks/exhaustive-deps
  const obs = useMemo(() => Object.fromEntries(KINDS.map((k) => [k.kind, preferenceObservations((reports ?? []) as Report[], k.kind)])) as Record<PreferenceKind, PrefObs[]>, [reports]);
  // Oneself before: the reports older than PAST_DAYS read on their own, so their weights are those
  // they had then (a later report in a row does not change them).
  const past = useMemo(() => {
    const older = ((reports ?? []) as Report[]).filter((r) => Date.parse(r.at) < now - PAST_DAYS * DAY);
    return Object.fromEntries(KINDS.map((k) => [k.kind, preferenceObservations(older, k.kind)])) as Record<PreferenceKind, PrefObs[]>;
  }, [reports, now]);
  if (!reports) return null;
  return (
    <section className="basis-sec" aria-labelledby="basis-pref">
      <h4 id="basis-pref">
        この日の選好 <small className="set-help">β・試験中</small>
      </h4>
      {!visible ? (
        <p className="set-help">今日の選好は、今日の感じ方を記録した後に表示します（先に見ると、答えが引っ張られるため）。</p>
      ) : e == null || !base ? (
        <p className="basis-note">この日の肌感（日なた）か最近の基準が出せないため、出せません。</p>
      ) : (
        <>
          <ul className="basis-list">
            {KINDS.map((k) => (
              <One key={k.kind} obs={obs[k.kind]} past={past[k.kind]} k={k} e={e} a={base.value} now={now} />
            ))}
          </ul>
          <p className="basis-note">
            日中の肌感（日なた） {e.toFixed(1)}・最近の基準 {base.value.toFixed(1)}℃ のときの予測です。指数は「暖かい方を選ぶ確率 − 涼しい・冷たい方を選ぶ確率」（−1〜+1）。天気だけから出したもので、感じ方とは別に学んでいます。
          </p>
        </>
      )}
    </section>
  );
}
