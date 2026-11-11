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
import { beyondRange, DRIVERS, type DriverKey, ensembleState, interval, type ModelSpec, paramNames, stateOf } from "./comfort";
import { BetaContext } from "./settings";
import { baselineStateOf, driversOfDay } from "./useBaseline";

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

/** One parameter, for people: what it is, and how to show its value (levels on their own scale). */
function describeParam(name: string): { what: string; show: (v: number) => string; effect: boolean } {
  const [kind, key] = name.includes(":") ? name.split(":") : [name, ""];
  const d = key ? DRIVERS[key as DriverKey] : null;
  switch (kind) {
    case "m0":
      return { what: "中心（どの要因もふつうのとき）", show: (v) => `${v.toFixed(1)}℃`, effect: false };
    case "l0":
      return { what: "範囲の半分の幅（ふつうのとき）", show: (v) => `${Math.exp(v).toFixed(1)}℃`, effect: false };
    case "q0":
      return { what: "範囲の外の1段階の幅", show: (v) => `${Math.exp(v).toFixed(1)}℃`, effect: false };
    case "r0":
      return { what: "境目のぼやけ", show: (v) => `${Math.exp(v).toFixed(2)}℃`, effect: false };
    case "wS":
      return { what: "風が強いときのその場の温度のずれ", show: (v) => `${v.toFixed(1)}℃`, effect: true };
    case "wN":
      return { what: "風がないときのその場の温度のずれ", show: (v) => `${v.toFixed(1)}℃`, effect: true };
    case "中心":
      return { what: `${d!.label}（${d!.unit}ごとの中心の動き）`, show: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}℃`, effect: true };
    case "範囲":
      return { what: `${d!.label}（${d!.unit}ごとの範囲の幅の倍率）`, show: (v) => `×${Math.exp(v).toFixed(2)}`, effect: true };
    default:
      return { what: `${d!.label}（${d!.unit}ごとのその場の温度の上がり）`, show: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}℃`, effect: true };
  }
}

const driversText = (m: ModelSpec) =>
  [
    m.mu.length ? `中心：${m.mu.map((k) => DRIVERS[k].label).join("・")}` : "",
    m.h.length ? `範囲：${m.h.map((k) => DRIVERS[k].label).join("・")}` : "",
    m.e?.length ? `その場：${m.e.map((k) => DRIVERS[k].label).join("・")}` : "",
  ]
    .filter(Boolean)
    .join("／") || "動かない（比較の基準）";

/** The models side by side, then one model's parameters (prior → now, 95% interval). */
function ComfortBasis() {
  const beta = useContext(BetaContext);
  const { ens, record: r, records } = beta;
  const best = ens.weights.indexOf(Math.max(...ens.weights));
  const [chosen, setChosen] = useState<number>(best);
  const fit = ens.fits[chosen] ?? ens.fits[best];
  const names = paramNames(fit.model);
  return (
    <>
      <section className="basis-sec" aria-labelledby="basis-models">
        <h4 id="basis-models">
          モデルの比較 <b>記録 {ens.n}件{beta.fitting ? "・計算中" : ""}</b>
        </h4>
        <p className="basis-formula">
          中心 μ = m0 + Σ 係数 × 中心の要因
          <br />
          範囲の半分 h = e^(l0 + Σ 係数 × 範囲の要因)
          <br />
          境目 = μ ± h, μ ± (h + g), μ ± (h + 2g)
          <br />
          P(答え ≤ k) = σ((境目 − (E′ − μ)) ÷ s)
          <br />
          E′ = E + Σ 係数 × その場の要因 + 風のずれ
        </p>
        <p className="basis-note">
          要因の組み合わせが違うモデルを並べて当てはめ、比べます。重みは「証拠の強さ」（周辺尤度のラプラス近似）から出し、要因が多いほど不利になるので、当てはめすぎたモデルは得をしません。画面の予測は重みで混ぜたものです。成績は、送信のたびに各モデルが出していた予測と答えの比較です。
        </p>
        <div className="basis-scroll">
          <table className="basis-table">
            <thead>
              <tr>
                <th>モデル</th>
                <th>重み</th>
                <th>成績</th>
              </tr>
            </thead>
            <tbody>
              {ens.fits.map((f, i) => {
                const rec = records[f.model.id];
                return (
                  <tr key={f.model.id} className={i === best ? "best" : undefined} onClick={() => setChosen(i)} style={{ cursor: "pointer" }}>
                    <td className="wrap">
                      {f.model.id} {f.model.name}
                      <small>
                        <br />
                        {driversText(f.model)}
                      </small>
                    </td>
                    <td className="num">{Math.round(ens.weights[i] * 100)}%</td>
                    <td className="num">{rec && rec.n ? `損失 ${rec.logLoss?.toFixed(2)}・当たり ${Math.round((rec.hit ?? 0) * 100)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="basis-note">
          M6（暦の季節）は確認用です。気温の履歴のモデル（M4 など）より強い証拠を得たら、春と秋の違いは気温の履歴だけでは説明しきれない（服装や日の長さなど）ことになります。
          {ens.n < beta.minForAlpha ? ` α は記録が${beta.minForAlpha}件たまってから選びます（今は標準の0.8）。` : ` α（${ens.alpha.toFixed(2)}・半減期 ${halfLifeDays(ens.alpha)}日）は記録の当てはまりで選んでいます。`}
        </p>
        <p className="basis-note">
          混ぜた予測の成績：
          {r.n === 0
            ? "まだ記録がありません。"
            : `${r.n}件、対数損失 ${r.logLoss?.toFixed(2)}（当てずっぽうは 1.95）、当たり ${Math.round((r.hit ?? 0) * 100)}%、偏り ${r.bias! > 0 ? "+" : ""}${r.bias?.toFixed(1)}、平均のずれ ${r.mae?.toFixed(1)}段階（直近10件 ${r.recentMae?.toFixed(1)}）。`}
        </p>
      </section>

      <section className="basis-sec" aria-labelledby="basis-params">
        <h4 id="basis-params">
          {fit.model.id} {fit.model.name}の中身 <b>重み {Math.round(ens.weights[ens.fits.indexOf(fit)] * 100)}%</b>
        </h4>
        <p className="basis-note">上の表の行を押すと、そのモデルの中身に切り替わります。初めの値は肌感の境目から作った事前分布、今の値は記録からの推定です。</p>
        <div className="basis-scroll">
          <table className="basis-table">
            <thead>
              <tr>
                <th>要素</th>
                <th>初め</th>
                <th>今</th>
                <th>95%区間</th>
              </tr>
            </thead>
            <tbody>
              {names.map((name, i) => {
                const d = describeParam(name);
                const [lo, hi] = interval(fit, (t) => t[i]);
                const spans = d.effect && lo < 0 && hi > 0;
                return (
                  <tr key={name} className={d.effect && !spans ? "best" : undefined}>
                    <td className="wrap">
                      {d.what}
                      {d.effect && <small>{spans ? "　まだ分からない" : "　効いている"}</small>}
                    </td>
                    <td className="num">{d.show(fit.prior.mean[i])}</td>
                    <td className="num">{d.show(fit.theta[i])}</td>
                    <td className="num">
                      {d.show(lo)}〜{d.show(hi)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** The day's centre and range (weighted over the models), and where 日なた／日かげ sit. */
function ComfortDay({ store, station, date, feel }: { store: WeatherStore | null; station: string; date: string; feel: FeelSettings }) {
  const beta = useContext(BetaContext);
  const rows = store?.getHours(station, date).rows ?? [];
  const row = store?.getDay(station, date).row;
  const hNow = num(row?.humidity);
  const sun = daytimeFeel(rows, { ...feel, sun: true });
  const shade = daytimeFeel(rows, { ...feel, sun: false });
  const x = driversOfDay(store, station, date, beta.alpha, sun ?? shade, hNow, { hour: 12 });
  if (!x) {
    return (
      <section className="basis-sec">
        <h4>この日の快適の中心と範囲</h4>
        <p className="basis-note">最近の基準が出せないか、日中の時間別データがないため、出せません。</p>
      </section>
    );
  }
  const st = ensembleState(beta.ens, x);
  const best = beta.ens.fits[beta.ens.weights.indexOf(Math.max(...beta.ens.weights))];
  const [muLo, muHi] = interval(best, (t) => stateOf(best.model, t, x).mu);
  const [hLo, hHi] = interval(best, (t) => Math.log(stateOf(best.model, t, x).h)).map(Math.exp);
  const place = (e: number | null) =>
    e == null ? "—" : `${signed(Math.round((e - st.mu) * 10) / 10)}（${beyondRange(st, e) === 0 ? "範囲の中" : `範囲の外 ${signed(Math.round(beyondRange(st, e) * 10) / 10)}`}）`;
  return (
    <section className="basis-sec" aria-labelledby="basis-cday">
      <h4 id="basis-cday">
        この日の快適の中心と範囲 <b>{f1(st.mu)}℃（{f1(st.mu - st.h)}〜{f1(st.mu + st.h)}）</b>
      </h4>
      <ul className="basis-list">
        <li>
          入力：最近の基準 {f1(x.a)}℃、前日の変化 {signed(x.dT1 == null ? null : Math.round(x.dT1 * 10) / 10)}℃、季節の向き {signed(x.trend == null ? null : Math.round(x.trend * 10) / 10)}℃/週、1週間の湿度 {x.h7 == null ? "—" : Math.round(x.h7)}%、前日の湿度 {x.h1 == null ? "—" : Math.round(x.h1)}%、1週間の気温の振れ {f1(x.v7)}℃、前日の日照 {f1(x.sun1)}時間、前日の雨 {f1(x.rain1)}mm、前夜の冷え込み（前日の最低 − 基準） {signed(x.minPrev == null ? null : Math.round(x.minPrev * 10) / 10)}℃、前夜の風（18〜6時の平均） {f1(x.windPrev)}m/s、この日の湿度 {hNow == null ? "—" : Math.round(hNow)}%
        </li>
        <li>
          重みで混ぜた中心 μ = {f1(st.mu)}℃、範囲の半分 h = {f1(st.h)}℃、外の1段階 g = {f1(st.g)}℃
        </li>
        <li>
          いちばん重い {best.model.id} での95%区間：中心 {f1(muLo)}〜{f1(muHi)}℃、範囲の半分 {f1(hLo)}〜{f1(hHi)}℃
        </li>
        <li>日中の日なた温度 {f1(sun)}℃：中心から {place(sun)}</li>
        <li>日中の日かげ温度 {f1(shade)}℃：中心から {place(shade)}</li>
      </ul>
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
      <ComfortDay store={store} station={station} date={date} feel={feel} />
      <ComfortBasis />
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
