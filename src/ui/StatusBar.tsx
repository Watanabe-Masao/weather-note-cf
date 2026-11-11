// One line under the item chips that says when the data is not as it should be (rule: 状態の見せ方):
// offline (what is shown is what was saved), something failed (with one 再試行 for all of it), or the
// selected day is taking long. Nothing at all when everything is fine.

import { useEffect, useState } from "react";
import type { WeatherStore } from "../data/store";

/** How long the selected day may load before the bar says it is slow. */
const SLOW_MS = 4000;

export function StatusBar({ store, station, days }: { store: WeatherStore | null; station: string; days: (string | null)[] }) {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => {
      setOnline(true);
      store?.retryAll(); // back online: try what failed again, at once
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [store]);

  // Slow: the selected days are still loading after a few seconds.
  const loading = days.some((d) => d && store?.getDay(station, d).state === "empty");
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) return setSlow(false);
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [loading, days.join()]);

  const failed = store?.failedDays() ?? 0;
  if (!online)
    return (
      <div className="status-bar offline" role="status">
        <i aria-hidden />
        <span>オフラインです。保存してあるデータを表示しています。</span>
      </div>
    );
  if (failed)
    return (
      <div className="status-bar error" role="alert">
        <i aria-hidden />
        <span>{failed}日分のデータを取得できませんでした。</span>
        <button className="state-retry" onClick={() => store?.retryAll()}>
          再試行
        </button>
      </div>
    );
  if (slow)
    return (
      <div className="status-bar slow" role="status">
        <span className="state-spinner" aria-hidden />
        <span>データの取得に時間がかかっています…</span>
      </div>
    );
  return null;
}
