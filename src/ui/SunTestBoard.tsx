// テスト板 (#96): the 日なた of feel-1 (in use) and of the feel-2 variants, side by side on real
// hours of a chosen day at the station — for judging the candidate by eye before any data decides.
// Nothing here changes the app's 日なた温度 or the model.

import { useContext, useEffect, useMemo, useState } from "react";
import { addDays } from "../../shared/dates";
import { feelOf, FORECAST_WIND_HEIGHT, radiationOf } from "../../shared/feel";
import { solarAltitude, stationLatLon, DEFAULT_LAT_LON } from "../../shared/sunTimes";
import { bodySunLoad, directWarming } from "../../shared/sunLoad";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { Priority } from "../data/plan";
import { FeelContext } from "./FeelBar";
import { ModalSheet } from "./ModalSheet";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const f1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));

/** The variants compared (the warming in the sun, ℃, over 日かげ). */
const VARIANTS = [
  { key: "f1", label: "feel-1（今）", note: "k × 地面の日射", color: "#a9b9cb", dash: "" },
  { key: "a", label: "feel-2 案A", note: "直射だけ（PR #109 のまま）", color: "#f5c865", dash: "5 4" },
  { key: "b", label: "feel-2 案B", note: "A × 体の表面の割合 0.725", color: "#f39a86", dash: "2 3" },
  { key: "c", label: "feel-2 案C（候補）", note: "B ＋ 地面の照り返し。β はみんな共通", color: "#f39a86", dash: "" },
] as const;
type Key = (typeof VARIANTS)[number]["key"];

interface Hour {
  n: number;
  alt: number;
  temp: number | null;
  wind: number | null;
  sun: number | null;
  rad: number | null;
  shade: number | null;
  add: Record<Key, number | null>;
  forecast: boolean;
}

export function SunTestBoard({ store, station, today, onClose }: { store: WeatherStore | null; station: string; today: string; onClose: () => void }) {
  const feel = useContext(FeelContext);
  const [date, setDate] = useState(today);
  useEffect(() => {
    store?.wantHours(station, [date], Priority.Visible, "sun-test");
    return () => store?.wantHours(station, [], Priority.Visible, "sun-test");
  }, [store, station, date]);
  const rows = store?.getHours(station, date).rows ?? [];
  const state = store?.getHours(station, date).state ?? "empty";
  const c = stationLatLon(station) ?? DEFAULT_LAT_LON;

  const hours: Hour[] = useMemo(() => {
    const byN = new Map(rows.map((r) => [r.n, r]));
    return Array.from({ length: 24 }, (_, i) => i + 1)
      .map((n) => {
        const r = byN.get(n) as WeatherRow | undefined;
        const alt = solarAltitude(date, n * 60 - 30, c.lat, c.lon);
        if (!r) return null;
        const forecast = r.type === "forecast";
        const temp = num(r.temp), hum = num(r.humidity), wind = num(r.wind), sun = num(r.sun);
        const rad = radiationOf(r);
        const shade = feelOf(temp, hum, wind, forecast, { ...feel, sun: false }, rad);
        const sunny = feelOf(temp, hum, wind, forecast, { ...feel, sun: true }, rad);
        // The wind at 10 m, as feel-1 takes it.
        const height = forecast ? FORECAST_WIND_HEIGHT : feel.stationHeight;
        const wind10 = wind == null ? null : forecast ? wind : wind * (FORECAST_WIND_HEIGHT / height) ** feel.alpha;
        const v = (o: { effective?: boolean; reflect?: boolean }) => {
          const load = bodySunLoad(date, n, station, sun, o);
          return load == null || wind10 == null ? null : directWarming(load, wind10);
        };
        return {
          n,
          alt,
          temp,
          wind,
          sun,
          rad,
          shade,
          forecast,
          add: { f1: shade != null && sunny != null ? sunny - shade : null, a: v({}), b: v({ effective: true }), c: v({ effective: true, reflect: true }) },
        };
      })
      .filter((h): h is Hour => !!h);
  }, [rows, date, station, feel, c.lat, c.lon]);
  const day = hours.filter((h) => h.alt > -6);

  // A small graph: the warming of each variant through the day.
  const W = 340, H = 150, X0 = 30, top = 8;
  const xs = (n: number) => X0 + ((n - 1) / 23) * (W - X0 - 6);
  const max = Math.max(8, ...day.flatMap((h) => Object.values(h.add).filter((v): v is number => v != null)));
  const ys = (v: number) => top + H - (v / max) * H;
  const path = (k: Key) => {
    const p = hours.filter((h) => h.add[k] != null).map((h) => `${xs(h.n).toFixed(1)},${ys(h.add[k]!).toFixed(1)}`);
    return p.length ? `M${p.join("L")}` : "";
  };

  return (
    <ModalSheet title="日なたの計算を比べる（テスト）" onClose={onClose} className="sun-test">
      <div className="sun-test-body">
        <p className="set-lead">
          この日の時間ごとの実際の値で、日なた温度の「日差しの上乗せ」（日なた − 日かげ、℃）を、今の計算と候補で比べます。アプリの表示とモデルは変えません（#96）。
        </p>
        <div className="sun-test-nav">
          <button className="chip sm" onClick={() => setDate(addDays(date, -1))} aria-label="前の日">
            ◀
          </button>
          <b>{date}</b>
          <button className="chip sm" onClick={() => setDate(addDays(date, 1))} aria-label="次の日" disabled={date >= addDays(today, 7)}>
            ▶
          </button>
          {date !== today && (
            <button className="chip sm" onClick={() => setDate(today)}>
              今日
            </button>
          )}
        </div>
        {!hours.length && state !== "error" ? <p className="set-help">時間ごとのデータを読み込んでいます…</p> : null}
        {state === "error" ? <p className="warn">この日の時間ごとのデータを読めませんでした。</p> : null}
        {hours.length > 0 && (
          <>
            <svg width="100%" viewBox={`0 0 ${W} ${top + H + 18}`} role="img" aria-label="日差しの上乗せの比較">
              {[0, 2, 4, 6, 8, 10, 12].filter((v) => v <= max).map((v) => (
                <g key={v}>
                  <line x1={X0} x2={W - 6} y1={ys(v)} y2={ys(v)} stroke="var(--line-soft)" />
                  <text x={X0 - 4} y={ys(v) + 3.5} textAnchor="end" className="lt-axis">
                    {v}
                  </text>
                </g>
              ))}
              {[0, 6, 12, 18, 24].map((h) => (
                <text key={h} x={xs(Math.max(1, h))} y={top + H + 14} textAnchor="middle" className="lt-axis">
                  {h}時
                </text>
              ))}
              {VARIANTS.map((v) => (
                <path key={v.key} d={path(v.key)} fill="none" stroke={v.color} strokeWidth={v.key === "c" || v.key === "f1" ? 2.2 : 1.6} strokeDasharray={v.dash} />
              ))}
            </svg>
            <p className="sun-test-legend">
              {VARIANTS.map((v) => (
                <span key={v.key}>
                  <svg width="22" height="8" aria-hidden>
                    <line x1="1" x2="21" y1="4" y2="4" stroke={v.color} strokeWidth="2.2" strokeDasharray={v.dash} />
                  </svg>
                  {v.label}：{v.note}
                </span>
              ))}
            </p>
            <div className="sun-test-table">
              <table>
                <thead>
                  <tr>
                    <th>時</th>
                    <th>太陽</th>
                    <th>日照</th>
                    <th>日射</th>
                    <th>気温</th>
                    <th>風</th>
                    <th>日かげ</th>
                    <th>今</th>
                    <th>A</th>
                    <th>B</th>
                    <th>C</th>
                  </tr>
                </thead>
                <tbody>
                  {day.map((h) => (
                    <tr key={h.n} className={h.forecast ? "fc" : undefined}>
                      <td>{h.n}</td>
                      <td>{`${Math.round(h.alt)}°`}</td>
                      <td>{h.sun == null ? "—" : h.sun.toFixed(1)}</td>
                      <td>{h.rad == null ? "—" : Math.round(h.rad)}</td>
                      <td>{f1(h.temp)}</td>
                      <td>{f1(h.wind)}</td>
                      <td>{f1(h.shade)}</td>
                      <td>+{f1(h.add.f1)}</td>
                      <td>+{f1(h.add.a)}</td>
                      <td>+{f1(h.add.b)}</td>
                      <td>+{f1(h.add.c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="set-help">
              時は気象庁の時（13時＝12〜13時）。太陽は時間の真ん中の高さ、日照は時間（0〜1）、日射は W/㎡（空欄は日射計のない時間）。日かげは日かげ温度（℃）、右の4列は日なたの上乗せ（℃）。今の計算は設定の「日差しの強さ」k を使います。薄い行は予報。
            </p>
            <p className="set-help">
              どの案にも入っていないもの：日に焼けた地面や壁から出る熱（夏の昼の日なたで大きい。アスファルトか芝生かで大きく変わる）。
            </p>
          </>
        )}
      </div>
    </ModalSheet>
  );
}
