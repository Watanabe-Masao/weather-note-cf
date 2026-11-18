// センサーの値（確かめ用、2026-11-19）：端末を縦・横・見上げ・傾けに持ったとき、向きのセンサーの生の値と、行列で出した
// 方位・高さ・ロール（shared/skyLook.ts deviceLook）を並べる。iPhone の横向きでの webkitCompassHeading と
// screen.orientation.angle のふるまいを実機で確かめ、方位の合わせ方を決めるため（調査 #334）。決まったら外す。
import { useEffect, useRef, useState } from "react";
import { deviceLook } from "../../shared/skyLook";

type Raw = { alpha: number | null; beta: number | null; gamma: number | null; compass: number | null; absolute: boolean; type: string };

const screenAngle = () => {
  const o = typeof screen !== "undefined" ? (screen.orientation as ScreenOrientation | undefined) : undefined;
  if (o && typeof o.angle === "number") return { angle: o.angle, type: o.type };
  const w = (window as unknown as { orientation?: number }).orientation;
  return { angle: typeof w === "number" ? (w + 360) % 360 : 0, type: "window.orientation" };
};
const f1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(1));

export function SkyDebug({ look }: { look: { azimuth: number; altitude: number } | null }) {
  const raw = useRef<Raw | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const on = (ev: Event) => {
      const e = ev as DeviceOrientationEvent & { webkitCompassHeading?: number };
      raw.current = { alpha: e.alpha, beta: e.beta, gamma: e.gamma, compass: e.webkitCompassHeading ?? null, absolute: e.absolute, type: ev.type };
    };
    window.addEventListener("deviceorientation", on);
    window.addEventListener("deviceorientationabsolute", on);
    const id = window.setInterval(() => tick((n) => n + 1), 200);
    return () => {
      window.removeEventListener("deviceorientation", on);
      window.removeEventListener("deviceorientationabsolute", on);
      window.clearInterval(id);
    };
  }, []);
  const r = raw.current;
  const s = screenAngle();
  const m = r && r.alpha != null && r.beta != null && r.gamma != null ? deviceLook(r.alpha, r.beta, r.gamma, s.angle) : null;
  const diff = m?.azimuth != null && r?.compass != null ? ((((r.compass - m.azimuth) % 360) + 540) % 360) - 180 : null;
  return (
    <pre className="sky-debug" aria-label="センサーの値（確かめ用）">
      {`画面 ${s.angle}°（${s.type}）\n`}
      {`α ${f1(r?.alpha)}  β ${f1(r?.beta)}  γ ${f1(r?.gamma)}  ${r ? (r.absolute ? "絶対" : "相対") : ""}\n`}
      {`コンパス ${f1(r?.compass)}\n`}
      {`行列 方位 ${f1(m?.azimuth)} 高さ ${f1(m?.altitude)} ロール ${f1(m?.roll)}\n`}
      {`差（コンパス−行列）${f1(diff)}\n`}
      {`今の表示 方位 ${f1(look?.azimuth)} 高さ ${f1(look?.altitude)}`}
    </pre>
  );
}
