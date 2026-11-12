// テスト板 (#96): 肌感 of feel-1 (in use) and of feel-3 (UTCI for 日かげ and 日なた, the candidate
// after the independent review), side by side on real hours of a chosen day at the station: the
// physical base only (D18) — how a value is felt is the β model's. For judging the candidate by
// eye before any data decides. Nothing here changes the app's 肌感 or the model.

import { useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { addDays } from "../../shared/dates";
import { feelOf, FORECAST_WIND_HEIGHT, radiationOf } from "../../shared/feel";
import { feel3, hourRadiation, utciWind } from "../../shared/mrt";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { Priority } from "../data/plan";
import { FeelContext } from "./FeelBar";
import { ModalSheet } from "./ModalSheet";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const f1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));

const LINES = [
  { key: "s1", label: "今の日かげ（feel-1）", color: "#a9b9cb", dash: "4 3" },
  { key: "u1", label: "今の日なた（feel-1）", color: "#a9b9cb", dash: "" },
  { key: "s3", label: "候補の日かげ（UTCI）", color: "#f39a86", dash: "4 3" },
  { key: "u3", label: "候補の日なた（UTCI）", color: "#f39a86", dash: "" },
] as const;
type Key = (typeof LINES)[number]["key"];

interface Hour {
  n: number;
  temp: number | null;
  wind: number | null;
  sun: number | null;
  v: Record<Key, number | null>;
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

  const hours: Hour[] = useMemo(() => {
    const byN = new Map(rows.map((r) => [r.n, r]));
    return Array.from({ length: 24 }, (_, i) => i + 1)
      .map((n) => {
        const r = byN.get(n) as WeatherRow | undefined;
        if (!r) return null;
        const forecast = r.type === "forecast";
        const temp = num(r.temp), hum = num(r.humidity), wind = num(r.wind), sun = num(r.sun), rain = num(r.rain);
        const rad = radiationOf(r);
        const s1 = feelOf(temp, hum, wind, forecast, { ...feel, sun: false }, rad);
        const u1 = feelOf(temp, hum, wind, forecast, { ...feel, sun: true }, rad);
        const height = forecast ? FORECAST_WIND_HEIGHT : feel.stationHeight;
        const sky = hourRadiation(date, n, station, sun, rain != null && rain >= 0.5);
        const f3 = feel3(temp, hum, wind == null ? null : utciWind(wind, height, feel.alpha), sky);
        return { n, temp, wind, sun, forecast, v: { s1, u1, s3: f3.shade, u3: f3.sun } };
      })
      .filter((h): h is Hour => !!h);
  }, [rows, date, station, feel]);

  // The graph: 肌感 through the day, the candidate's ちょうどよい band behind.
  const W = 340, H = 170, X0 = 30, top = 8;
  const xs = (n: number) => X0 + ((n - 1) / 23) * (W - X0 - 6);
  const all = hours.flatMap((h) => Object.values(h.v).filter((v): v is number => v != null));
  const lo = Math.floor(Math.min(...all) / 5) * 5;
  const hi = Math.ceil(Math.max(...all) / 5) * 5;
  const ys = (v: number) => top + H - ((v - lo) / Math.max(5, hi - lo)) * H;
  const path = (k: Key) => {
    const p = hours.filter((h) => h.v[k] != null).map((h) => `${xs(h.n).toFixed(1)},${ys(h.v[k]!).toFixed(1)}`);
    return p.length ? `M${p.join("L")}` : "";
  };
  const ticks = [];
  for (let v = lo; v <= hi; v += 5) ticks.push(v);

  // Opened from inside the settings sheet: drawn at the page's top level (as AdminSheet), or the
  // settings sheet would clip and move it.
  return createPortal(
    <ModalSheet title="肌感の計算を比べる（テスト）" onClose={onClose} className="sun-test">
      <div className="sun-test-body">
        <p className="set-lead">
          この日の時間ごとの実際の値で、肌感（日かげ・日なた）を今の計算（feel-1）と候補（feel-3：日かげも日なたも UTCI）で比べます。比べるのは土台の値だけです。どの値をどう感じるか（暑い・涼しい、慣れ、人による違い）は、この上のβモデルが受け持ちます。アプリの表示とモデルは変えません（#96）。
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
            <svg width="100%" viewBox={`0 0 ${W} ${top + H + 18}`} role="img" aria-label="肌感の比較">
              {ticks.map((v) => (
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
              {LINES.map((l) => (
                <path key={l.key} d={path(l.key)} fill="none" stroke={l.color} strokeWidth={2} strokeDasharray={l.dash} />
              ))}
            </svg>
            <p className="sun-test-legend">
              {LINES.map((l) => (
                <span key={l.key}>
                  <svg width="22" height="8" aria-hidden>
                    <line x1="1" x2="21" y1="4" y2="4" stroke={l.color} strokeWidth="2.2" strokeDasharray={l.dash} />
                  </svg>
                  {l.label}
                </span>
              ))}
            </p>
            <div className="sun-test-table">
              <table>
                <thead>
                  <tr>
                    <th>時</th>
                    <th>日照</th>
                    <th>気温</th>
                    <th>風</th>
                    <th>今<br />かげ/なた</th>
                    <th>候補<br />かげ/なた</th>
                  </tr>
                </thead>
                <tbody>
                  {hours.map((h) => (
                    <tr key={h.n} className={h.forecast ? "fc" : undefined}>
                      <td>{h.n}</td>
                      <td>{h.sun == null ? "—" : h.sun.toFixed(1)}</td>
                      <td>{f1(h.temp)}</td>
                      <td>{f1(h.wind)}</td>
                      <td>
                        {f1(h.v.s1)}/{f1(h.v.u1)}
                      </td>
                      <td>
                        {f1(h.v.s3)}/{f1(h.v.u3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="set-help">
              時は気象庁の時（13時＝12〜13時）。日照は時間（0〜1）。薄い行は予報。候補の日差しは日照と太陽の位置だけから（日射計は使いません。記録と予報で同じ材料）。
            </p>
            <p className="set-help">
              候補（UTCI）は気温・湿度・風・日差しから体の熱の出入りを計算した指数で、湿った暑さは今より高く、冬の日なたの日差しは今より大きく出ます。まだ入っていないもの：晴れた夜の放射冷却、日に焼けた地面や壁の熱。候補を使うときは、βモデルをこの値で学び直します（承認のあと）。
            </p>
          </>
        )}
      </div>
    </ModalSheet>,
    document.body,
  );
}
