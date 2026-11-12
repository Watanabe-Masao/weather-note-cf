// β②: "今の感じ方を記録". Three choices (how it feels on the 7-point scale, sun or shade, wind) and one button; the
// station's values for the hour, the 最近の基準 and the differences are attached automatically.

import { useContext, useEffect, useState } from "react";
import { addDays } from "../../shared/dates";
import { cachedSun, loadSun } from "../data/sun";
import { Priority } from "../data/plan";
import type { WeatherStore } from "../data/store";
import { FeelContext } from "../ui/FeelBar";
import { Segmented } from "../ui/kit";
import { ModalSheet, useSheetClose } from "../ui/ModalSheet";
import { departures, historyDays } from "./adaptation";
import { reportMoment, DRINK_PREFERENCES, type DrinkPreference, PREFERENCE_VERSION, THERMAL_PREFERENCES, type ThermalPreference, SCALE_VERSION, type Exposure, EXPOSURES, newId, RECENT_DAYS, recentDay, type Report, type Sensation, SENSATIONS, type Sky, SKIES, snapshotOf, type WindFelt, WINDS } from "./reports";
import { BetaContext } from "./settings";
import { inputQuality } from "./quality";
import { bandOf, centreUnknown, type ComfortPrediction, LEARNING_LABELS, LEARNING_RULES, type LearningView, predictComfort, TIME_BANDS } from "./comfort";
import { baselineOf, baselineStateOf, driversOfDay, historyOf, useBaselineHistory } from "./useBaseline";
import { reports } from "./useReports";

interface Props {
  store: WeatherStore | null;
  station: string;
  today: string;
  onClose: () => void;
  onSaved?: () => void;
  /** When a notification asked for this report (ms), if it was opened from one. */
  notifiedAt?: number;
}

function Body({ store, station, today, onSaved, notifiedAt }: Omit<Props, "onClose">) {
  const close = useSheetClose();
  const feel = useContext(FeelContext);
  const beta = useContext(BetaContext);
  const [sensation, setSensation] = useState<Sensation | null>(null);
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [windFelt, setWindFelt] = useState<WindFelt | null>(null);
  const [sky, setSky] = useState<Sky | null>(null);
  const [thermal, setThermal] = useState<ThermalPreference | null>(null);
  const [drink, setDrink] = useState<DrinkPreference | null>(null);
  // Opened now; sent maybe much later (from a notification): both are kept, and the prediction is
  // computed again at sending, from the values of that moment.
  const [openedAt] = useState(() => new Date().toISOString());
  // Wind is taken as an amount over time (the last 6 and 12 hours, last night), so yesterday's hours are needed too.
  const yesterday = addDays(today, -1);
  // The past days for the 最近の基準 (opened from the header or a notification, no summary has asked yet).
  useBaselineHistory(store, station, [today], "report-baseline");
  useEffect(() => {
    store?.wantHours(station, [addDays(today, -2), yesterday, today], Priority.Visible, "report");
    // Sunrise and sunset, kept with the report (day and night by the sun).
    void loadSun(station, today);
    void loadSun(station, yesterday);
    return () => store?.wantHours(station, [], Priority.Visible, "report");
  }, [store, station, yesterday, today]);
  /**
   * The station's moment for a report at `now`. JMA counts 0:00 as 24時 of the day before, so a
   * report in the 0時台 reads the day before's 24時 (and its 10-minute values), not a forecast of
   * tonight's 24時 (review 2026-11-12).
   */
  // From `now` itself, so a sheet left open over midnight reads the right day (review 2026-11-12).
  const snapAt = (now: number, withRetrieved = false) => {
    const m = reportMoment(now);
    const held = store?.getHours(station, m.day);
    return snapshotOf(held?.rows ?? null, m.hour, feel, store?.getHours(station, m.before).rows ?? null, withRetrieved ? held?.fetchedAt : undefined, {
      latest: store?.getLatest(station) ?? null,
      now,
      sun: cachedSun(station, m.day) ?? null,
      station,
    });
  };
  const [saving, setSaving] = useState(false);
  // Wait for the past days (the summary asked for them), so the report carries its full history.
  const loading = baselineStateOf(store, station, today, beta.alpha).state === "loading";
  // The prediction must be the model's real one, made from this moment's values: wait until the
  // models have learnt from this person's reports and today's hours have arrived (opened cold from a
  // notification, neither is there yet). A failed fetch (offline) does not block: the report is
  // saved without a prediction, and says so.
  const hoursState = store?.getHours(station, today).state ?? "empty";
  const waitingFor = loading ? "過去の気温を読み込み中…" : !beta.learned ? "これまでの記録から学習中…" : hoursState === "empty" ? "今日の観測を読み込み中…" : null;
  const ready = sensation != null && exposure != null && windFelt != null && sky != null && waitingFor == null;

  /**
   * The comfort model's prediction for a moment: the station's hour then, the place and wind
   * chosen, and the centre and range of that moment (comfort.ts).
   */
  const predictAt = (now: number) => {
    if (exposure == null || windFelt == null) return null;
    const snap = snapAt(now);
    const e = !snap ? null : exposure === "sun" ? snap.sunTemp : exposure === "shade" ? snap.shadeTemp : snap.sunTemp == null || snap.shadeTemp == null ? null : (snap.sunTemp + snap.shadeTemp) / 2;
    const sunny = sky == null ? null : sky === "clear" || sky === "sunny";
    const x = driversOfDay(store, station, today, beta.alpha, e, snap?.humidity ?? null, { radDay: snap?.radDay ?? null, at: now, sun: snap ? { sunrise: snap.sunrise, sunset: snap.sunset, date: snap.date } : null, sky: sunny, wind6h: snap?.wind6h ?? null, windLastNight: snap?.windLastNight ?? null });
    return x ? predictComfort(beta.ens, { ...x, windFelt }, now, beta.learning.state) : null;
  };
  const preview = predictAt(Date.now());
  // Whether this report would teach the model (quality.ts): said before sending, so a report made
  // on a forecast or a stale hour is not mistaken for one that counts.
  const quality = (() => {
    const snap = snapAt(Date.now());
    return inputQuality({ at: new Date().toISOString(), snapshot: snap, history: [0], baseline: null } as unknown as Report);
  })();

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    const now = Date.now();
    const hours = store?.getHours(station, today).rows ?? null;
    const base = baselineOf(store, station, today, beta.alpha);
    const dep = departures(store?.getDay(station, today).row, hours, base, feel, station);
    const comfort = predictAt(now) ?? undefined; // recomputed at sending
    const report: Report = {
      id: newId(),
      at: new Date(now).toISOString(),
      openedAt,
      ...(notifiedAt ? { notifiedAt: new Date(notifiedAt).toISOString() } : {}),
      scaleVersion: SCALE_VERSION,
      comfort,
      station,
      sensation,
      exposure,
      windFelt,
      sky,
      ...(thermal ? { thermalPreference: thermal } : {}),
      ...(drink ? { drinkPreference: drink } : {}),
      preferenceVersion: PREFERENCE_VERSION,
      snapshot: snapAt(now, true),
      baseline: base ? { ...base, alpha: beta.alpha } : null,
      departures: dep ? { air: dep.air, sun: dep.sun, shade: dep.shade } : null,
      history: store ? historyOf(store, station, today).map((p) => (p.forecast ? null : p.mean)) : [],
      recent: historyDays(today)
        .slice(0, RECENT_DAYS)
        .map((d) => {
          const day = store?.getDay(station, d);
          return recentDay(d, day?.row, day?.kind ?? null);
        }),
      updatedAt: now,
    };
    await reports.add(report);
    onSaved?.();
    close();
  };

  return (
    <div className="report-form">
      <p className="set-lead">今いる場所の様子を選んでください。観測所の気温・湿度・風・日射、その時刻の予報、直近7日の天気・湿度・日射、最近の基準は自動で添えます。</p>
      <div className="set-row">
        <span className="set-label">感じ方</span>
        <div className="report-scale" role="radiogroup" aria-label="感じ方">
          {SENSATIONS.map((s) => (
            <button
              key={s.value}
              role="radio"
              aria-label={s.label}
              aria-checked={sensation === s.value}
              className={sensation === s.value ? "report-pick on" : "report-pick"}
              onClick={() => setSensation(s.value)}
            >
              {/* Two lines where the word is long, so seven fit a phone's width. */}
              {s.label.replace("ちょうどよい", "ちょうど\nよい")}
            </button>
          ))}
        </div>
      </div>
      {/* #63 P1: what is wanted, apart from what is felt. Optional; tap the chosen one again to clear. */}
      <div className="set-row">
        <span className="set-label">
          今より、どう感じたいですか<small className="set-help">（任意）</small>
        </span>
        <Segmented label="今より、どう感じたいか" value={thermal ?? ("" as ThermalPreference)} options={THERMAL_PREFERENCES.map((t) => ({ id: t.id, label: t.label }))} onChange={setThermal} onReselect={() => setThermal(null)} />
      </div>
      <div className="set-row">
        <span className="set-label">
          今飲むとしたら、どの温度の飲み物を選びますか<small className="set-help">（任意）</small>
        </span>
        <Segmented label="今飲むとしたら、どの温度の飲み物か" value={drink ?? ("" as DrinkPreference)} options={DRINK_PREFERENCES.map((d) => ({ id: d.id, label: d.label }))} onChange={setDrink} onReselect={() => setDrink(null)} />
        <small className="set-help">飲み物の種類や味ではなく、温度だけを考えてください。選んだものをもう一度押すと、答えない状態に戻ります。</small>
      </div>
      <div className="set-row">
        <span className="set-label">いる場所</span>
        <Segmented label="日なたか日かげか" value={exposure ?? ("" as Exposure)} options={EXPOSURES.map((e) => ({ id: e.id, label: e.label }))} onChange={setExposure} />
      </div>
      <div className="set-row">
        <span className="set-label">風</span>
        <Segmented label="風の感じ" value={windFelt ?? ("" as WindFelt)} options={WINDS.map((w) => ({ id: w.id, label: w.label }))} onChange={setWindFelt} />
      </div>
      <PredictionCard prediction={preview} reported={sensation} learning={beta.learning} station={station} />
      <div className="set-row">
        <span className="set-label">今の天気</span>
        <Segmented label="今の天気" value={sky ?? ("" as Sky)} options={SKIES.map((k) => ({ id: k.id, label: k.label }))} onChange={setSky} />
        <small className="set-help">見たままの空。その時刻の予報の天気は自動で添えるので、あとで予報と実際を突き合わせられます。</small>
      </div>
      {waitingFor == null && !quality.trainable && (
        <p className="report-quality warn">この記録は保存しますが、学習には使いません（{quality.reason}）。</p>
      )}
      <button className="report-save" disabled={!ready || saving} onClick={() => void save()}>
        {waitingFor ?? (ready ? "記録する" : "4つとも選ぶと記録できます")}
      </button>
    </div>
  );
}

/** Where in the range the moment sits, in words (z = (E′ − μ)/h; the range is |z| ≤ 1). */
function placeWords(z: number): string {
  if (z < -1) return "ちょうどよい範囲より寒い側";
  if (z > 1) return "ちょうどよい範囲より暑い側";
  if (z < -0.4) return "ちょうどよい範囲の寒い側寄り";
  if (z > 0.4) return "ちょうどよい範囲の暑い側寄り";
  return "ちょうどよい範囲の中ほど";
}

/**
 * The data's prediction, shown once the feeling has been chosen: shown before, it would pull the
 * answer towards itself and spoil the very misses the model learns from. It is always computed and
 * kept with the report; while the centre is not yet known (未学習・情報不足) only the answers'
 * distribution is shown, never a centre temperature that the reports have not yet given.
 */
function PredictionCard({ prediction, reported, learning, station }: { prediction: ComfortPrediction | null; reported: Sensation | null; learning: LearningView; station: string }) {
  if (reported == null) return <p className="predict-card waiting">感じ方を選ぶと、データからの予測と比べられます。</p>;
  if (!prediction) return <p className="predict-card waiting">いる場所と風を選ぶと、データからの予測が出ます（その時刻の観測値や最近の基準がないときは出せません）。</p>;
  const { state: st } = prediction;
  const maxP = Math.max(...prediction.probs);
  const unknown = centreUnknown(learning.state);
  const pct = (v: number | undefined) => `${Math.round((v ?? 0) * 100)}%`;
  return (
    <div className="predict-card" role="status">
      <p className="predict-state">
        <span className={`learn-tag ${learning.state}`}>{LEARNING_LABELS[learning.state]}</span>
        {learning.state === "untrained"
          ? "あなたの記録がまだないので、初期値による参考です。"
          : learning.state === "sparse"
            ? "ちょうどよい温度はまだ特定できません。"
            : learning.state === "provisional"
              ? "推定の幅がまだ広い、暫定の予測です。"
              : learning.state === "testable"
                ? "事前の予測を検証している段階です。"
                : "事前の予測が、過去の答えの割合より当たっています。"}
      </p>
      <p>
        {unknown ? "答えの分布" : "データからの予測"} <b>{labelOf(prediction.mode)}</b>
        <span className="predict-num">（{Math.round(maxP * 100)}%）</span>
      </p>
      <div className="predict-bars" aria-label="7段階それぞれの確率">
        {prediction.probs.map((p, k) => (
          <span key={k} className={k - 3 === reported ? "mine" : k - 3 === prediction.mode ? "mode" : undefined} title={`${labelOf(k - 3)} ${Math.round(p * 100)}%`}>
            <i style={{ height: `${Math.max(2, (p / maxP) * 100)}%` }} />
            <small>{Math.round(p * 100)}</small>
          </span>
        ))}
      </div>
      {prediction.sides && (
        <p className="predict-sides">
          寒い側 <b>{pct(prediction.sides.cold)}</b>・ちょうどよい <b>{pct(prediction.sides.neutral)}</b>・暑い側 <b>{pct(prediction.sides.warm)}</b>
        </p>
      )}
      {unknown ? (
        <p className="predict-sub">まだ足りないもの：{learning.missing.join("、")}。</p>
      ) : (
        <p className="predict-sub">
          ちょうどよい温度 {st.mu.toFixed(1)}℃
          {prediction.muInterval ? `（95%：${prediction.muInterval[0].toFixed(1)}〜${prediction.muInterval[1].toFixed(1)}℃）` : ""}
          。今は{prediction.z != null ? placeWords(prediction.z) : "—"}
          {prediction.zInterval ? `（位置 ${prediction.z?.toFixed(1)}、95%：${prediction.zInterval[0].toFixed(1)}〜${prediction.zInterval[1].toFixed(1)}。±1が範囲の端）` : ""}。
        </p>
      )}
      {learning.bands && learning.state !== "untrained" && (() => {
        // #62 B: a prediction for a band with few reports rests on the other bands.
        const band = TIME_BANDS.find((b) => b.id === bandOf(Date.now(), station))!;
        const n = learning.bands[band.id];
        return n < LEARNING_RULES.minPerBand ? (
          <p className="predict-sub">
            {band.label}の記録はまだ少なく（{n}件分）、この予測は主にほかの時間帯の記録からです。服装や活動が違う時間帯では外れやすくなります。
          </p>
        ) : null;
      })()}
      {prediction.spread && (
        <p className="predict-sub">
          予測の幅：答えそのもののばらつき ±{prediction.spread.answer.toFixed(1)}段、推定の不確かさ ±{prediction.spread.param.toFixed(1)}段。記録 {prediction.n}件から学習。
        </p>
      )}
      <p className="predict-sub">枠があなたの答え、塗りが最も確率の高い段階です。送信した時刻の観測値で計算し直して記録します。</p>
    </div>
  );
}

const labelOf = (v: number) => SENSATIONS.find((s) => s.value === v)?.label ?? "";

export function ReportSheet(props: Props) {
  return (
    <ModalSheet title="今の感じ方を記録 β" onClose={props.onClose} className="report-sheet" size="fit">
      <Body {...props} />
    </ModalSheet>
  );
}
