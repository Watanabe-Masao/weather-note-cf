// 雨の見込み（地図とグラフ）の見本。データは作ったもの（data.ts）。本番は気象庁の「雨雲の動き」と「今後の雨」を
// その場で読み、過去の1時間ごとの量はアメダス。保存は要らない（雨雲レーダー・解析雨量の保存は振り返り用）。
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles.css";
import { applyTheme } from "../../../src/design/tokens";
import { aheadItems, FRAMES, minuteLabel, SCALE, type Zoom } from "./data";
import { type Span, TimeGraph } from "./TimeGraph";
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
    const t = window.setInterval(() => setM((x) => (x >= 60 ? -60 : x + 5)), 500);
    return () => window.clearInterval(t);
  }, [play]);
  const i = FRAMES.indexOf(m);
  const go = (x: number) => (setPlay(false), setM(x));
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
          aria-valuetext={`${minuteLabel(m)}${m > 0 ? " 予測" : " 実況"}`}
          style={{ ["--now" as string]: `${(FRAMES.indexOf(0) / (FRAMES.length - 1)) * 100}%` }}
        />
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
          <small>mm/h</small>
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
