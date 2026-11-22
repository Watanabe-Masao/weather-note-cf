// 今日の1日モード：その日の値を「ここまで（観測）」と「このあと（予報）」に分けて見せる（2026-11-22、見本）。
// 今日の時間は、過ぎた時間が観測、これからの時間が予報（authority.ts）。1日の値は両方を合わせたもの。
import type { WeatherRow } from "../../shared/types";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface Part {
  from: number;
  to: number;
  max: { v: number; n: number } | null;
  min: { v: number; n: number } | null;
  rain: number | null;
  sun: number | null;
}

function part(rows: WeatherRow[]): Part | null {
  if (!rows.length) return null;
  let max: Part["max"] = null;
  let min: Part["min"] = null;
  let rain: number | null = null;
  let sun: number | null = null;
  for (const r of rows) {
    const t = num(r.temp);
    if (t != null && (!max || t > max.v)) max = { v: t, n: r.n };
    if (t != null && (!min || t < min.v)) min = { v: t, n: r.n };
    const p = num(r.rain);
    if (p != null) rain = (rain ?? 0) + p;
    const s = num(r.sun);
    if (s != null) sun = (sun ?? 0) + s;
  }
  return { from: rows[0].n - 1, to: rows[rows.length - 1].n, max, min, rain, sun };
}

/** The day split at the last observed hour. Null unless the day has both observed and forecast hours. */
export function splitToday(rows: WeatherRow[] | null) {
  if (!rows?.length) return null;
  const sorted = [...rows].sort((a, b) => a.n - b.n);
  const obs = part(sorted.filter((r) => r.type !== "forecast"));
  const fc = part(sorted.filter((r) => r.type === "forecast"));
  if (!obs || !fc) return null;
  const pick = (a: Part["max"], b: Part["max"], hi: boolean) => (!a ? b : !b ? a : (hi ? a.v >= b.v : a.v <= b.v) ? a : b);
  return { obs, fc, max: pick(obs.max, fc.max, true), min: pick(obs.min, fc.min, false) };
}

const t1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
const at = (x: { n: number } | null) => (x ? `${x.n}時` : "");

export function TodaySplit({ rows, look }: { rows: WeatherRow[] | null; look: string }) {
  const s = splitToday(rows);
  if (!s) return null;
  const now = s.obs.to;
  if (look === "line")
    return (
      <p className="ts-line">
        <span className="ts-tag obs">観測</span> {s.obs.from}〜{s.obs.to}時 <b className="tone-hot">{t1(s.obs.max?.v)}</b>/<b className="tone-cold">{t1(s.obs.min?.v)}</b>
        <span className="ts-sep" aria-hidden>
          ›
        </span>
        <span className="ts-tag fc">予報</span> 〜24時 <b className="tone-hot">{t1(s.fc.max?.v)}</b>/<b className="tone-cold">{t1(s.fc.min?.v)}</b>
      </p>
    );
  const cell = (p: Part, kind: "obs" | "fc") => (
    <div className={`ts-cell ${kind}`}>
      <p className="ts-cap">
        <span className={`ts-tag ${kind}`}>{kind === "obs" ? "観測" : "予報"}</span>
        <span className="ts-when">{kind === "obs" ? "ここまで" : "このあと"}</span>
        <small>
          {p.from}〜{p.to}時
        </small>
      </p>
      <dl className="ts-vals">
        <dt>最高</dt>
        <dd>
          <b className="tone-hot">{t1(p.max?.v)}</b>
          <small>{at(p.max)}</small>
        </dd>
        <dt>最低</dt>
        <dd>
          <b className="tone-cold">{t1(p.min?.v)}</b>
          <small>{at(p.min)}</small>
        </dd>
        <dt>降水</dt>
        <dd>
          <b className="tone-rain">{p.rain == null ? "—" : p.rain.toFixed(1)}</b>
          <small>mm</small>
        </dd>
      </dl>
    </div>
  );
  return (
    <section className="ts" aria-label="今日：ここまでの観測と、このあとの予報">
      <div className="ts-bar" aria-hidden>
        <i className="obs" style={{ width: `${(now / 24) * 100}%` }} />
        <i className="fc" />
        <span className="ts-now" style={{ left: `${(now / 24) * 100}%` }}>
          {now}時
        </span>
      </div>
      <div className="ts-cells">
        {cell(s.obs, "obs")}
        {cell(s.fc, "fc")}
      </div>
    </section>
  );
}
