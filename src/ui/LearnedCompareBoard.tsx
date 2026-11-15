// 学習あり版を比べる（テスト） (#189, #117): the person's own answers, one step ahead, through the new
// core — the plain version, the answers' shares alone, the ordinal model without the short history
// (base) and with it (S1) — on the same answers. Shows the scores and whether S1 beat base, the only
// way the short history can be said to matter (principles 7). Nothing is stored and nothing changes
// the app's 肌感 or the models; the hypotheses' status is the person's to change.

import { useContext, useEffect, useMemo, useState } from "react";
import { addDays } from "../../shared/dates";
import { stationLatLon } from "../../shared/sunTimes";
import { type Report, SCALE_VERSION } from "../beta/reports";
import { useReports } from "../beta/useReports";
import { type Case, type CaseInputs, caseInputs, compareScores, dayOf, hourOf, plainLevelPredictor, type Predictor, prequential, type ScoreComparison } from "../core";
import { climatologyPredictor, ordinalPredictor } from "../core/learned";
import { Priority } from "../data/plan";
import type { WeatherStore } from "../data/store";
import { FeelContext } from "./FeelBar";
import { Button, SectionHead } from "./kit";
import { ModalSheet } from "./ModalSheet";

/** Days of the long history read before each answer (the plain shift's 30-day window). */
const HISTORY_DAYS = 30;
const SENSATION_OFFSET = 3; // sensation −3…3 → step 0…6

function placeOf(r: Report): { date: string; hour: number } {
  if (r.snapshot) return { date: r.snapshot.date, hour: r.snapshot.hour };
  const jst = new Date(Date.parse(r.at) + 9 * 3_600_000);
  return { date: jst.toISOString().slice(0, 10), hour: jst.getUTCHours() + 1 };
}

const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "—");
const signed3 = (v: number) => (Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(3)}` : "—");
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

export function LearnedCompareBoard({ store, station, onClose }: { store: WeatherStore | null; station: string; onClose: () => void }) {
  const feel = useContext(FeelContext);
  const reports = useReports();
  const answers = useMemo(
    () => (reports ?? []).filter((r) => r.station === station && (r.scaleVersion ?? 1) === SCALE_VERSION).map((r) => ({ r, ...placeOf(r) })),
    [reports, station],
  );
  const otherScale = (reports ?? []).filter((r) => r.station === station && (r.scaleVersion ?? 1) !== SCALE_VERSION).length;
  const dates = useMemo(() => [...new Set(answers.map((a) => a.date))].sort(), [answers]);
  const hourDates = useMemo(() => [...new Set(dates.flatMap((d) => [addDays(d, -1), d]))], [dates]);
  const dayDates = useMemo(() => (dates.length ? Array.from({ length: Math.round((Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / 86_400_000) + HISTORY_DAYS + 1 }, (_, i) => addDays(dates[0], i - HISTORY_DAYS)) : []), [dates]);

  useEffect(() => {
    store?.prefetch(station, dayDates, "learned-compare", Priority.Visible);
    store?.wantHours(station, hourDates, Priority.Prefetch, "learned-compare");
    return () => {
      store?.prefetch(station, [], "learned-compare");
      store?.wantHours(station, [], Priority.Prefetch, "learned-compare");
    };
  }, [store, station, dayDates, hourDates]);
  const hoursReady = hourDates.filter((d) => store?.getHours(station, d).state === "ready").length;
  const daysReady = dayDates.filter((d) => store?.getDay(station, d).state === "ready").length;
  const ready = hoursReady === hourDates.length && daysReady === dayDates.length;

  const [run, setRun] = useState<{ scored: ReturnType<typeof prequential<CaseInputs>>; used: number; noFeel: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const site = useMemo(() => ({ anemometerHeight: feel.stationHeight, ...(stationLatLon(station) ?? { lat: null, lon: null }) }), [feel.stationHeight, station]);
  const predictors: Predictor<CaseInputs>[] = useMemo(
    () => [
      plainLevelPredictor,
      climatologyPredictor,
      ordinalPredictor({ id: "learned.ordinal.base", thresholds: feel.thresholds, useShort: false }),
      ordinalPredictor({ id: "learned.ordinal.s1", thresholds: feel.thresholds, useShort: true }),
    ],
    [feel.thresholds],
  );

  const compute = () => {
    setBusy(true);
    // Let the button show it is working before the long loop.
    setTimeout(() => {
      const hoursOf = (d: string) => Array.from({ length: 24 }, (_, i) => store?.getHours(station, d).rows.find((r) => r.n === i + 1)).map((r) => (r ? hourOf(r, station) : null)).map((h) => (h && h.date === d ? h : null));
      const cases: Case<CaseInputs>[] = answers.map(({ r, date, hour }) => {
        const hours = [...hoursOf(addDays(date, -1)), ...hoursOf(date)];
        const before = Array.from({ length: HISTORY_DAYS }, (_, i) => store?.getDay(station, addDays(date, -(i + 1))).row).map((row) => (row ? dayOf(row, station) : null));
        const place = r.exposure === "sun" || r.exposure === "shade" || r.exposure === "mixed" ? r.exposure : null;
        return { id: r.id, at: Date.parse(r.at), date, answer: r.sensation + SENSATION_OFFSET, inputs: caseInputs(hours, 24 + hour - 1, before, place, site, feel, feel.thresholds) };
      });
      const scored = prequential(cases, predictors);
      setRun({ scored, used: cases.filter((c) => "value" in c.inputs.feel).length, noFeel: cases.filter((c) => !("value" in c.inputs.feel)).length });
      setBusy(false);
    }, 30);
  };

  // Every row on the same answers: those every predictor could say something about.
  const common = run ? run.scored.filter((x) => predictors.every((p) => x.by[p.id])) : [];
  const rows = run
    ? predictors.map((p) => {
        const s = common;
        const vsPlain = p.id === plainLevelPredictor.id ? null : compareScores(run.scored, plainLevelPredictor.id, p.id);
        return { p, n: s.length, rps: s.reduce((a, x) => a + x.by[p.id]!.rps, 0) / (s.length || 1), hits: s.filter((x) => x.by[p.id]!.hit).length, vsPlain };
      })
    : [];
  const s1VsBase: ScoreComparison | null = run ? compareScores(run.scored, "learned.ordinal.base", "learned.ordinal.s1") : null;
  // Learned anything from the weather at all? Only if S1 beats the answers' shares alone (principles 7).
  const s1VsShares: ScoreComparison | null = run ? compareScores(run.scored, climatologyPredictor.id, "learned.ordinal.s1") : null;
  const LABEL: Record<string, string> = {
    [plainLevelPredictor.id]: "学習なし版（段）",
    [climatologyPredictor.id]: "答えの割合だけ",
    "learned.ordinal.base": "順序 base",
    "learned.ordinal.s1": "順序 S1（短期の履歴）",
  };
  const interval = (c: ScoreComparison | null) => (c?.interval ? `${signed3(c.interval[0])}〜${signed3(c.interval[1])}` : "—");

  return (
    <ModalSheet title="学習あり版を比べる（テスト）" onClose={onClose} className="sun-test learned-cmp">
      <div className="sun-test-body">
        <p className="set-lead">
          自分の答えを時間の順に並べ、1件ごとに、それより前の答えだけで学んで次の答えを予測し、点を付けます。点は RPS（外れの大きさ、小さいほどよい）。短期の履歴が効いたと言えるのは、S1 が base にも「答えの割合だけ」にも勝ったとき（差の幅がすべて 0 より下）だけです。アプリの表示とモデルは変えません。
        </p>
        <div className="ds-lead">
          <p className="history-cmp-facts">
            <span>
              答え <b>{answers.length}</b> 件（{dates.length} 日）{otherScale ? `・言葉の違う古い答え ${otherScale} 件は除く` : ""}
            </span>
            {run && (
              <span>
                予測に使えた <b>{run.used}</b> 件{run.noFeel ? `（肌感なし ${run.noFeel} 件：半々・材料の欠け）` : ""}
              </span>
            )}
            {!ready && (
              <span>
                データを読み込んでいます…（日別 {daysReady}／{dayDates.length}、時間ごと {hoursReady}／{hourDates.length}）
              </span>
            )}
          </p>
        </div>
        <Button kind="primary" block busy={busy} onClick={compute} disabled={!ready || busy || answers.length === 0}>
          {run ? "もう一度比べる" : "比べる"}
        </Button>

        {run && s1VsBase && (
          <>
            <SectionHead title="短期の履歴は効いたか（S1 と base）" />
            {(() => {
              const weatherLearned = !!(s1VsShares?.interval && s1VsShares.interval[1] < 0);
              const shortHelps = !!(s1VsBase.interval && s1VsBase.interval[1] < 0);
              const head =
                s1VsBase.interval == null
                  ? "答えが2日分に満たないので、まだ言えません。"
                  : !weatherLearned
                    ? "まだ言えません：S1 は「答えの割合だけ」の予測に勝っていないので、天気から学べているとは言えません。"
                    : shortHelps
                      ? "効いた：S1 は base より外れが小さく、差の幅もすべて 0 より下です。"
                      : s1VsBase.interval[0] > 0
                        ? "S1 の方が外れが大きい：短期の履歴の項は、この答えでは邪魔になっています。"
                        : "効いたとは言えません：差の幅が 0 をまたいでいます。";
              return (
                <p className={`learned-verdict${weatherLearned && shortHelps ? " yes" : ""}`}>
                  {head}
                  <small>
                    S1 − base：{signed3(s1VsBase.diff)}（幅 {interval(s1VsBase)}）・{s1VsBase.n} 件・{s1VsBase.days} 日
                  </small>
                  {s1VsShares && (
                    <small>
                      S1 − 答えの割合だけ：{signed3(s1VsShares.diff)}（幅 {interval(s1VsShares)}）
                    </small>
                  )}
                </p>
              );
            })()}

            <SectionHead title="予測ごとの点" />
            <div className="sun-test-table">
              <table>
                <thead>
                  <tr>
                    <th className="learned-name">予測</th>
                    <th>件</th>
                    <th>RPS</th>
                    <th>当たり</th>
                    <th>学習なし版との差</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.p.id}>
                      <td className="learned-name">{LABEL[x.p.id] ?? x.p.id}</td>
                      <td>{x.n}</td>
                      <td>{f3(x.rps)}</td>
                      <td>{pct(x.hits, x.n)}</td>
                      <td>{x.vsPlain ? `${signed3(x.vsPlain.diff)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="set-help">どの行も、4つの予測がそろって点を付けられた同じ答え（{common.length} 件）の上。差は「その予測 − 学習なし版」。マイナスならその予測の方がよい。幅は日を単位にした95%の範囲で、答えが少ないうちは広くなります。</p>
          </>
        )}
      </div>
    </ModalSheet>
  );
}
