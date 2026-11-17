// 地図：地点のまわりの雨の強さ（mm/h、気象庁の色の段）。＋−で段階8（四国全体）〜10（高知市のまわり）まで寄せる。
// 予測のこまは「予測」の札と灰の枠（色味のある色は「選んでいる」印だけ、design-system 1章）。
import { useEffect, useRef } from "react";
import { colorOf, frameLabel, HERE, isAmount, isForecast, KOCHI, relLabel, valueAt, viewOf, ZOOMS, type Zoom } from "./data";

type Coast = { rings: number[][] };
const COS = Math.cos((33.5 * Math.PI) / 180);

export function RainMap({ m, coast, zoom, onZoom, note }: { m: number; coast: Coast | null; zoom: Zoom; onZoom: (z: Zoom) => void; note?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const forecast = isForecast(m);
  const v = viewOf(zoom);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = c.clientWidth;
    const h = Math.round((w * (v.n - v.s)) / ((v.e - v.w) * COS));
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.height = `${h}px`;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const tok = (n: string) => css.getPropertyValue(n).trim();
    const X = (lon: number) => ((lon - v.w) / (v.e - v.w)) * w;
    const Y = (lat: number) => ((v.n - lat) / (v.n - v.s)) * h;
    const trace = () => {
      if (!coast) return;
      ctx.beginPath();
      for (const r of coast.rings) {
        for (let i = 0; i < r.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(r[i]), Y(r[i + 1]));
        ctx.closePath();
      }
    };
    ctx.fillStyle = tok("--surface-inset");
    ctx.fillRect(0, 0, w, h);
    // 陸は海（面の色）に文字の色を1割重ねる（canvas は color-mix を読めない所があるため、重ね塗りで）
    trace();
    ctx.fillStyle = tok("--ink-primary");
    ctx.globalAlpha = 0.1;
    ctx.fill("evenodd");
    // 雨
    const cw = (v.cell / (v.e - v.w)) * w;
    const ch = (v.cell / (v.n - v.s)) * h;
    ctx.globalAlpha = 0.85;
    for (let lon = v.w; lon < v.e; lon += v.cell)
      for (let lat = v.s; lat < v.n; lat += v.cell) {
        const col = colorOf(valueAt(lon + v.cell / 2, lat + v.cell / 2, m));
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(X(lon), Y(lat + v.cell), cw + 0.6, ch + 0.6);
      }
    ctx.globalAlpha = 1;
    trace();
    ctx.strokeStyle = tok("--line-strong");
    ctx.lineWidth = 1;
    ctx.stroke();
    // 地点：印と、背景つきの名前（雨の色や海岸線と重ならないように）
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
    const tw = ctx.measureText(KOCHI.name).width;
    ctx.fillStyle = tok("--surface-base");
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    // 名前は地点の左上に（現在地の「＋」と重なりにくいように）
    ctx.roundRect(kx - tw - 19, ky - 24, tw + 10, 20, 6);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = tok("--ink-primary");
    ctx.fillText(KOCHI.name, kx - tw - 14, ky - 9);
    // 現在地：「＋」の印だけ（値は出さない）。縁取りをして雨の色の上でも見えるように
    const hx = X(HERE.lon);
    const hy = Y(HERE.lat);
    ctx.lineCap = "round";
    for (const [col, wd] of [[tok("--surface-base"), 5], [tok("--ink-primary"), 2]] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = wd;
      ctx.beginPath();
      ctx.moveTo(hx - 7, hy);
      ctx.lineTo(hx + 7, hy);
      ctx.moveTo(hx, hy - 7);
      ctx.lineTo(hx, hy + 7);
      ctx.stroke();
    }
    // 縮尺
    const bar = (v.km / (111 * COS) / (v.e - v.w)) * w;
    ctx.fillStyle = tok("--ink-secondary");
    ctx.fillRect(w - 12 - bar, h - 14, bar, 2);
    ctx.font = `11px ${tok("--font-family")}`;
    ctx.fillText(`${v.km}km`, w - 12 - bar, h - 18);
  }, [m, coast, v]);
  const i = ZOOMS.indexOf(zoom);
  return (
    <figure className={`rn-map${forecast ? " forecast" : ""}`}>
      <canvas ref={ref} className="rn-canvas" role="img" aria-label={`${frameLabel(m)}の${isAmount(m) ? "1時間の降水量" : "雨の強さ"}（${forecast ? "予測" : "実況"}）`} />
      <span className={`rn-when${forecast ? " forecast" : ""}`}>
        <b>{frameLabel(m)}</b>
        <span>
          {relLabel(m)}・{isAmount(m) ? "予測（1時間の量）" : forecast ? "予測" : "実況"}
        </span>
      </span>
      {note && <span className="rn-playnote">{note}</span>}
      <span className="rn-zoom">
        <button aria-label="寄せる" disabled={i === ZOOMS.length - 1} onClick={() => onZoom(ZOOMS[i + 1])}>
          ＋
        </button>
        <button aria-label="引く" disabled={i === 0} onClick={() => onZoom(ZOOMS[i - 1])}>
          −
        </button>
      </span>
    </figure>
  );
}
