// β: 計算の根拠. A research feature shows how each number was obtained: the formula, the inputs it
// used (with their sources) and the arithmetic, for the target and the comparison day. Nothing here
// is computed differently from the summary; it reads the same functions and lays them open.

import { useContext, useState } from "react";
import { BANDS, DAYTIME_BANDS, daytimeFeel, feelOf, type FeelSettings, FORECAST_WIND_HEIGHT, PERSON_HEIGHT, radiationOf, windAtPerson } from "../../shared/feel";
import type { WeatherRow } from "../../shared/types";
import type { WeatherStore } from "../data/store";
import { dateLabel, monthDay } from "../design/format";
import { FeelContext } from "../ui/FeelBar";
import { Segmented } from "../ui/kit";
import { ModalSheet } from "../ui/ModalSheet";
import { halfLifeDays, HISTORY_DAYS, historyDays, MIN_COVERAGE, updateRate } from "./adaptation";
import { MIN_REPORTS, MIN_SPAN_DAYS, STANDARD_ALPHA } from "./fitAlpha";
import { BetaContext } from "./settings";
import { baselineStateOf } from "./useBaseline";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  other: string | null;
  onClose: () => void;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const f1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
const signed = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`);
const mean = (vs: (number | null)[]) => {
  const xs = vs.filter((v): v is number => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};

/** How each past day entered the baseline. */
function BaselineBasis({ store, station, date, alpha }: { store: WeatherStore | null; station: string; date: string; alpha: number }) {
  const st = baselineStateOf(store, station, date, alpha);
  const days = historyDays(date).map((d, k) => {
    const day = store?.getDay(station, d);
    const row = day?.row ?? null;
    const w = (1 - alpha) * alpha ** k;
    return { d, k: k + 1, mean: num(row?.temp), w, source: !row ? (day?.state === "empty" ? "取得中" : "欠け") : row.type === "forecast" ? "予報" : day?.kind === "fixed" ? "確定" : "暫定" };
  });
  const total = days.reduce((s, x) => s + x.w, 0);
  const have = days.filter((x) => x.mean != null).reduce((s, x) => s + x.w, 0);
  const shown = days.slice(0, 14);
  const rest = days.slice(14);
  const restWeight = rest.reduce((s, x) => s + x.w, 0) / total;
  const restMean = mean(rest.map((x) => x.mean));
  const maxW = days[0].w / total;
  return (
    <section className="basis-sec" aria-labelledby="basis-base">
      <h4 id="basis-base">
        最近の基準 <b>{st.state === "ready" ? `${f1(st.baseline.value)}℃` : st.state === "loading" ? "読み込み中" : "履歴不足"}</b>
      </h4>
      <p className="basis-formula">
        A = Σ w<sub>k</sub>·T<sub>k</sub> ÷ Σ w<sub>k</sub>　w<sub>k</sub> = (1−α)·α<sup>k−1</sup>
      </p>
      <p className="basis-note">
        T<sub>k</sub> は k 日前の日平均気温。α = {alpha.toFixed(2)}（半減期 {halfLifeDays(alpha)}日・前日の重み {updateRate(alpha)}）。過去{HISTORY_DAYS}日を見て、データのある日の重みで割り直します（欠けた日を推測で埋めない）。前日があり、重みの{Math.round(MIN_COVERAGE * 100)}%以上がそろったときだけ計算します。根拠：EN 16798-1 の屋外気温の移動平均（θrm）。
      </p>
      <p className="basis-note">
        そろっている重み：<b>{Math.round((have / total) * 100)}%</b>
        {st.state === "ready" && st.baseline.forecastMixed && <span className="beta-fc inline">予報を含む</span>}
      </p>
      <div className="basis-scroll">
<table className="basis-table">
        <thead>
          <tr>
            <th>日</th>
            <th>日平均</th>
            <th>重み</th>
            <th>出どころ</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((x) => (
            <tr key={x.d} className={x.mean == null ? "missing" : undefined}>
              <td>
                {monthDay(x.d)} <small>{x.k}日前</small>
              </td>
              <td className="num">{f1(x.mean)}</td>
              <td className="num">
                <span className="basis-bar" style={{ width: `${((x.w / total) / maxW) * 100}%` }} />
                {((x.w / total) * 100).toFixed(1)}%
              </td>
              <td>{x.source}</td>
            </tr>
          ))}
          <tr className="rest">
            <td>
              15〜{HISTORY_DAYS}日前 <small>{rest.filter((x) => x.mean != null).length}/{rest.length}日</small>
            </td>
            <td className="num">{f1(restMean)}</td>
            <td className="num">{(restWeight * 100).toFixed(1)}%</td>
            <td>平均</td>
          </tr>
        </tbody>
      </table>
</div>
    </section>
  );
}

/** One daytime band: inputs, and the 日なた／日かげ温度 they give. */
function bandBasis(rows: WeatherRow[], hours: readonly number[], feel: FeelSettings) {
  const hs = rows.filter((r) => hours.includes(r.n));
  const forecast = hs.some((r) => r.type === "forecast");
  const values = (k: string) => hs.map((r) => num(r[k]));
  const height = forecast ? FORECAST_WIND_HEIGHT : feel.stationHeight;
  const wind = mean(values("wind"));
  return {
    temp: mean(values("temp")),
    humidity: mean(values("humidity")),
    wind,
    windPerson: wind == null ? null : windAtPerson(wind, height, feel.alpha),
    height,
    solar: mean(hs.map((r) => radiationOf(r))),
    shade: mean(hs.map((r) => feelOf(r.temp, r.humidity, r.wind, r.type === "forecast", { ...feel, sun: false }, radiationOf(r)))),
    sun: mean(hs.map((r) => feelOf(r.temp, r.humidity, r.wind, r.type === "forecast", { ...feel, sun: true }, radiationOf(r)))),
    forecast,
  };
}

function DayBasis({ store, station, date, alpha, feel }: { store: WeatherStore | null; station: string; date: string; alpha: number; feel: FeelSettings }) {
  const st = baselineStateOf(store, station, date, alpha);
  const base = st.state === "ready" ? st.baseline.value : null;
  const day = store?.getDay(station, date);
  const row = day?.row ?? null;
  const rows = store?.getHours(station, date).rows ?? [];
  const bands = DAYTIME_BANDS.map((id) => {
    const b = BANDS.find((x) => x.id === id)!;
    return { label: b.label, hours: b.hours, ...bandBasis(rows, b.hours, feel) };
  });
  // The totals come from the very functions the summary uses, so the two always agree.
  const sunMean = daytimeFeel(rows, { ...feel, sun: true });
  const shadeMean = daytimeFeel(rows, { ...feel, sun: false });
  const minus = (v: number | null) => (v == null || base == null ? null : Math.round((v - base) * 10) / 10);
  const dayMean = num(row?.temp);
  return (
    <>
      <BaselineBasis store={store} station={station} date={date} alpha={alpha} />

      <section className="basis-sec" aria-labelledby="basis-air">
        <h4 id="basis-air">
          気温の差 <b>{signed(minus(dayMean))}℃</b>
        </h4>
        <p className="basis-formula">
          その日の平均気温 {f1(dayMean)} − 最近の基準 {f1(base)} = {signed(minus(dayMean))}
        </p>
        <p className="basis-note">
          平均気温の出どころ：{!row ? "なし" : row.type === "forecast" ? "予報（Open-Meteo）" : day?.kind === "fixed" ? "気象庁（確定）" : "気象庁（暫定）"}
        </p>
      </section>

      <section className="basis-sec" aria-labelledby="basis-feel">
        <h4 id="basis-feel">
          日なた・日かげの差 <b>{signed(minus(sunMean))} ／ {signed(minus(shadeMean))}℃</b>
        </h4>
        <p className="basis-note">
          日中・昼・夕方（9〜17時）の日なた温度・日かげ温度の平均から基準を引きます。3つの時間帯がそろわないときは出しません。
        </p>
        <div className="basis-scroll">
<table className="basis-table">
          <thead>
            <tr>
              <th>時間帯</th>
              <th>気温</th>
              <th>湿度</th>
              <th>風→人</th>
              <th>日射</th>
              <th>日なた</th>
              <th>日かげ</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.label}>
                <td>
                  {b.label} <small>{b.hours[0]}–{b.hours.at(-1)}時{b.forecast ? "・予報" : ""}</small>
                </td>
                <td className="num">{f1(b.temp)}</td>
                <td className="num">{b.humidity == null ? "—" : Math.round(b.humidity)}</td>
                <td className="num">
                  {f1(b.wind)}→{f1(b.windPerson)}
                </td>
                <td className="num">{b.solar == null ? "—" : Math.round(b.solar)}</td>
                <td className="num">{f1(b.sun)}</td>
                <td className="num">{f1(b.shade)}</td>
              </tr>
            ))}
            <tr className="rest">
              <td>平均</td>
              <td colSpan={4} />
              <td className="num">{f1(sunMean)}</td>
              <td className="num">{f1(shadeMean)}</td>
            </tr>
            <tr className="rest">
              <td>平均 − 基準</td>
              <td colSpan={4} />
              <td className="num">{signed(minus(sunMean))}</td>
              <td className="num">{signed(minus(shadeMean))}</td>
            </tr>
          </tbody>
        </table>
</div>
        <ul className="basis-list">
          <li>
            <b>日なた温度</b>：日かげ温度 ＋ 0.7 × {feel.absorb} × 日射(W/m²) ÷ (10m の風 + 10)（オーストラリア気象局の体感温度の日射項。{feel.absorb} は設定の「日差しの強さ」）
          </li>
          <li>
            <b>日かげ温度</b>：改良 Missenard 式 37 − (37 − T) ÷ (0.68 − 0.0014H + 1/A) − 0.29T(1 − H/100)、A = 1.76 + 1.4v<sup>0.75</sup>（T 気温℃、H 湿度%、v 人の高さの風 m/s）
          </li>
          <li>
            <b>人の高さの風</b>：v = 観測の風 × ({PERSON_HEIGHT} ÷ 観測の高さ)<sup>{feel.alpha}</sup>（観測の高さ：実測は設定の {feel.stationHeight}m、予報は10m。指数は設定の「周りの様子」）
          </li>
        </ul>
      </section>
    </>
  );
}

function AlphaBasis() {
  const fit = useContext(BetaContext);
  const best = fit.curve?.length ? Math.min(...fit.curve.map((c) => c.sse)) : null;
  return (
    <section className="basis-sec" aria-labelledby="basis-alpha">
      <h4 id="basis-alpha">
        慣れの速さ α <b>{fit.alpha.toFixed(2)}</b>
      </h4>
      <p className="basis-note">
        {fit.status === "fitted"
          ? `感じ方の記録 ${fit.n}件（${fit.spanDays}日間）から推定しました。`
          : fit.status === "no-effect"
            ? `記録 ${fit.n}件では最近の基準の効果が見えなかったので、規格の標準値 ${STANDARD_ALPHA} を使っています。`
            : `記録が ${MIN_REPORTS}件・${MIN_SPAN_DAYS}日間に満たない（今 ${fit.n}件・${fit.spanDays}日間）ので、規格（EN 16798-1）の標準値 ${STANDARD_ALPHA} を使っています。`}
      </p>
      <p className="basis-formula">
        感じ方 ≈ b<sub>0</sub> + b<sub>1</sub>·E + γ·(気温 − A<sub>α</sub>)
      </p>
      <p className="basis-note">
        E はその場（日なた・日かげ・半々）の温度。α の候補ごとに記録へ当てはめ（最小二乗）、誤差がいちばん小さい α を選びます。基準を入れないモデル（b<sub>0</sub> + b<sub>1</sub>·E）より情報量基準 BIC が小さいときだけ採用します。
      </p>
      {fit.curve && fit.sse0 != null && best != null && (
        <>
          <div className="basis-scroll">
<table className="basis-table">
            <thead>
              <tr>
                <th>α</th>
                <th>半減期</th>
                <th>誤差（基準なし＝100）</th>
              </tr>
            </thead>
            <tbody>
              {fit.curve.map((c) => (
                <tr key={c.alpha} className={c.sse === best ? "best" : undefined}>
                  <td className="num">{c.alpha.toFixed(2)}</td>
                  <td className="num">{halfLifeDays(c.alpha)}日</td>
                  <td className="num">
                    <span className="basis-bar" style={{ width: `${Math.min(100, (c.sse / fit.sse0!) * 100)}%` }} />
                    {((c.sse / fit.sse0!) * 100).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
          <p className="basis-note">
            BIC：基準なし {fit.bic0?.toFixed(1)} ／ 基準あり {fit.bic1?.toFixed(1)}（小さい方がよい。基準ありは α と γ の2つ分の不利を含む）
          </p>
        </>
      )}
    </section>
  );
}

function PredictionBasis() {
  const fit = useContext(BetaContext);
  const [t0, t1, t2, t3] = fit.thresholds;
  const [c0, cd, cs, cn] = fit.correction.coef;
  const e = fit.errors;
  const sgn = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
  return (
    <section className="basis-sec" aria-labelledby="basis-pred">
      <h4 id="basis-pred">
        記録の画面の予測 <b>記録 {fit.correction.n}件で補正</b>
      </h4>
      <p className="basis-formula">予測 = 境目からの値(E) + 補正　（−3〜+3）</p>
      <p className="basis-note">
        E はその場の温度（日なた・日かげ・半々の平均）。境目からの値は、肌感の境目を7段階に対応させた折れ線です：{t0}℃→−2、{t1}℃→−1、{((t1 + t2) / 2).toFixed(1)}℃→0、{t2}℃→+1、{t3}℃→+2（外側は同じ傾きで延ばし、±3で止める）。
      </p>
      <p className="basis-formula">
        補正 = {sgn(c0)} {sgn(cd)}×(気温−基準) {sgn(cs)}×[風 強い] {sgn(cn)}×[風 なし]
      </p>
      <p className="basis-note">
        補正の係数は「答え − 境目からの値」へのベイズ回帰（0 を中心にした事前分布）で記録から学びます。記録が少ないうちは 0 に近く、増えるほど記録に合わせます。予測は送信した時刻の観測値で計算し直し、記録に残します。
      </p>
      <p className="basis-note">
        これまでの成績（送信時の予測と答え）：
        {e.n === 0
          ? "まだ記録がありません。"
          : `${e.n}件、偏り ${e.bias! > 0 ? "+" : ""}${e.bias?.toFixed(1)}、平均のずれ ${e.mae?.toFixed(1)}段階（直近10件 ${e.recentMae?.toFixed(1)}）、予測どおり ${Math.round((e.hit ?? 0) * 100)}%。`}
      </p>
    </section>
  );
}

function Body({ store, station, target, other }: Omit<Props, "onClose">) {
  const feel = useContext(FeelContext);
  const fit = useContext(BetaContext);
  const [side, setSide] = useState<"a" | "b">("a");
  const date = side === "a" || !other ? target : other;
  return (
    <div className="basis">
      <p className="basis-note lead">
        β版は検証中の計算です。ここに並ぶ式と値だけで、要約の「最近との差」が再現できます。体感の予測ではありません。
      </p>
      {other && (
        <Segmented
          label="どちらの日の根拠か"
          value={side}
          options={[
            { id: "a", label: `対象 ${dateLabel(target)}` },
            { id: "b", label: `比較 ${dateLabel(other, { year: other.slice(0, 4) !== target.slice(0, 4) })}` },
          ]}
          onChange={setSide}
        />
      )}
      <DayBasis store={store} station={station} date={date} alpha={fit.alpha} feel={feel} />
      <AlphaBasis />
      <PredictionBasis />
    </div>
  );
}

export function BasisSheet(props: Props) {
  return (
    <ModalSheet title="計算の根拠 β" onClose={props.onClose} className="basis-sheet">
      <Body {...props} />
    </ModalSheet>
  );
}
