// 今日の1日モード：その日の値を「ここまで（観測）」と「このあと（予報）」に分けて見せる（2026-11-22 渡辺さん、案A）。
// 今日の時間は、過ぎた時間が観測、これからの時間が予報（authority.ts）。1日の最高・最低は日の行の値（表と同じ、src/todaySplit.ts withDay）。
// 上に24時間の気温の線（観測は実線、予報は破線と網かけ、今の時刻に縦の線）、下に2つの区切りの値、最後に1行の言葉。
import { hoursWeather } from "../../shared/dayWeather";
import type { WeatherRow } from "../../shared/types";
import { WeatherIcon } from "./WeatherIcon";

import { fig, num, restWord, splitToday, t1, withDay, type Shown } from "../todaySplit";


/** A tick the "いま" label would lie on (the label is centred on now, or starts or ends at it near the edges). */
const underNow = (h: number, now: number) => (now <= 2 ? h < now + 6.5 : now >= 22 ? h > now - 6.5 : Math.abs(h - now) < 4);

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
      {/* 最高と最低が同じ時刻（観測が1時間だけ、など）のときは最低だけ */}
      {s.obs.max && s.obs.max.n !== s.min?.n && mark(s.obs.max, "hot", false)}
      {s.fc.max && s.obs.max && s.fc.max.v > s.obs.max.v && s.fc.max.n !== s.min?.n && mark(s.fc.max, "hot", true)}
      {mark(s.min, "cold", s.min === s.fc.min && s.min !== s.obs.min)}
      <span className={`ts-now${now <= 2 ? " start" : now >= 22 ? " end" : ""}`} style={{ left: `${(now / 24) * 100}%` }}>
        いま {now}時
      </span>
      <span className="ts-ticks">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }} className={underNow(h, now) ? "hide" : ""}>
            {h}
          </span>
        ))}
      </span>
    </div>
  );
}

export function TodaySplit({ rows, station, day }: { rows: WeatherRow[] | null; station: string; day: { max: number | null; min: number | null } }) {
  const raw = splitToday(rows);
  if (!raw) return null;
  // 値（ここまで／このあと・言葉）は日の値にそろえ、線は時間の値のまま。
  const s = withDay(raw, day);
  const cell = (p: Shown, kind: "obs" | "fc") => {
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
            <b className="tone-hot">{p.max ? fig(p.max) : "—"}</b>
            <small>{p.max?.n != null ? `${p.max.n}時` : ""}</small>
          </dd>
          <dt>最低</dt>
          <dd>
            <b className="tone-cold">{p.min ? fig(p.min) : "—"}</b>
            <small>{p.min?.n != null ? `${p.min.n}時` : ""}</small>
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
      <Curve s={raw} />
      <div className="ts-cells">
        {cell(s.obs, "obs")}
        {cell(s.fc, "fc")}
      </div>
      {word && <p className="ts-say">{word}</p>}
    </section>
  );
}
