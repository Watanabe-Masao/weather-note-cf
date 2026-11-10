// The sheet's 時間帯 tab: the chosen item over the 24 hours of the target day and its
// comparison day. It follows the table: move the day there and this moves with it.

import { useContext, useEffect, useState } from "react";
import type { ChartMetricId } from "../chartMetrics";
import type { WeatherStore } from "../data/store";
import { initialDetailMetric } from "../dayDetail";
import { FeelContext } from "./FeelBar";
import { CompareSummary } from "./CompareSummary";
import { HourCompare } from "./HourCompare";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  compareDate: string | null;
  metric: ChartMetricId;
  today: string;
  height: number;
  /** Show the two days side by side above the graph. */
  summary?: boolean;
  /** Swipe the summary sideways: move the selected day. */
  onStep?: (days: number) => void;
  /** Tapping the selected 日なた/日かげ温度 button again switches between sun and shade (the shared setting). */
  onToggleSun?: () => void;
}

export function HourFace({ store, station, target, compareDate, metric, today, height, summary = true, onStep, onToggleSun }: Props) {
  const settings = useContext(FeelContext);
  const base = initialDetailMetric(metric);
  // Temperature can also be read as 肌感 (日なた/日かげ温度) hour by hour.
  const [feel, setFeel] = useState(false);
  useEffect(() => setFeel(false), [metric]);
  const id = base === "temp" && feel ? "feel" : base;

  return (
    <div className="hour-face">
      {summary && <CompareSummary store={store} station={station} target={target} other={compareDate} today={today} metric={metric} onStep={onStep} />}
      <div className="hour-face-head">
        <p>24時間</p>
        {base === "temp" && (
          <div className="mini-switch" role="tablist" aria-label="気温の見方">
            <button role="tab" aria-selected={!feel} className={feel ? "" : "on"} onClick={() => setFeel(false)}>
              気温
            </button>
            <button
              role="tab"
              aria-selected={feel}
              className={feel ? "on" : ""}
              onClick={() => (feel ? onToggleSun?.() : setFeel(true))}
              title={feel ? `タップで${settings.sun ? "日かげ" : "日なた"}温度に切り替え` : undefined}
            >
              {settings.sun ? "日なた温度" : "日かげ温度"}
            </button>
          </div>
        )}
      </div>
      <HourCompare store={store} station={station} date={target} other={compareDate} metricId={id} today={today} height={height} />
    </div>
  );
}
