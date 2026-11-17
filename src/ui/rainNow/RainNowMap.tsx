// 地図：気象庁のタイル（雨の強さ、または1時間の量）を、地点を真ん中にして並べる。段階 8（四国全体）〜10（高知市の
// まわり）。下地は海岸線だけ（Natural Earth）、地点の印と名前、現在地は「＋」の印だけ（値は出さない）。
// 予測のこまは「予測」の札と灰の枠（色味のある色は「選んでいる」印だけ）。取れなかったタイルは描かず、
// 全部取れなければ「このこまは取れませんでした」、一部なら破線で囲んで「一部取れなかった」（雨なしと見せない）。
import { useEffect, useRef, useState } from "react";
import { RAIN_ZOOMS, type RainFrame, type RainZoom } from "../../../shared/rainNow";
import { Glyph } from "../kit";
import { frameLabel, loadTile, relLabel, type Tile, tilePath } from "./rainNowData";

export type Coast = { rings: number[][] };
/** 地図の広さ（その段階の画素で）：横3枚・縦2.4枚分。 */
const VIEW_W = 768;
const VIEW_H = 600;

const world = (lat: number, lon: number, z: number) => {
  const n = 256 * 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};

export function RainNowMap({
  now,
  frame,
  zoom,
  onZoom,
  note,
  place,
  here,
  coast,
}: {
  now: string;
  frame: RainFrame;
  zoom: RainZoom;
  onZoom: (z: RainZoom) => void;
  note: string | null;
  place: { name: string; lat: number; lon: number };
  here: { lat: number; lon: number } | null;
  coast: Coast | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [got, setGot] = useState<{ key: string; tiles: { x: number; y: number; t: Tile }[] } | null>(null);
  const c = world(place.lat, place.lon, zoom);
  const x0 = c.x - VIEW_W / 2;
  const y0 = c.y - VIEW_H / 2;
  const key = `${tilePath(frame, zoom, 0, 0)}`;
  // そのこまのタイルを読む（読み終わるまでは前のこまを出したまま）
  useEffect(() => {
    let live = true;
    const want: { x: number; y: number }[] = [];
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + VIEW_H - 1) / 256); ty++)
      for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + VIEW_W - 1) / 256); tx++) want.push({ x: tx, y: ty });
    Promise.all(want.map(async (w) => ({ ...w, t: await loadTile(tilePath(frame, zoom, w.x, w.y)) }))).then((tiles) => live && setGot({ key, tiles }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names the frame and the zoom
  }, [key]);
  const ready = got?.key === key;
  const missing = ready ? got.tiles.filter((t) => t.t.s === "missing").length : 0;
  const allMissing = ready && missing === got.tiles.length;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const w = cv.clientWidth;
    const k = w / VIEW_W;
    const h = Math.round(VIEW_H * k);
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.height = `${h}px`;
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const tok = (n: string) => css.getPropertyValue(n).trim();
    const X = (lon: number, lat: number) => {
      const p = world(lat, lon, zoom);
      return [(p.x - x0) * k, (p.y - y0) * k] as const;
    };
    ctx.fillStyle = tok("--surface-inset");
    ctx.fillRect(0, 0, w, h);
    const trace = () => {
      if (!coast) return;
      ctx.beginPath();
      for (const r of coast.rings) {
        for (let i = 0; i < r.length; i += 2) {
          const [px, py] = X(r[i] / 100, r[i + 1] / 100);
          if (i) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.closePath();
      }
    };
    // 陸は面に文字の色を1割重ねる（canvas は color-mix を読めない所があるため）
    trace();
    ctx.fillStyle = tok("--ink-primary");
    ctx.globalAlpha = 0.1;
    ctx.fill("evenodd");
    ctx.globalAlpha = 1;
    // 雨（気象庁の画像をそのまま。拡大しても色の境目をぼかさない）
    if (got) {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.85;
      for (const t of got.tiles) if (t.t.s === "ok") ctx.drawImage(t.t.img, (t.x * 256 - x0) * k, (t.y * 256 - y0) * k, 256 * k, 256 * k);
      ctx.globalAlpha = 1;
      // 一部取れなかったタイル：破線で囲む
      if (ready && missing && !allMissing) {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = tok("--line-strong");
        for (const t of got.tiles) if (t.t.s === "missing") ctx.strokeRect((t.x * 256 - x0) * k + 1, (t.y * 256 - y0) * k + 1, 256 * k - 2, 256 * k - 2);
        ctx.setLineDash([]);
      }
    }
    trace();
    ctx.strokeStyle = tok("--line-strong");
    ctx.lineWidth = 1;
    ctx.stroke();
    // 地点：印と、背景つきの名前（左上に。現在地の「＋」と重なりにくいように）
    const [kx, ky] = X(place.lon, place.lat);
    ctx.beginPath();
    ctx.arc(kx, ky, 5, 0, Math.PI * 2);
    ctx.fillStyle = tok("--ink-primary");
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = tok("--surface-base");
    ctx.stroke();
    ctx.font = `600 13px ${tok("--font-family")}`;
    const tw = ctx.measureText(place.name).width;
    ctx.fillStyle = tok("--surface-base");
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(kx - tw - 19, ky - 24, tw + 10, 20, 6);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = tok("--ink-primary");
    ctx.fillText(place.name, kx - tw - 14, ky - 9);
    // 現在地：「＋」の印だけ（値は出さない）
    if (here) {
      const [hx, hy] = X(here.lon, here.lat);
      if (hx >= 0 && hx <= w && hy >= 0 && hy <= h) {
        ctx.lineCap = "round";
        for (const [col, wd] of [
          [tok("--surface-base"), 5],
          [tok("--ink-primary"), 2],
        ] as const) {
          ctx.strokeStyle = col;
          ctx.lineWidth = wd;
          ctx.beginPath();
          ctx.moveTo(hx - 7, hy);
          ctx.lineTo(hx + 7, hy);
          ctx.moveTo(hx, hy - 7);
          ctx.lineTo(hx, hy + 7);
          ctx.stroke();
        }
      }
    }
    // 縮尺（地点の緯度で）
    const km = zoom === 8 ? 50 : zoom === 9 ? 20 : 10;
    const mPerPx = (40_075_016 * Math.cos((place.lat * Math.PI) / 180)) / (256 * 2 ** zoom);
    const bar = ((km * 1000) / mPerPx) * k;
    ctx.fillStyle = tok("--ink-secondary");
    ctx.fillRect(w - 12 - bar, h - 14, bar, 2);
    ctx.font = `11px ${tok("--font-family")}`;
    ctx.fillText(`${km}km`, w - 12 - bar, h - 18);
  }, [got, coast, zoom, here, place, x0, y0, ready, missing, allMissing]);
  const forecast = frame.m > 0;
  const i = RAIN_ZOOMS.indexOf(zoom);
  const what = frame.kind === "hourly" ? "予測（1時間の量）" : forecast ? "予測" : "実況";
  return (
    <figure className={`rn-map${forecast ? " forecast" : ""}${allMissing ? " missing" : ""}`}>
      <canvas
        ref={ref}
        className="rn-canvas"
        role="img"
        aria-label={`${frameLabel(now, frame)}の${frame.kind === "hourly" ? "1時間の降水量" : "雨の強さ"}（${forecast ? "予測" : "実況"}）${allMissing ? "：取れなかった" : missing ? "：一部取れなかった" : ""}`}
      />
      {allMissing && (
        <span className="rn-miss">
          <b>このこまは取れませんでした</b>
          <span>雨がないという意味ではありません</span>
        </span>
      )}
      <span className={`rn-when${forecast ? " forecast" : ""}`}>
        <b>{frameLabel(now, frame)}</b>
        <span>
          {relLabel(frame)}・{allMissing ? "取れなかった" : missing ? `${what}・一部取れなかった` : what}
        </span>
      </span>
      {!ready && <span className="rn-loading">読み込み中…</span>}
      {note && <span className="rn-playnote">{note}</span>}
      <span className="rn-zoom">
        <button type="button" aria-label="寄せる" disabled={i === RAIN_ZOOMS.length - 1} onClick={() => onZoom(RAIN_ZOOMS[i + 1])}>
          <Glyph name="plus" size="14px" />
        </button>
        <button type="button" aria-label="引く" disabled={i === 0} onClick={() => onZoom(RAIN_ZOOMS[i - 1])}>
          <Glyph name="minus" size="14px" />
        </button>
      </span>
    </figure>
  );
}

/** 再生の先のこまのタイルを先に読んでおく（止まらずに進むように）。 */
export function prefetchFrame(place: { lat: number; lon: number }, frame: RainFrame, zoom: RainZoom) {
  const c = world(place.lat, place.lon, zoom);
  const x0 = c.x - VIEW_W / 2;
  const y0 = c.y - VIEW_H / 2;
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + VIEW_H - 1) / 256); ty++)
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + VIEW_W - 1) / 256); tx++) void loadTile(tilePath(frame, zoom, tx, ty));
}
