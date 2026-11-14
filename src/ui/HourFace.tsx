// The sheet's 時間帯 tab: the chosen item over the 24 hours of the target day and its
// comparison day. It follows the table: move the day there and this moves with it.

import { PartsOutlook } from "./PartsOutlook";
import { useContext, useEffect, useState } from "react";
import type { ChartMetricId } from "../chartMetrics";
import type { WeatherStore } from "../data/store";
import { initialDetailMetric } from "../dayDetail";
import { FeelContext } from "./FeelBar";
import type { CalendarSide } from "./CalendarModal";
import { CompareSummary } from "./CompareSummary";
import { HourCompare } from "./HourCompare";
import { Segmented, SectionHead } from "./kit";

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
  /** Tapping the selected 肌感（日なた/日かげ） button again switches between sun and shade (the shared setting). */
  onToggleSun?: () => void;
  /** Tap a date in the summary to pick it from the calendar. */
  pick?: (side: CalendarSide) => void;
}

export function HourFace({ store, station, target, compareDate, metric, today, height, summary = true, onStep, onToggleSun, pick }: Props) {
  const settings = useContext(FeelContext);
  const base = initialDetailMetric(metric);
  // Temperature can also be read as 肌感 (肌感（日なた/日かげ）) hour by hour.
  const [feel, setFeel] = useState(false);
  useEffect(() => setFeel(false), [metric]);
  const id = base === "temp" && feel ? "feel" : base;

  return (
    <div className="hour-face">
      {summary && <CompareSummary store={store} station={station} target={target} other={compareDate} today={today} metric={metric} onStep={onStep} pick={pick} />}
      {summary && base === "temp" && <PartsOutlook store={store} station={station} date={target} today={today} />}
      <SectionHead title="24時間" as="p">
        {base === "temp" && (
          <Segmented
            label="気温の見方"
            value={feel ? "feel" : "air"}
            options={[
              { id: "air", label: "気温" },
              { id: "feel", label: settings.sun ? "肌感（日なた）" : "肌感（日かげ）" },
            ]}
            onChange={(v) => setFeel(v === "feel")}
            // The selected 肌感（日なた/日かげ） tapped again switches sun and shade (the shared setting).
            onReselect={(v) => v === "feel" && onToggleSun?.()}
          />
        )}
      </SectionHead>
      <HourCompare store={store} station={station} date={target} other={compareDate} metricId={id} today={today} height={height} />
    </div>
  );
}
