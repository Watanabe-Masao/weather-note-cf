// 雨の見込み（地図とグラフ）の見本。データは作ったもの（data.ts）。本番は気象庁の「雨雲の動き」と「今後の雨」を
// その場で読み、過去の1時間ごとの量はアメダス。保存は要らない（雨雲レーダー・解析雨量の保存は振り返り用）。
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles.css";
import { applyTheme } from "../../../src/design/tokens";
import { aheadItems, frameLabel, FRAMES, HOURLY_FRAMES, isAmount, NOWCAST, SCALE, type Zoom } from "./data";
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
  const [coast, setCoast] = useState<{ rings: number[][] } | null>(null);
  useEffect(() => {
    fetch("./coast.json")
      .then((r) => r.json())
      .then(setCoast)
      .catch(() => setCoast(null));
  }, []);
  useEffect(() => {
    if (!play) return;
    const t = window.setInterval(() => setM((x) => FRAMES[(FRAMES.indexOf(x) + 1) % FRAMES.length] ?? 0), 450);
    return () => window.clearInterval(t);
  }, [play]);
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
      <section className="rn-card">
        <div className="rn-say">
          {aheadItems().map((it) => (
            <div key={it.label} className="rn-say-item">
              <small>{it.label}</small>
              <b>{it.value}</b>
              {it.sub && <span>{it.sub}</span>}
            </div>
          ))}
        </div>
        <RainMap m={m} coast={coast} zoom={zoom} onZoom={setZoom} />
        {/* 時刻を動かす：地図のすぐ下に、つまみと操作を1列に */}
        <input
          type="range"
          className="rn-scrub"
          min={0}
          max={FRAMES.length - 1}
          value={i}
          onChange={(e) => go(FRAMES[Number(e.target.value)])}
          aria-label="地図の時刻"
          aria-valuetext={`${frameLabel(m)}${isAmount(m) ? " 1時間の量の予測" : m > 0 ? " 予測" : " 実況"}`}
        />
        {/* つまみの下：どこまでが5分ごとの強さで、どこからが1時間ごとの量か */}
        <div className="rn-scale">
          <span style={{ flex: NOWCAST.length - 1 }}>
            <i>3時間前</i>
            <i>今</i>
            <i>1時間先</i>
          </span>
          <span style={{ flex: HOURLY_FRAMES.length }} className="hourly">
            <i>15時間先</i>
          </span>
        </div>
        <div className="rn-ctl">
          <button className="rn-btn" aria-label="5分前" onClick={() => go(FRAMES[Math.max(0, i - 1)])}>
            ◀
          </button>
          <button className={`rn-btn wide${play ? " on" : ""}`} aria-pressed={play} onClick={() => setPlay((p) => !p)}>
            {play ? "停止" : "再生"}
          </button>
          <button className="rn-btn" aria-label="5分後" onClick={() => go(FRAMES[Math.min(FRAMES.length - 1, i + 1)])}>
            ▶
          </button>
          <button className="rn-btn wide" onClick={() => go(0)}>
            今に戻る
          </button>
        </div>
        <div className="rn-legend" aria-label="雨の強さ（mm/h）">
          {SCALE.map((sc) => (
            <span key={sc.label}>
              <i style={{ background: sc.color }} />
              {sc.label}
            </span>
          ))}
          <small>{isAmount(m) ? "mm（1時間の量）" : "mm/h（強さ）"}</small>
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
        <TimeGraph m={m} span={span} onPick={go} />
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
