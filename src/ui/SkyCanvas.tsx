// 「空を見上げる」の空の絵（見本、2026-11-27）：SkyWindow の SVG の下に、Canvas 2D で空を描く。窓と同じ投影（skyLook.ts の
// unproject）で、画面の点ごとに空の方向を出して色を決めるので、なぞって見回しても拡大しても、方位の文字・月と一緒に動く。
// 粗い格子（CELL px ごと）で計算して、なめらかに引き伸ばす（描く負荷を小さく。向き・時刻・天気が変わったときだけ描き直す）。
import { useEffect, useRef } from "react";
import { unproject } from "../../shared/skyLook";
import { type SceneInput, skyRgb } from "../../shared/skyScene";

/** 格子の大きさ（画面の px）。 */
const CELL = 6;

export function SkyCanvas({ look, focal, w, h, scene }: { look: { azimuth: number; altitude: number; roll?: number }; focal: number; w: number; h: number; scene: SceneInput }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify([look.azimuth.toFixed(2), look.altitude.toFixed(2), (look.roll ?? 0).toFixed(1), focal.toFixed(1), w, h, scene]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const gw = Math.max(8, Math.ceil(w / CELL) + 1);
    const gh = Math.max(8, Math.ceil(h / CELL) + 1);
    cv.width = gw;
    cv.height = gh;
    const g = cv.getContext("2d");
    if (!g) return;
    const img = g.createImageData(gw, gh);
    const sx = w / (gw - 1);
    const sy = h / (gh - 1);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const d = unproject(look, i * sx, j * sy, focal, w, h);
        // 地平線より下は、地平線の色を少し延ばす（地面は SVG が上に描く。境目に隙間を作らない）。
        const c = skyRgb(scene, d.azimuth, Math.max(0, d.altitude));
        const k = (j * gw + i) * 4;
        img.data[k] = c[0] * 255;
        img.data[k + 1] = c[1] * 255;
        img.data[k + 2] = c[2] * 255;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={ref} className="sky-canvas" aria-hidden />;
}
