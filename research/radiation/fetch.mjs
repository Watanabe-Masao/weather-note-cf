// Kochi's hourly records for one year, for checking the light's cloud factor (#132 H-02) and the
// sunshine-based radiation estimate (#103): sunshine, measured global radiation, rain, temperature.
// Run by .github/workflows/research-radiation.yml (this sandbox cannot reach the API); public weather
// data only, no personal data. Node 20+, no dependencies.
import { writeFileSync } from "node:fs";

const BASE = process.env.WN_URL ?? "https://weather-note-cf.watanabe-masao0804.workers.dev";
const STATION = process.env.WN_STATION ?? "47893";
const YEAR = Number(process.env.WN_YEAR ?? 2025);

const day = (d) => d.toISOString().slice(0, 10);
const rows = [];
const failed = [];
for (let t = Date.UTC(YEAR, 0, 1); t <= Date.UTC(YEAR, 11, 31); t += 14 * 864e5) {
  const from = day(new Date(t));
  const to = day(new Date(Math.min(t + 13 * 864e5, Date.UTC(YEAR, 11, 31))));
  const res = await fetch(`${BASE}/api/hourly?station=${STATION}&from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`${from}..${to}: HTTP ${res.status}`);
  const data = await res.json();
  for (const d of data.days) {
    if (d.error) failed.push(`${d.date}: ${d.error}`);
    for (const r of d.rows) rows.push({ date: r.date, n: r.n, sun: r.sun ?? null, radiation: r.radiation ?? null, rain: r.rain ?? null, temp: r.temp ?? null });
  }
  console.log(from, to, data.days.length, "days");
  await new Promise((r) => setTimeout(r, 1500)); // gently
}
writeFileSync(`research/radiation/kochi-${YEAR}.json`, JSON.stringify({ station: STATION, year: YEAR, source: `${BASE}/api/hourly (JMA)`, failed, rows }));
console.log(rows.length, "rows,", failed.length, "failed days");
