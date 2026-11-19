// 月と方位の小さな部品（太陽と月のシート・月のシートで使う）。
import { useEffect, useId, useRef, useState } from "react";
import moonUrl from "../assets/moon.webp";

/** 方位の名前（16方位、北0・東90）。 */
const DIRS = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
export const dirName = (az: number) => DIRS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];

/**
 * 月の満ち欠けの絵：照らされている割合（輝面比）と、満ちていくか欠けていくか（月齢 14.8 日の前か後か）から。
 * 北半球で見た形（満ちていくときは右が明るい）。
 */
/** seen：空で見える形（暗い側は描かない。空を見上げるの月、11/19）。 */
export function MoonGlyph({ phase, size, limb, tint, north, seen }: { phase: { age: number; illuminated: number }; size: number; limb?: number; tint?: string; north?: number; seen?: boolean }) {
  const r = seen ? size / 2 : size / 2 - 1;
  const c = size / 2;
  const k = Math.min(1, Math.max(0, phase.illuminated));
  // limb（光っている側の向き、上から反時計回り）があれば、満ちていく形（右が光る＝270°）で描いて回す。
  const waxing = limb !== undefined || phase.age < 14.77;
  const turn = limb !== undefined ? 270 - limb : 0;
  const rx = Math.abs(1 - 2 * k) * r;
  // 明るい側の半円＋明暗の境（楕円の半分）。半分より多く照らされていれば楕円は暗い側へふくらむ。
  const side = waxing ? 1 : 0;
  const bulge = waxing ? (k > 0.5 ? 1 : 0) : k > 0.5 ? 0 : 1;
  const d = `M${c},${c - r} A${r},${r} 0 0 ${side} ${c},${c + r} A${rx},${r} 0 0 ${bulge} ${c},${c - r} Z`;
  const id = useId();
  const spin = north ? `rotate(${(-north).toFixed(1)} ${c} ${c})` : undefined;
  // 月の絵（渡辺さんの絵、2026-11-19）：照らされた側は絵そのまま、影の側は同じ絵を暗く（地球照のように模様がうっすら）。
  // tint（高さの色）があれば、絵の色みを抜いてその色を掛ける。
  return (
    <svg className="moon-glyph" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <defs>
        <clipPath id={`${id}lit`}>
          <path d={d} transform={turn ? `rotate(${turn.toFixed(1)} ${c} ${c})` : undefined} />
        </clipPath>
        {tint && (
          <filter id={`${id}tint`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0.15" result="grey" />
            <feFlood floodColor={tint} result="col" />
            <feBlend in="grey" in2="col" mode="multiply" result="mix" />
            <feComposite in="mix" in2="SourceAlpha" operator="in" />
          </filter>
        )}
      </defs>
      {!seen && <circle cx={c} cy={c} r={r} className="moon-dark" />}
      <g filter={tint ? `url(#${id}tint)` : undefined}>
        {/* north（模様の向き、shared/moon.ts moonNorth）があれば、北が上の絵をその角だけ反時計回りに回す。光る側の切り抜きは回さない。 */}
        {!seen && <image href={moonUrl} x={c - r} y={c - r} width={2 * r} height={2 * r} className="moon-shade" transform={spin} />}
        <g clipPath={`url(#${id}lit)`}>
          <image href={moonUrl} x={c - r} y={c - r} width={2 * r} height={2 * r} transform={spin} />
        </g>
      </g>
    </svg>
  );
}

// ── 描き方の試し（2026-11-19 渡辺さん「ABCテストを」）：B 球の陰影／C 球の陰影＋暗い側 ─────────────
// 渡辺さんの絵のまま（写真のような質感は足さない）。絵を球と見なし、太陽の向きから明暗の境をやわらかくし、欠け際をわずかに沈める。
// 反射は Lommel–Seeliger（満月でも縁が暗くなりすぎない）。暗い側は C だけ、A と同じ「面の色の円＋絵 16%」。

let texture: Promise<ImageData> | null = null;
function moonTexture(): Promise<ImageData> {
  texture ??= new Promise((ok, ng) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const x = c.getContext("2d")!;
      x.drawImage(im, 0, 0, 256, 256);
      ok(x.getImageData(0, 0, 256, 256));
    };
    im.onerror = ng;
    im.src = moonUrl;
  });
  return texture;
}

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function MoonSphere({ phase, size, limb, north, tint, dark }: { phase: { illuminated: number }; size: number; limb: number; north: number; tint?: string; dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tex, setTex] = useState<ImageData | null>(null);
  useEffect(() => {
    let live = true;
    void moonTexture().then((t) => live && setTex(t));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !tex) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const N = Math.round(size * dpr);
    cv.width = cv.height = N;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, N, N);
    const r = N / 2 - dpr;
    const k = Math.min(1, Math.max(0, phase.illuminated));
    const th = Math.acos(2 * k - 1); // 位相角（0＝満月）
    const L = [Math.sin(th), Math.cos(th)]; // 光は +x（右）と手前から
    const tu = ((limb - 270) * Math.PI) / 180;
    const [tc, ts] = [Math.cos(tu), Math.sin(tu)];
    const nu = (north * Math.PI) / 180;
    const [nc, ns] = [Math.cos(nu), Math.sin(nu)];
    const tn = tint ? rgbOf(tint) : null;
    const out = g.createImageData(N, N);
    const d = out.data;
    const src = tex.data;
    for (let py = 0; py < N; py++)
      for (let px = 0; px < N; px++) {
        const sx = (px + 0.5 - N / 2) / r;
        const sy = (py + 0.5 - N / 2) / r;
        const rr = sx * sx + sy * sy;
        if (rr > 1) continue;
        const z = Math.sqrt(1 - rr);
        const lx = tc * sx - ts * sy; // 光の向きの座標（画面の反時計回りを戻す）
        const ux = nc * sx - ns * sy; // 絵の座標（模様の向きを戻す）
        const uy = ns * sx + nc * sy;
        const ti = (Math.min(255, Math.max(0, Math.round(((uy + 1) / 2) * 255))) * 256 + Math.min(255, Math.max(0, Math.round(((ux + 1) / 2) * 255)))) * 4;
        let [cr, cg, cb] = [src[ti], src[ti + 1], src[ti + 2]];
        if (tn) {
          const y = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
          [cr, cg, cb] = [cr, cg, cb].map((v, j) => ((y + 0.15 * (v - y)) * tn[j]) / 255);
        }
        const mu0 = L[0] * lx + L[1] * z;
        const lit = mu0 > 0 ? (2 * mu0) / (mu0 + z + 1e-6) / 1.0 : 0; // 0〜2（手前から照らすと 1）
        const a = Math.min(1, lit / 0.18);
        const sh = 0.72 + 0.28 * Math.min(1, lit);
        const da = dark ? 0.16 : 0;
        const A1 = a + da * (1 - a);
        const w = A1 ? a / A1 : 0;
        const f = sh * w + (1 - w);
        const edge = Math.min(1, (1 - Math.sqrt(rr)) * r);
        const i = (py * N + px) * 4;
        d[i] = cr * f;
        d[i + 1] = cg * f;
        d[i + 2] = cb * f;
        d[i + 3] = 255 * A1 * edge;
      }
    const t = document.createElement("canvas");
    t.width = t.height = N;
    t.getContext("2d")!.putImageData(out, 0, 0);
    if (dark) {
      // A と同じ：面の色の円（.moon-dark の色）の上に重ねる
      const cs = getComputedStyle(cv);
      g.fillStyle = cs.getPropertyValue("--surface-inset").trim();
      g.beginPath();
      g.arc(N / 2, N / 2, r, 0, Math.PI * 2);
      g.fill();
    }
    g.drawImage(t, 0, 0);
  }, [tex, size, phase.illuminated, limb, north, tint, dark]);
  return <canvas ref={ref} className="moon-glyph" style={{ width: size, height: size }} aria-hidden />;
}
