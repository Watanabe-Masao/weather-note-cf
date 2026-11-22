// 今日の1日モード：その日の値を「ここまで（観測）」と「このあと（予報）」に分けて見せる（2026-11-22 渡辺さん、案A）。
// 今日の時間は、過ぎた時間が観測、これからの時間が予報（authority.ts）。1日の最高・最低は両方を合わせた見込み。
// 上に24時間の気温の線（観測は実線、予報は破線と網かけ、今の時刻に縦の線）、下に2つの区切りの値、最後に1行の言葉。
import { hoursWeather } from "../../shared/dayWeather";
import type { WeatherRow } from "../../shared/types";
import { WeatherIcon } from "./WeatherIcon";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface Part {
  from: number;
  to: number;
  hours: number[];
  max: { v: number; n: number } | null;
  min: { v: number; n: number } | null;
  rain: number | null;
  wind: { v: number; n: number } | null;
}

function part(rows: WeatherRow[]): Part | null {
  if (!rows.length) return null;
  let max: Part["max"] = null;
  let min: Part["min"] = null;
  let rain: number | null = null;
  let wind: Part["wind"] = null;
  for (const r of rows) {
    const t = num(r.temp);
    if (t != null && (!max || t > max.v)) max = { v: t, n: r.n };
    if (t != null && (!min || t < min.v)) min = { v: t, n: r.n };
    const p = num(r.rain);
    if (p != null) rain = (rain ?? 0) + p;
    const w = num(r.wind);
    if (w != null && (!wind || w > wind.v)) wind = { v: w, n: r.n };
  }
  return { from: rows[0].n - 1, to: rows[rows.length - 1].n, hours: rows.map((r) => r.n), max, min, rain, wind };
}

/** The day split at the last observed hour. Null unless the day has both observed and forecast hours. */
export function splitToday(rows: WeatherRow[] | null) {
  if (!rows?.length) return null;
  const sorted = [...rows].sort((a, b) => a.n - b.n);
  const obs = part(sorted.filter((r) => r.type !== "forecast"));
  const fc = part(sorted.filter((r) => r.type === "forecast"));
  if (!obs || !fc) return null;
  const pick = (a: Part["max"], b: Part["max"], hi: boolean) => (!a ? b : !b ? a : (hi ? a.v >= b.v : a.v <= b.v) ? a : b);
  return { rows: sorted, obs, fc, max: pick(obs.max, fc.max, true), min: pick(obs.min, fc.min, false) };
}

const t1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

/** One line about the rest of the day: has the high already been, will it get colder or wetter. */
export function restWord(s: NonNullable<ReturnType<typeof splitToday>>): string {
  const out: string[] = [];
  if (s.obs.max && s.fc.max) {
    if (s.obs.max.v >= s.fc.max.v) out.push(`今日の最高は${s.obs.max.n}時の ${s.obs.max.v.toFixed(1)}℃ で、もう過ぎました`);
    else out.push(`最高はこのあと ${s.fc.max.n}時ごろ ${s.fc.max.v.toFixed(1)}℃ の見込み`);
  }
  if (s.fc.min && s.obs.min && s.fc.min.v < s.obs.min.v) out.push(`夜は ${s.fc.min.v.toFixed(1)}℃ まで下がりそう`);
  if ((s.fc.rain ?? 0) >= 0.5) out.push(`このあと雨 ${(s.fc.rain ?? 0).toFixed(1)}mm の予報`);
  else if ((s.obs.rain ?? 0) >= 0.5) out.push("このあと雨の予報はありません");
  return out.join("。") + (out.length ? "。" : "");
}

/** The 24 hours of temperature: observed solid, forecast dashed over a hatch, a line at now. */
function Curve({ s }: { s: NonNullable<ReturnType<typeof splitToday>> }) {
  const pts = s.rows.map((r) => ({ n: r.n, t: num(r.temp), fc: r.type === "forecast" })).filter((p): p is { n: number; t: number; fc: boolean } => p.t != null);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts.map((p) => p.t));
  const hi = Math.max(...pts.map((p) => p.t));
  const span = Math.max(1, hi - lo);
  const W = 240;
  const H = 56;
  const x = (n: number) => (n / 24) * W;
  const y = (t: number) => 6 + (1 - (t - lo) / span) * (H - 12);
  const path = (list: typeof pts) => list.map((p, i) => `${i ? "L" : "M"}${x(p.n).toFixed(1)},${y(p.t).toFixed(1)}`).join(" ");
  const obsPts = pts.filter((p) => !p.fc);
  const lastObs = obsPts.at(-1);
  const fcPts = [...(lastObs ? [lastObs] : []), ...pts.filter((p) => p.fc)];
  const now = s.obs.to;
  const area = obsPts.length > 1 ? `${path(obsPts)} L${x(obsPts.at(-1)!.n).toFixed(1)},${H} L${x(obsPts[0].n).toFixed(1)},${H} Z` : "";
  const mark = (m: { v: number; n: number } | null, kind: "hot" | "cold", fc: boolean) =>
    m && (
      <span className={`ts-mark ${kind}${fc ? " fc" : ""}${m.n <= 3 ? " start" : m.n >= 21 ? " end" : ""}`} style={{ left: `${(m.n / 24) * 100}%`, top: `${(y(m.v) / H) * 100}%` }}>
        <i />
        <em>
          {m.v.toFixed(1)}
          <small>{m.n}時</small>
        </em>
      </span>
    );
  return (
    <div className="ts-curve" aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <rect className="ts-fc-zone" x={x(now)} y={0} width={W - x(now)} height={H} />
        {area && <path className="ts-area" d={area} />}
        <path className="ts-line obs" d={path(obsPts)} vectorEffect="non-scaling-stroke" />
        <path className="ts-line fc" d={path(fcPts)} vectorEffect="non-scaling-stroke" />
        <line className="ts-nowline" x1={x(now)} x2={x(now)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
      </svg>
      {mark(s.obs.max, "hot", false)}
      {s.fc.max && s.obs.max && s.fc.max.v > s.obs.max.v && mark(s.fc.max, "hot", true)}
      {mark(s.min, "cold", s.min === s.fc.min && s.min !== s.obs.min)}
      <span className="ts-now" style={{ left: `${(now / 24) * 100}%` }}>
        いま {now}時
      </span>
      <span className="ts-ticks">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }} className={Math.abs(h - now) < 3 ? "hide" : ""}>
            {h}
          </span>
        ))}
      </span>
    </div>
  );
}

export function TodaySplit({ rows, station }: { rows: WeatherRow[] | null; station: string }) {
  const s = splitToday(rows);
  if (!s) return null;
  const cell = (p: Part, kind: "obs" | "fc") => {
    const wx = hoursWeather(s.rows, p.hours, station).text;
    return (
      <div className={`ts-cell ${kind}`}>
        <p className="ts-cap">
          <span className={`ts-tag ${kind}`}>{kind === "obs" ? "観測" : "予報"}</span>
          <span className="ts-when">{kind === "obs" ? "ここまで" : "このあと"}</span>
          <small>
            {p.from}〜{p.to}時
          </small>
        </p>
        {wx && (
          <div className="ts-wx">
            <WeatherIcon text={wx} size={22} />
            <span>{wx}</span>
          </div>
        )}
        <dl className="ts-vals">
          <dt>最高</dt>
          <dd>
            <b className="tone-hot">{t1(p.max?.v)}</b>
            <small>{p.max ? `${p.max.n}時` : ""}</small>
          </dd>
          <dt>最低</dt>
          <dd>
            <b className="tone-cold">{t1(p.min?.v)}</b>
            <small>{p.min ? `${p.min.n}時` : ""}</small>
          </dd>
          <dt>降水</dt>
          <dd>
            <b className="tone-rain">{p.rain == null ? "—" : p.rain.toFixed(1)}</b>
            <small>mm</small>
          </dd>
          <dt>風</dt>
          <dd>
            <b className="tone-wind">{t1(p.wind?.v)}</b>
            <small>m/s{p.wind ? `・${p.wind.n}時` : ""}</small>
          </dd>
        </dl>
      </div>
    );
  };
  const word = restWord(s);
  return (
    <section className="ts" aria-label="今日：ここまでの観測と、このあとの予報">
      <Curve s={s} />
      <div className="ts-cells">
        {cell(s.obs, "obs")}
        {cell(s.fc, "fc")}
      </div>
      {word && <p className="ts-say">{word}</p>}
    </section>
  );
}
