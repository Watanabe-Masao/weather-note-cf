// Stage 1: a connection check that exercises the API end to end.
// The comparison screen (drum strips, table, graph sheet) replaces this in a later stage.

import { useEffect, useState } from "react";
import { addDays, jstToday, monthOf } from "../shared/dates";
import type { DailyMonthResponse, Station, WeatherRow } from "../shared/types";

const DEFAULT_STATION = "47893"; // 高知

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  const data = await r.json();
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data as T;
}

const fmt = (v: unknown) => (typeof v === "number" ? v.toFixed(1) : "—");

export function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [station, setStation] = useState(DEFAULT_STATION);
  const [month, setMonth] = useState<DailyMonthResponse | null>(null);
  const [forecast, setForecast] = useState<WeatherRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<Station[]>("/api/stations").then(setStations, (e) => setError(e.message));
  }, []);

  useEffect(() => {
    setError(null);
    setMonth(null);
    setForecast([]);
    // The previous month always has published data, even on the 1st.
    const target = monthOf(addDays(jstToday(), -3));
    getJson<DailyMonthResponse>(`/api/daily?station=${station}&month=${target}`).then(setMonth, (e) =>
      setError(e.message),
    );
    getJson<{ rows: WeatherRow[] }>(`/api/forecast?station=${station}`).then(
      (f) => setForecast(f.rows),
      (e) => setError(e.message),
    );
  }, [station]);

  return (
    <main className="page">
      <header className="head">
        <h1>Weather Note</h1>
        <select value={station} onChange={(e) => setStation(e.target.value)} aria-label="観測地点">
          {stations.map((s) => (
            <option key={s.blockNo} value={s.blockNo}>
              {s.prefecture} / {s.name}
            </option>
          ))}
        </select>
      </header>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>
          実績 {month?.month ?? "…"} {month && (month.fixed ? "（確定）" : "（未確定を含む）")}
        </h2>
        <table>
          <thead>
            <tr>
              <th>日</th>
              <th>天気（昼）</th>
              <th>最高</th>
              <th>最低</th>
              <th>降水</th>
            </tr>
          </thead>
          <tbody>
            {month?.rows.map((r) => (
              <tr key={r.date}>
                <td>{r.date.slice(5)}</td>
                <td>{(r.dayWeather as string) ?? "—"}</td>
                <td>{fmt(r.max)}</td>
                <td>{fmt(r.min)}</td>
                <td>{fmt(r.rain)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>予報（8日）</h2>
        <table>
          <tbody>
            {forecast.map((r) => (
              <tr key={r.date}>
                <td>{r.date.slice(5)}</td>
                <td>{(r.dayWeather as string) ?? "—"}</td>
                <td>{fmt(r.max)}</td>
                <td>{fmt(r.min)}</td>
                <td>{fmt(r.rain)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="credit">
        出典：<a href="https://www.jma.go.jp/">気象庁ホームページ</a>（実績）／
        <a href="https://open-meteo.com/">Open-Meteo</a>（予報・CC BY 4.0）
      </footer>
    </main>
  );
}
