// The sheet's 時間帯 tab: the chosen item over the 24 hours of the target day and its
// comparison day. It follows the table: move the day there and this moves with it.

import { useContext, useEffect, useState } from "react";
import { dayTone, weekdayOf } from "../../shared/holidays";
import type { ChartMetricId } from "../chartMetrics";
import type { WeatherStore } from "../data/store";
import { initialDetailMetric } from "../dayDetail";
import { FeelContext } from "./FeelBar";
import { HourCompare, shortDate } from "./HourCompare";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  compareDate: string | null;
  metric: ChartMetricId;
  today: string;
  height: number;
}

export function HourFace({ store, station, target, compareDate, metric, today, height }: Props) {
  const settings = useContext(FeelContext);
  const base = initialDetailMetric(metric);
  // Temperature can also be read as 肌感 (日なた/日かげ温度) hour by hour.
  const [feel, setFeel] = useState(false);
  useEffect(() => setFeel(false), [metric]);
  const id = base === "temp" && feel ? "feel" : base;

  return (
    <div className="hour-face">
      <div className="hour-face-head">
        <p>
          <b className={`tone-${dayTone(target)}`}>
            {shortDate(target).slice(5)}（{weekdayOf(target)}）
          </b>
          {compareDate && (
            <>
              {" "}と{" "}
              <b className={`tone-${dayTone(compareDate)}`}>
                {shortDate(compareDate)}（{weekdayOf(compareDate)}）
              </b>
            </>
          )}
        </p>
        {base === "temp" && (
          <div className="mini-switch" role="tablist" aria-label="気温の見方">
            <button role="tab" aria-selected={!feel} className={feel ? "" : "on"} onClick={() => setFeel(false)}>
              気温
            </button>
            <button role="tab" aria-selected={feel} className={feel ? "on" : ""} onClick={() => setFeel(true)}>
              {settings.sun ? "日なた" : "日かげ"}
            </button>
          </div>
        )}
      </div>
      <HourCompare store={store} station={station} date={target} other={compareDate} metricId={id} today={today} height={height} />
    </div>
  );
}
