// β②: "今の感じ方を記録". Three choices (how it feels on the 7-point scale, sun or shade, wind) and one button; the
// station's values for the hour, the 最近の基準 and the differences are attached automatically.

import { useContext, useEffect, useState } from "react";
import { addDays } from "../../shared/dates";
import { Priority } from "../data/plan";
import type { WeatherStore } from "../data/store";
import { FeelContext } from "../ui/FeelBar";
import { Segmented } from "../ui/kit";
import { ModalSheet, useSheetClose } from "../ui/ModalSheet";
import { departures, historyDays } from "./adaptation";
import { type Exposure, EXPOSURES, jstHourOf, newId, RECENT_DAYS, recentDay, type Report, type Sensation, SENSATIONS, type Sky, SKIES, snapshotOf, type WindFelt, WINDS } from "./reports";
import { BetaContext } from "./settings";
import { type ComfortPrediction, predictComfort } from "./comfort";
import { baselineOf, baselineStateOf, driversOfDay, historyOf } from "./useBaseline";
import { reports } from "./useReports";

interface Props {
  store: WeatherStore | null;
  station: string;
  today: string;
  onClose: () => void;
  onSaved?: () => void;
}

function Body({ store, station, today, onSaved }: Omit<Props, "onClose">) {
  const close = useSheetClose();
  const feel = useContext(FeelContext);
  const beta = useContext(BetaContext);
  const [sensation, setSensation] = useState<Sensation | null>(null);
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [windFelt, setWindFelt] = useState<WindFelt | null>(null);
  const [sky, setSky] = useState<Sky | null>(null);
  // Opened now; sent maybe much later (from a notification): both are kept, and the prediction is
  // computed again at sending, from the values of that moment.
  const [openedAt] = useState(() => new Date().toISOString());
  // Wind is taken as an amount over time (the last 6 and 12 hours, last night), so yesterday's hours are needed too.
  const yesterday = addDays(today, -1);
  useEffect(() => {
    store?.wantHours(station, [yesterday, today], Priority.Visible, "report");
    return () => store?.wantHours(station, [], Priority.Visible, "report");
  }, [store, station, yesterday, today]);
  const yesterdayHours = store?.getHours(station, yesterday).rows ?? null;
  const [saving, setSaving] = useState(false);
  // Wait for the past days (the summary asked for them), so the report carries its full history.
  const loading = baselineStateOf(store, station, today, beta.alpha).state === "loading";
  const ready = sensation != null && exposure != null && windFelt != null && sky != null && !loading;

  /**
   * The comfort model's prediction for a moment: the station's hour then, the place and wind
   * chosen, and the centre and range of that moment (comfort.ts).
   */
  const predictAt = (now: number) => {
    if (exposure == null || windFelt == null) return null;
    const snap = snapshotOf(store?.getHours(station, today).rows ?? null, jstHourOf(now), feel, yesterdayHours);
    const e = !snap ? null : exposure === "sun" ? snap.sunTemp : exposure === "shade" ? snap.shadeTemp : snap.sunTemp == null || snap.shadeTemp == null ? null : (snap.sunTemp + snap.shadeTemp) / 2;
    const sunny = sky == null ? null : sky === "clear" || sky === "sunny";
    const x = driversOfDay(store, station, today, beta.alpha, e, snap?.humidity ?? null, { radDay: snap?.radDay ?? null, hour: snap?.hour ?? null, sky: sunny, wind6h: snap?.wind6h ?? null, windLastNight: snap?.windLastNight ?? null });
    return x ? predictComfort(beta.ens, { ...x, windFelt }, now) : null;
  };
  const preview = predictAt(Date.now());

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    const now = Date.now();
    const hours = store?.getHours(station, today).rows ?? null;
    const base = baselineOf(store, station, today, beta.alpha);
    const dep = departures(store?.getDay(station, today).row, hours, base, feel);
    const comfort = predictAt(now) ?? undefined; // recomputed at sending
    const report: Report = {
      id: newId(),
      at: new Date(now).toISOString(),
      openedAt,
      comfort,
      station,
      sensation,
      exposure,
      windFelt,
      sky,
      snapshot: snapshotOf(hours, jstHourOf(now), feel, yesterdayHours),
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
              {/* Break where the words break, so seven fit a phone's width. */}
              {s.label.replace(/^(やや|どちら)/, "$1\n")}
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <span className="set-label">いる場所</span>
        <Segmented label="日なたか日かげか" value={exposure ?? ("" as Exposure)} options={EXPOSURES.map((e) => ({ id: e.id, label: e.label }))} onChange={setExposure} />
      </div>
      <div className="set-row">
        <span className="set-label">風</span>
        <Segmented label="風の感じ" value={windFelt ?? ("" as WindFelt)} options={WINDS.map((w) => ({ id: w.id, label: w.label }))} onChange={setWindFelt} />
      </div>
      <PredictionCard prediction={preview} reported={sensation} />
      <div className="set-row">
        <span className="set-label">今の天気</span>
        <Segmented label="今の天気" value={sky ?? ("" as Sky)} options={SKIES.map((k) => ({ id: k.id, label: k.label }))} onChange={setSky} />
        <small className="set-help">見たままの空。その時刻の予報の天気は自動で添えるので、あとで予報と実際を突き合わせられます。</small>
      </div>
      <button className="report-save" disabled={!ready || saving} onClick={() => void save()}>
        {loading ? "過去の気温を読み込み中…" : ready ? "記録する" : "4つとも選ぶと記録できます"}
      </button>
    </div>
  );
}

/**
 * The data's prediction, shown once the feeling has been chosen: shown before, it would pull the
 * answer towards itself and spoil the very misses the model learns from.
 */
function PredictionCard({ prediction, reported }: { prediction: ComfortPrediction | null; reported: Sensation | null }) {
  if (reported == null) return <p className="predict-card waiting">感じ方を選ぶと、データからの予測と比べられます。</p>;
  if (!prediction) return <p className="predict-card waiting">いる場所と風を選ぶと、データからの予測が出ます（その時刻の観測値や最近の基準がないときは出せません）。</p>;
  const { state: st } = prediction;
  const maxP = Math.max(...prediction.probs);
  return (
    <div className="predict-card" role="status">
      <p>
        データからの予測 <b>{labelOf(prediction.mode)}</b>
        <span className="predict-num">（{Math.round(maxP * 100)}%・期待値 {prediction.expected > 0 ? "+" : ""}{prediction.expected.toFixed(1)}）</span>
      </p>
      <div className="predict-bars" aria-label="7段階それぞれの確率">
        {prediction.probs.map((p, k) => (
          <span key={k} className={k - 3 === reported ? "mine" : k - 3 === prediction.mode ? "mode" : undefined} title={`${labelOf(k - 3)} ${Math.round(p * 100)}%`}>
            <i style={{ height: `${Math.max(2, (p / maxP) * 100)}%` }} />
            <small>{Math.round(p * 100)}</small>
          </span>
        ))}
      </div>
      <p className="predict-sub">
        今の快適の中心 {st.mu.toFixed(1)}℃・範囲 {(st.mu - st.h).toFixed(1)}〜{(st.mu + st.h).toFixed(1)}℃。その場の温度は中心から {prediction.offset > 0 ? "+" : ""}
        {prediction.offset.toFixed(1)}℃{prediction.beyond === 0 ? "（範囲の中）" : `（範囲の外 ${prediction.beyond > 0 ? "+" : ""}${prediction.beyond.toFixed(1)}℃）`}。記録 {prediction.n}件から学習。
      </p>
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
