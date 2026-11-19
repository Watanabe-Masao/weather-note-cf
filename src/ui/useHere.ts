// 現在地で太陽と月を計算する（2026-11-19 渡辺さん「現在地を使えますか？緯度経度から計算」）。
//
// 端末の位置（緯度・経度）を、太陽と月の計算だけに使う。天気・気温・予報は観測所のまま。
// 位置は端末の中だけで使い、保存も送信もしない（カメラと同じ）。覚えるのは「現在地を使う」という選び方だけ。
// 座標は 0.01°（約 1km）に丸めてから使う（細かい場所は要らない、画面にも丸めた値だけ）。
import { useCallback, useEffect, useRef, useState } from "react";

export type HereState =
  | { kind: "off" }
  | { kind: "asking" }
  | { kind: "on"; lat: number; lon: number }
  | { kind: "denied" }
  | { kind: "unavailable" };

const KEY = "wn.sunHere";
const round = (v: number) => Math.round(v * 100) / 100;

function remembered(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
function remember(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // 覚えられなくても動く（次に開いたときは観測所から）
  }
}

export function useHere() {
  const [state, setState] = useState<HereState>({ kind: "off" });
  const turn = useRef(0); // 読んでいる間にやめたら、あとから届いた位置は使わない
  const ask = useCallback(() => {
    const mine = ++turn.current;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ kind: "unavailable" });
      return;
    }
    setState({ kind: "asking" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (mine !== turn.current) return;
        remember(true);
        setState({ kind: "on", lat: round(p.coords.latitude), lon: round(p.coords.longitude) });
      },
      (e) => {
        if (mine !== turn.current) return;
        remember(false);
        setState({ kind: e.code === 1 ? "denied" : "unavailable" });
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 10_000 },
    );
  }, []);
  const stop = useCallback(() => {
    turn.current++;
    remember(false);
    setState({ kind: "off" });
  }, []);
  // 前に「現在地を使う」にしていたら、開いたときにもう一度位置を読む（許可済みなら聞き直されない）。
  useEffect(() => {
    if (remembered()) ask();
  }, [ask]);
  return { state, ask, stop };
}

/** 画面に出す座標（丸めた値、北緯・東経）。 */
export const latLonText = (lat: number, lon: number) => `${lat >= 0 ? "北緯" : "南緯"} ${Math.abs(lat).toFixed(2)}°・${lon >= 0 ? "東経" : "西経"} ${Math.abs(lon).toFixed(2)}°`;
