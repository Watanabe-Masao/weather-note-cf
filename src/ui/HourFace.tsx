// The sheet's 時間帯 tab: the chosen item over the 24 hours of the target day and its
// comparison day. It follows the table: move the day there and this moves with it.

import { PartsOutlook } from "./PartsOutlook";
import { type ReactNode, useContext, useEffect, useState } from "react";
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
  /** Right under the 24時間 head, above the readout (1日モード: the items to choose, with the day's values). */
  top?: ReactNode;
}

export function HourFace({ store, station, target, compareDate, metric, today, height, summary = true, onStep, onToggleSun, pick, top }: Props) {
  const settings = useContext(FeelContext);
  const base = initialDetailMetric(metric);
  // Temperature can also be read as 肌感 (肌感（日なた/日かげ）) hour by hour; humidity as 視程 (2026-11-21).
  const [alt, setAlt] = useState(false);
  useEffect(() => setAlt(false), [metric]);
  const id = alt && base === "temp" ? "feel" : alt && base === "humidity" ? "visibility" : base;
  const switchable = base === "temp" || base === "humidity";

  return (
    <div className="hour-face">
      {summary && <CompareSummary store={store} station={station} target={target} other={compareDate} today={today} metric={metric} onStep={onStep} pick={pick} />}
      {summary && base === "temp" && <PartsOutlook store={store} station={station} date={target} today={today} />}
      <SectionHead title="24時間" as="p">
        {/* 気温・湿度のときだけの切り替えだが、場所はいつも取っておく（項目を替えても下の物が上下に動かない、2026-11-18 渡辺さん）。
            それ以外のときは見えず、押せず、読み上げない。 */}
        <span className={switchable ? "seg-slot" : "seg-slot off"} aria-hidden={!switchable || undefined} inert={!switchable || undefined}>
          {base === "humidity" ? (
            <Segmented
              label="湿度の見方"
              value={alt ? "vis" : "hum"}
              options={[
                { id: "hum", label: "湿度" },
                { id: "vis", label: "視程" },
              ]}
              onChange={(v) => setAlt(v === "vis")}
            />
          ) : (
            <Segmented
              label="気温の見方"
              value={alt ? "feel" : "air"}
              options={[
                { id: "air", label: "気温" },
                { id: "feel", label: settings.sun ? "肌感（日なた）" : "肌感（日かげ）" },
              ]}
              onChange={(v) => setAlt(v === "feel")}
              // The selected 肌感（日なた/日かげ） tapped again switches sun and shade (the shared setting).
              onReselect={(v) => v === "feel" && onToggleSun?.()}
            />
          )}
        </span>
      </SectionHead>
      {top}
      <HourCompare store={store} station={station} date={target} other={compareDate} metricId={id} today={today} height={height} />
    </div>
  );
}
