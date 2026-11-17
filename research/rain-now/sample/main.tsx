// 雨の見込み（地図とグラフ）の見本。データは作ったもの（data.ts）。本番は気象庁の「雨雲の動き」と「今後の雨」を
// その場で読み、過去の1時間ごとの量はアメダス。保存は要らない（雨雲レーダー・解析雨量の保存は振り返り用）。
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles.css";
import { applyTheme } from "../../../src/design/tokens";
import { aheadItems, frameLabel, FRAMES, HOURLY_FRAMES, isAmount, isMissing, isStale, legendTitle, minuteLabel, NOWCAST, relLabel, type SampleState, SCALE, sources, SPEED_UP, STEP_MS, type Zoom } from "./data";
import { type Span, SPANS, TimeGraph } from "./TimeGraph";
import { Segmented } from "../../../src/ui/kit";
import { RainMap } from "./RainMap";
import "./sample.css";

applyTheme("navy");

function App() {
  const [m, setM] = useState(0);
  const [play, setPlay] = useState(false);
  const [zoom, setZoom] = useState<Zoom>(8);
  const [span, setSpan] = useState<Span>("6");
  // 見本だけの切り替え：取れなかったこまや古いデータのときの見え方を確かめるため（本番には無い）
  const [state, setState] = useState<SampleState>("ok");
  const src = sources(state);
  const stale = [src.nowcast, src.hourly].filter(isStale);
  const miss = (x: number) => isMissing(x, state);
  const [coast, setCoast] = useState<{ rings: number[][] } | null>(null);
  useEffect(() => {
    fetch("./coast.json")
      .then((r) => r.json())
      .then(setCoast)
      .catch(() => setCoast(null));
  }, []);
  // 再生：今から先へ進み、いちばん先まで行ったら今に戻って止まる（過去はつまみで戻って見る）。いま見ているこまが
  // 今より前なら、そこから進む。こまの刻みに合わせて出す時間を変え（data.ts の STEP_MS）、刻みが変わる所（1時間後）で
  // 一度止めて知らせる。勝手には再生しない（動きを減らす設定の人にも、押すまで動かない）。
  const [note, setNote] = useState<string | null>(null);
  const LAST = FRAMES.at(-1)!;
  const startPlay = () => {
    if (play) return setPlay(false);
    if (m === LAST) setM(0);
    setPlay(true);
  };
  useEffect(() => {
    if (!play) return setNote(null);
    if (m === LAST) {
      // いちばん先：少し見せてから今に戻して止める
      setNote("ここまで（15時間後）");
      const t = window.setTimeout(() => (setPlay(false), setM(0)), 1400);
      return () => window.clearTimeout(t);
    }
    const next = FRAMES[FRAMES.indexOf(m) + 1];
    const crossing = !isAmount(m) && isAmount(next);
    setNote(crossing ? "ここから1時間ごと（今後の雨）" : isAmount(m) ? `1時間ごと・${SPEED_UP}倍速` : null);
    const wait = crossing ? 1400 : isAmount(m) ? STEP_MS.hour : STEP_MS.five;
    const t = window.setTimeout(() => setM(next), wait);
    return () => window.clearTimeout(t);
  }, [play, m]);
  const i = FRAMES.indexOf(m);
  const go = (x: number) => {
    setPlay(false);
    setM(x);
    // 選んだ時刻がグラフの幅の外なら、入る幅に広げる（上下は同じ幅のまま）
    if (x > SPANS[span].to) setSpan(x > SPANS["12"].to ? "24" : "12");
  };
  return (
    <main className="rn-page">
      <h1 className="rn-title">雨の見込み</h1>
      <p className="rn-note">見本：作ったデータです（本物の雨ではありません）。地点は高知。</p>
      <div className="rn-span">
        <Segmented
          label="見本の状態"
          value={state}
          onChange={setState}
          options={[
            { id: "ok", label: "ふつう" },
            { id: "missing", label: "取れないこま" },
            { id: "stale", label: "古いデータ" },
          ]}
        />
      </div>
      <section className="rn-card">
        {/* データの新しさ：発表の時刻をいつも出す。古いときは上に知らせる（地図・グラフ・言葉はその時点のもの） */}
        {stale.length > 0 && (
          <p className="rn-stale" role="status">
            <b>新しいデータが取れていません</b>
            {stale.map((s) => (
              <span key={s.name}>
                {s.name}は{minuteLabel(s.issued)}発表（{relLabel(s.issued)}）のままです。
              </span>
            ))}
          </p>
        )}
        <div className="rn-say">
          {aheadItems(state).map((it) => (
            <div key={it.label} className="rn-say-item">
              <small>{it.label}</small>
              <b>{it.value}</b>
              {it.sub && <span>{it.sub}</span>}
            </div>
          ))}
        </div>
        <RainMap m={m} coast={coast} zoom={zoom} onZoom={setZoom} note={play ? note : null} missing={miss(m)} />
        {/* 時刻を動かす：地図のすぐ下に、つまみと操作を1列に */}
        <input
          type="range"
          className="rn-scrub"
          min={0}
          max={FRAMES.length - 1}
          value={i}
          onChange={(e) => go(FRAMES[Number(e.target.value)])}
          aria-label="地図の時刻"
          aria-valuetext={`${frameLabel(m)} ${relLabel(m)}${isAmount(m) ? " 1時間の量の予測" : m > 0 ? " 予測" : " 実況"}${miss(m) ? " 取れなかった" : ""}`}
        />
        {/* つまみの下：どこまでが5分ごとの強さで、どこからが1時間ごとの量か */}
        <div className="rn-scale">
          <span style={{ flex: NOWCAST.length - 1 }}>
            <i>3時間前</i>
            <i>今</i>
            <i>1時間後</i>
          </span>
          <span style={{ flex: HOURLY_FRAMES.length }} className="hourly">
            <i>15時間後</i>
          </span>
        </div>
        <div className="rn-ctl">
          <button className="rn-btn" aria-label="5分前" onClick={() => go(FRAMES[Math.max(0, i - 1)])}>
            ◀
          </button>
          <button className={`rn-btn wide${play ? " on" : ""}`} aria-pressed={play} onClick={startPlay}>
            {play ? "停止" : "再生"}
          </button>
          <button className="rn-btn" aria-label="5分後" onClick={() => go(FRAMES[Math.min(FRAMES.length - 1, i + 1)])}>
            ▶
          </button>
          <button className="rn-btn wide" onClick={() => go(0)}>
            今に戻る
          </button>
        </div>
        {/* 凡例：見出しでこまが表すもの（強さ mm/h か、1時間の量 mm か）を先に言う。色の段は同じでも物が違う */}
        <div className="rn-legend" aria-label={`凡例：${legendTitle(m)}`}>
          <b className={`rn-legend-title${isAmount(m) ? " amount" : ""}`} aria-live="polite">{legendTitle(m)}</b>
          {SCALE.map((sc) => (
            <span key={sc.label}>
              <i style={{ background: sc.color }} />
              {sc.label}
            </span>
          ))}
          <span className="rn-here">＋ 現在地（見本は仮の位置）</span>
        </div>
        <div className="rn-span">
          <Segmented
            label="グラフの幅"
            value={span}
            onChange={setSpan}
            options={[
              { id: "6", label: "6時間" },
              { id: "12", label: "12時間" },
              { id: "24", label: "24時間" },
            ]}
          />
        </div>
        <TimeGraph m={m} span={span} onPick={go} missing={miss} />
        <p className={`rn-issued${stale.length ? " stale" : ""}`}>
          {[src.nowcast, src.hourly].map((s) => (
            <span key={s.name}>
              {s.name} {minuteLabel(s.issued)}発表
            </span>
          ))}
        </p>
        <p className="rn-credit">出典（本番）：気象庁「雨雲の動き」「今後の雨」・アメダス。</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
