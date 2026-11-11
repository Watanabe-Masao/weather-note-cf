// β②: "今の感じ方を記録". Three choices (how it feels on the 7-point scale, sun or shade, wind) and one button; the
// station's values for the hour, the 最近の基準 and the differences are attached automatically.

import { useContext, useState } from "react";
import type { WeatherStore } from "../data/store";
import { FeelContext } from "../ui/FeelBar";
import { Segmented } from "../ui/kit";
import { ModalSheet, useSheetClose } from "../ui/ModalSheet";
import { departures, historyDays } from "./adaptation";
import { type Exposure, EXPOSURES, jstHourOf, newId, RECENT_DAYS, recentDay, type Report, type Sensation, SENSATIONS, type Sky, SKIES, snapshotOf, type WindFelt, WINDS } from "./reports";
import { BetaContext } from "./settings";
import { baselineOf, baselineStateOf, historyOf } from "./useBaseline";
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
  const [saving, setSaving] = useState(false);
  // Wait for the past days (the summary asked for them), so the report carries its full history.
  const loading = baselineStateOf(store, station, today, beta.alpha).state === "loading";
  const ready = sensation != null && exposure != null && windFelt != null && sky != null && !loading;

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    const now = Date.now();
    const hours = store?.getHours(station, today).rows ?? null;
    const base = baselineOf(store, station, today, beta.alpha);
    const dep = departures(store?.getDay(station, today).row, hours, base, feel);
    const report: Report = {
      id: newId(),
      at: new Date(now).toISOString(),
      station,
      sensation,
      exposure,
      windFelt,
      sky,
      snapshot: snapshotOf(hours, jstHourOf(now), feel),
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

export function ReportSheet(props: Props) {
  return (
    <ModalSheet title="今の感じ方を記録 β" onClose={props.onClose} className="report-sheet" size="fit">
      <Body {...props} />
    </ModalSheet>
  );
}
