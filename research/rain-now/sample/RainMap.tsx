// 地図：高知のまわりの雨の強さ（mm/h）を、気象庁の色の段で。予測のこまは点線の枠と「予測」の札で分ける（色だけに頼らない）。
import { useEffect, useRef } from "react";
import { BOX, CELL, colorOf, intensity, isForecast, KOCHI, minuteLabel } from "./data";

type Coast = { rings: number[][] };
const COS = Math.cos((33.5 * Math.PI) / 180);

export function RainMap({ m, coast }: { m: number; coast: Coast | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const forecast = isForecast(m);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = c.clientWidth;
    const h = Math.round((w * (BOX.n - BOX.s)) / ((BOX.e - BOX.w) * COS));
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.height = `${h}px`;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const tok = (n: string) => css.getPropertyValue(n).trim();
    const X = (lon: number) => ((lon - BOX.w) / (BOX.e - BOX.w)) * w;
    const Y = (lat: number) => ((BOX.n - lat) / (BOX.n - BOX.s)) * h;
    ctx.fillStyle = tok("--surface-inset");
    ctx.fillRect(0, 0, w, h);
    // 陸
    if (coast) {
      ctx.beginPath();
      for (const r of coast.rings) {
        for (let i = 0; i < r.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(r[i]), Y(r[i + 1]));
        ctx.closePath();
      }
      // 陸は海（面の色）に文字の色を1割重ねる（canvas は color-mix を読めない所があるため、重ね塗りで）
      ctx.fillStyle = tok("--ink-primary");
      ctx.globalAlpha = 0.1;
      ctx.fill("evenodd");
      ctx.globalAlpha = 1;
    }
    // 雨
    const cw = (CELL / (BOX.e - BOX.w)) * w;
    const ch = (CELL / (BOX.n - BOX.s)) * h;
    ctx.globalAlpha = 0.85;
    for (let lon = BOX.w; lon < BOX.e; lon += CELL)
      for (let lat = BOX.s; lat < BOX.n; lat += CELL) {
        const col = colorOf(intensity(lon + CELL / 2, lat + CELL / 2, m));
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(X(lon), Y(lat + CELL), cw + 0.6, ch + 0.6);
      }
    ctx.globalAlpha = 1;
    // 海岸線
    if (coast) {
      ctx.beginPath();
      for (const r of coast.rings) {
        for (let i = 0; i < r.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(r[i]), Y(r[i + 1]));
        ctx.closePath();
      }
      ctx.strokeStyle = tok("--line-strong");
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // 地点
    const kx = X(KOCHI.lon);
    const ky = Y(KOCHI.lat);
    ctx.beginPath();
    ctx.arc(kx, ky, 5, 0, Math.PI * 2);
    ctx.fillStyle = tok("--ink-primary");
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = tok("--surface-base");
    ctx.stroke();
    ctx.font = `600 13px ${tok("--font-family")}`;
    ctx.fillStyle = tok("--ink-primary");
    ctx.fillText(KOCHI.name, kx + 8, ky - 6);
    // 縮尺 50km
    const km50 = (50 / (111 * COS) / (BOX.e - BOX.w)) * w;
    ctx.fillStyle = tok("--ink-secondary");
    ctx.fillRect(w - 12 - km50, h - 14, km50, 2);
    ctx.font = `11px ${tok("--font-family")}`;
    ctx.fillText("50km", w - 12 - km50, h - 18);
  }, [m, coast]);
  return (
    <figure className={`rn-map${forecast ? " forecast" : ""}`}>
      <canvas ref={ref} className="rn-canvas" role="img" aria-label={`${minuteLabel(m)}の雨の強さ（${forecast ? "予測" : "実況"}）`} />
      <span className={`rn-when${forecast ? " forecast" : ""}`}>
        <b>{minuteLabel(m)}</b>
        {forecast ? "予測" : m === 0 ? "実況（今）" : "実況"}
      </span>
    </figure>
  );
}
