// 雨の見込み（地図とグラフ）の見本。データは作ったもの（data.ts）。本番は気象庁の「雨雲の動き」と「今後の雨」を
// その場で読み、過去の1時間ごとの量はアメダス。保存は要らない（雨雲レーダー・解析雨量の保存は振り返り用）。
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles.css";
import { applyTheme } from "../../../src/design/tokens";
import { FRAMES, minuteLabel, SCALE, sayAhead } from "./data";
import { AmountGraph, StrengthGraph } from "./RainGraph";
import { RainMap } from "./RainMap";
import "./sample.css";

applyTheme("navy");

function App() {
  const [m, setM] = useState(0);
  const [play, setPlay] = useState(false);
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
  return (
    <main className="rn-page">
      <h1 className="rn-title">雨の見込み</h1>
      <p className="rn-note">見本：作ったデータです（本物の雨ではありません）。地点は高知。</p>
      <section className="rn-card">
        <p className="rn-say">{sayAhead()}</p>
        <RainMap m={m} coast={coast} />
        <div className="rn-ctl">
          <button className="rn-btn" aria-label="5分前" onClick={() => setM(FRAMES[Math.max(0, i - 1)])}>
            ◀
          </button>
          <button className={`rn-btn wide${play ? " on" : ""}`} aria-pressed={play} onClick={() => setPlay((p) => !p)}>
            {play ? "止める" : "動かす"}
          </button>
          <button className="rn-btn" aria-label="5分後" onClick={() => setM(FRAMES[Math.min(FRAMES.length - 1, i + 1)])}>
            ▶
          </button>
          <button className="rn-btn wide" onClick={() => (setPlay(false), setM(0))}>
            今
          </button>
        </div>
        <div className="rn-legend" aria-label="雨の強さ（mm/h）">
          {SCALE.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
          <small>mm/h</small>
        </div>
        <h2 className="rn-sub">
          高知の雨の強さ（mm/h）<small>5分ごと・押すとその時刻の地図</small>
        </h2>
        <StrengthGraph m={m} onPick={(x) => (setPlay(false), setM(x))} />
        <h2 className="rn-sub">
          1時間ごとの雨の量（mm）<small>実績はアメダス、この先は今後の雨</small>
        </h2>
        <AmountGraph />
        <p className="rn-credit">
          出典（本番）：気象庁「雨雲の動き」「今後の雨」・アメダス。選んだ時刻：{minuteLabel(m)}
        </p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
