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
  | { kind: "unavailable" }
  | { kind: "outside" };

/**
 * 日本の中か（2026-11-19 渡辺さん：海外の現在地は使わない）。太陽と月の計算と画面は日本時間の1日を前提にしているので、
 * 外の位置は観測所に戻す。だいたいの四角（北緯 20〜46°・東経 122〜154°、与那国島・南鳥島・沖ノ鳥島・択捉島を含む）。
 * 四角なので朝鮮半島やウラジオストクの一部も入るが、朝鮮半島は日本と同じ時間帯（ずれるのはウラジオストクの1時間だけ）。
 */
export const inJapan = (lat: number, lon: number) => lat >= 20 && lat <= 46 && lon >= 122 && lon <= 154;

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
        const [lat, lon] = [round(p.coords.latitude), round(p.coords.longitude)];
        if (!inJapan(lat, lon)) {
          remember(false);
          setState({ kind: "outside" });
          return;
        }
        remember(true);
        setState({ kind: "on", lat, lon });
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
