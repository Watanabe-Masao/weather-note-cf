// ビーバームーンの絵本の世界（2026-11-20 渡辺さん「一コマ一コマ、一つ一つのパーツ、背景、描画を通じた一体感で
// 物語の世界観を表現し、満月の魅力を体験させる」）。一枚の続いた世界を、物語の一文ごとに場面（コマ）として動かす。
//   1 秋の森から葉が落ちる夕暮れ → 2 川をビーバーが泳いで来る → 3 枝を運び、住みかを組み、枝を水に蓄える →
//   4 日が落ち、星が一つずつ → 5 住みかが仕上がる → 6 丘の向こうから満月が昇る（ビーバームーン）→
//   7 川に月の道、霧 → 8 初雪、月の下で冬支度を続ける → 9 世界が一枚の絵に収まる。
// 色はここ（デザインの層）にだけ書く。動きは buildBeaverScene（GSAP、スクロールに合わせる）。
// 絵は文化的なイメージで、実際の月の色や見え方とは別（物語のページで断る）。
import type { ReactElement } from "react";
import { storyAsset } from "./storyAssets";
import { cssSky, MoonDefs, pine, rand, SkyGradient as Sky, STORY_H as H, STORY_MOON as MOON, STORY_W as W, StoryMoon, stars as starField } from "./parts";

/** 物語の一文の数（場面の数）。 */
export const BEAVER_BEATS = 9;

/** 渡辺さんの素材（src/design/story/storyAssets.ts の beaver）。 */
const A = (name: string) => storyAsset("beaver", name);

const SKY = {
  dusk: ["#3a3f7e", "#b2617a", "#f0a565", "#f7cf8a"],
  twilight: ["#1d2a5e", "#4e3f78", "#a26a7c", "#d69a7a"],
  night: ["#060d26", "#0c1a42", "#16295a", "#223a6e"],
};
const GOLD = "#f1d38a";
const FUR = ["#5a3d27", "#3b281a"];
const WATER = ["#2b4a7d", "#16294f", "#0b1838"];
const LEAF = ["#e8a63d", "#d9772f", "#f2c35a", "#c85a2a"];

/** 泳ぐビーバー（頭と背中だけ水の上、枝をくわえる）。原点は水面の頭の下。 */
function BeaverSwimming() {
  return (
    <g>
      <path d="M-44 2 C -36 -8 -14 -12 0 -10 C 8 -16 18 -20 26 -16 C 32 -12 34 -6 30 -2 Z" fill={FUR[0]} />
      <path d="M-30 -6 C -18 -11 -6 -12 2 -11" stroke={GOLD} strokeWidth={1.2} fill="none" opacity={0.5} />
      <circle cx={20} cy={-13} r={1.4} fill={GOLD} />
      <circle cx={8} cy={-17} r={2.6} fill={FUR[1]} />
      <path d="M14 -6 L 66 -16" stroke="#7a5532" strokeWidth={3} strokeLinecap="round" />
      <ellipse cx={64} cy={-22} rx={4} ry={2.2} fill={LEAF[1]} transform="rotate(-20 64 -22)" />
    </g>
  );
}

/** 住みか（枝を組んだ丸屋根）。枝は一本ずつ描かれる（.bw-stick）。 */
function Lodge() {
  const r = rand(11);
  const sticks = Array.from({ length: 46 }, (_, i) => {
    const t = i / 46;
    const a = Math.PI * (0.05 + 0.9 * r());
    const rr = 0.35 + 0.65 * Math.sqrt(r());
    const cx = Math.cos(a) * 62 * rr;
    const cy = -Math.sin(a) * 40 * rr;
    const ang = (r() - 0.5) * 2.4 + (t > 0.5 ? 0.6 : -0.6);
    const len = 22 + r() * 26;
    const dx = Math.cos(ang) * len * 0.5;
    const dy = Math.sin(ang) * len * 0.5;
    return <path key={i} className="bw-stick" d={`M${(cx - dx).toFixed(1)} ${(cy - dy).toFixed(1)} L${(cx + dx).toFixed(1)} ${(cy + dy).toFixed(1)}`} pathLength={1} stroke={i % 3 ? "#6b4a2d" : "#8a6238"} strokeWidth={2.6 + r() * 1.6} strokeLinecap="round" />;
  });
  return (
    <g>
      <path className="bw-mud" d="M-66 0 C -60 -30 -32 -46 0 -46 C 32 -46 60 -30 66 0 Z" fill="#2e2117" />
      {sticks}
    </g>
  );
}

/** 水の中に蓄えた枝（住みかのそば、水面の下）。 */
function Stash() {
  const r = rand(5);
  return (
    <g className="bw-stash" opacity={0}>
      {Array.from({ length: 14 }, (_, i) => {
        const x = -40 + r() * 80;
        const y = 10 + r() * 26;
        const a = (r() - 0.5) * 1.2;
        return <path key={i} d={`M${x - 14 * Math.cos(a)} ${y - 14 * Math.sin(a)} L${x + 14 * Math.cos(a)} ${y + 14 * Math.sin(a)}`} stroke="#9a7a52" strokeWidth={2.2} strokeLinecap="round" opacity={0.55} />;
      })}
    </g>
  );
}

/** 場面の最初の空（本のページの窓から場面へつなぐ色。CSS の背景）。 */
export const BEAVER_SKY = cssSky(SKY.dusk);

/**
 * 表紙の真ん中の絵（11/20 18:42 渡辺さんの素材の表紙を、素材を重ねて組み直したもの）：満月、紅葉の木、水面の月の道、
 * 巣の上のビーバー。文字は表紙の側（HTML）で重ねる（素材の README「絵の中の文字は作り直す」）。並べ方は CSS（.bca-*）。
 */
export function BeaverCoverArt(): ReactElement {
  return (
    <span className="bca" aria-hidden>
      <img className="bca-moon" src={A("moon")} alt="" />
      <img className="bca-ref" src={A("reflection")} alt="" />
      <img className="bca-tree l" src={A("tree")} alt="" />
      <img className="bca-tree r" src={A("tree")} alt="" />
      <img className="bca-beaver" src={A("beaver-nest")} alt="" />
      <img className="bca-reed" src={A("reed")} alt="" />
    </span>
  );
}

/** 本のページの窓の絵（場面の最初のコマの小さな絵：夕暮れの空、丘、針葉樹、川）。窓の中へ寄ると、場面へつながる。 */
export function BeaverWindow(): ReactElement {
  const r = rand(7);
  return (
    <svg className="bk-window-art" viewBox="0 0 200 240" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <Sky id="bkw-sky" c={SKY.dusk} />
      </defs>
      <rect width={200} height={240} fill="url(#bkw-sky)" />
      <path d="M-10 170 L 30 130 L 60 150 L 100 110 L 140 145 L 175 120 L 210 150 L 210 200 L -10 200 Z" fill="#2a3a6e" />
      {Array.from({ length: 14 }, (_, i) => pine(i * 15 + r() * 6 - 4, 192 + r() * 4, 22 + r() * 16, "#141d3c", `w${i}`))}
      <rect x={-10} y={196} width={220} height={50} fill={WATER[1]} />
      <path d="M10 210 q 14 -3 28 0 M120 222 q 18 -3 36 0" stroke="#9fb7e6" strokeWidth={0.8} opacity={0.5} fill="none" />
      {Array.from({ length: 9 }, (_, i) => (
        <ellipse key={i} cx={20 + r() * 160} cy={40 + r() * 120} rx={2.4} ry={1.5} fill={LEAF[i % LEAF.length]} transform={`rotate(${(r() * 180).toFixed(0)})`} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
      ))}
    </svg>
  );
}

/** 絵本の世界の SVG（スクロールの場面は buildBeaverScene が動かす）。 */
export function BeaverWorld(): ReactElement {
  const r = rand(42);
  const stars = starField("bw", 80, 42);
  const LEAVES = ["leaf-large", "leaf-small", "leaf-tiny"];
  const leaves = Array.from({ length: 16 }, (_, i) => {
    const sz = [22, 16, 11][i % 3];
    return <image key={i} className="bw-leaf" href={A(LEAVES[i % 3])} x={-sz / 2} y={-sz / 2} width={sz} height={sz} transform={`translate(${(r() * W).toFixed(0)} -20)`} />;
  });
  const flakes = Array.from({ length: 70 }, (_, i) => <circle key={i} className="bw-flake" r={1.6 + r() * 2.2} cx={(r() * W).toFixed(0)} cy={-10} fill="#ffffff" opacity={0.9} />);
  const farPines = Array.from({ length: 24 }, (_, i) => pine(i * 18 + r() * 8 - 6, 552 + r() * 8, 28 + r() * 18, "#1c2a52", `fp${i}`));
  const midPines = Array.from({ length: 11 }, (_, i) => pine(i * 40 + r() * 16, 604 + r() * 8, 54 + r() * 30, "#141d3c", `mp${i}`));
  return (
    <svg className="bw" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <Sky id="bw-sky-dusk" c={SKY.dusk} />
        <Sky id="bw-sky-twi" c={SKY.twilight} />
        <Sky id="bw-sky-night" c={SKY.night} />
        <MoonDefs p="bw" />
        <linearGradient id="bw-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={WATER[0]} />
          <stop offset="0.5" stopColor={WATER[1]} />
          <stop offset="1" stopColor={WATER[2]} />
        </linearGradient>
        <linearGradient id="bw-road" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={MOON.glow} stopOpacity={0.85} />
          <stop offset="1" stopColor={MOON.glow} stopOpacity={0} />
        </linearGradient>
        <linearGradient id="bw-fog" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c9d6f2" stopOpacity={0} />
          <stop offset="0.5" stopColor="#c9d6f2" stopOpacity={0.35} />
          <stop offset="1" stopColor="#c9d6f2" stopOpacity={0} />
        </linearGradient>
        <radialGradient id="bw-vignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.6" stopColor="#000000" stopOpacity={0} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.55} />
        </radialGradient>
        <filter id="bw-soft" x="-50%" y="-20%" width="200%" height="140%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <clipPath id="bw-above">
          <rect x={-200} y={-900} width={800} height={900} />
        </clipPath>
      </defs>
      <g className="bw-camera">
        {/* 空：夕暮れ → 薄明 → 夜 */}
        <rect x={-300} y={-400} width={W + 600} height={H + 800} fill="url(#bw-sky-dusk)" />
        <rect className="bw-sky-twi" x={-300} y={-400} width={W + 600} height={H + 800} fill="url(#bw-sky-twi)" opacity={0} />
        <rect className="bw-sky-night" x={-300} y={-400} width={W + 600} height={H + 800} fill="url(#bw-sky-night)" opacity={0} />
        <g className="bw-stars">{stars}</g>
        {/* 満月（丘の向こうから昇る） */}
        <StoryMoon p="bw" at="translate(150 640)" img={A("moon")} />
        {/* 月の出の前の明るみ（丘の向こう） */}
        <ellipse className="bw-moonrise" cx={150} cy={540} rx={170} ry={90} fill="url(#bw-moon-glow)" opacity={0} />
        {/* 遠い山 */}
        <path d="M-40 560 L 20 500 L 70 530 L 130 470 L 190 520 L 250 480 L 310 525 L 370 490 L 440 540 L 440 600 L -40 600 Z" fill="#2a3a6e" />
        <path d="M-40 575 C 40 545 120 560 200 548 C 280 536 360 552 440 545 L 440 610 L -40 610 Z" fill="#22305e" />
        <g>{farPines}</g>
        <g className="bw-autumn">
          {/* 紅葉の木（渡辺さんの素材 11/20 18:42） */}
          <image href={A("tree")} x={-40} y={512} width={136} height={100} />
          <image href={A("tree")} x={288} y={496} width={150} height={110} />
          <image href={A("tree")} x={178} y={540} width={82} height={60} opacity={0.85} />
        </g>
        <g>{midPines}</g>
        {/* 川 */}
        <path d="M-40 618 C 60 610 140 626 220 620 C 300 614 360 622 440 616 L 440 740 L -40 740 Z" fill="url(#bw-water)" />
        <path className="bw-water-night" d="M-40 618 C 60 610 140 626 220 620 C 300 614 360 622 440 616 L 440 740 L -40 740 Z" fill="#081230" opacity={0} />
        <g className="bw-road" opacity={0}>
          {/* 月の道（素材の水面の映り込み） */}
          <image href={A("reflection")} x={104} y={618} width={92} height={118} preserveAspectRatio="none" />
        </g>
        <g className="bw-ripples" stroke="#9fb7e6" strokeWidth={1} opacity={0.5} fill="none">
          <path d="M20 650 q 20 -4 40 0 M110 690 q 26 -5 52 0 M250 700 q 22 -4 44 0 M320 660 q 18 -3 36 0" />
        </g>
        {/* 霧（住みかとビーバーの奥） */}
        <rect className="bw-fog" x={-200} y={586} width={800} height={48} fill="url(#bw-fog)" opacity={0} />
        {/* 住みかと、水に蓄えた枝 */}
        <g transform="translate(292 652)">
          <g transform="translate(-8 4)">
            <Stash />
          </g>
          <g className="bw-lodge">
            <Lodge />
          </g>
        </g>
        {/* ビーバー：泳ぐ姿と、住みかの上の姿 */}
        <g className="bw-swim" transform="translate(-80 662)">
          <BeaverSwimming />
          <path d="M-44 2 L -90 12 M-44 2 L -86 -6" stroke="#bcd0f2" strokeWidth={1} opacity={0.6} />
        </g>
        {/* 月を見上げるビーバー（素材）：月が昇るコマで、枝を持つ姿から替わる。 */}
        <g className="bw-look" opacity={0}>
          <image href={A("beaver")} x={214} y={520} width={88} height={99} />
        </g>
        <g className="bw-sit" opacity={0}>
          {/* 枝を持つビーバー（素材）。枝を置く動きは、この絵を少し傾けて（.bw-branch）。 */}
          <image className="bw-branch" href={A("beaver-branch")} x={206} y={540} width={130} height={95} />
        </g>
        {/* 手前の岸と葦 */}
        <path d="M-300 740 C 60 726 160 736 230 732 C 300 728 360 736 700 728 L 700 1300 L -300 1300 Z" fill="#0b1328" />
        <g fill="#0e1830">
          {Array.from({ length: 22 }, (_, i) => {
            const x = i * 19 + r() * 8;
            const h = 30 + r() * 46;
            return <path key={i} d={`M${x} 742 C ${x + 2} ${742 - h * 0.5} ${x + 6} ${742 - h * 0.8} ${x + 10} ${742 - h} C ${x + 6} ${742 - h * 0.6} ${x + 5} ${742 - h * 0.3} ${x + 6} 742 Z`} />;
          })}
        </g>
        {/* 上の枝（見本の金の葉の枝） */}
        <g className="bw-bough">
          <image href={A("reed")} x={-14} y={652} width={92} height={109} opacity={0.9} />
        <image href={A("reed")} x={322} y={664} width={84} height={100} opacity={0.85} />
        {/* 上の紅葉の枝（素材） */}
          <image href={A("branch")} x={-40} y={40} width={240} height={148} transform="rotate(18 80 114)" />
        </g>
      </g>
      {/* 落ち葉と雪（場面に合わせて見せる） */}
      <g className="bw-leaves">{leaves}</g>
      <g className="bw-snow" opacity={0}>
        {flakes}
      </g>
      <rect width={W} height={H} fill="url(#bw-vignette)" pointerEvents="none" />
    </svg>
  );
}

// ---- 動き（GSAP、型は最小限） -----------------------------------------------------------------------

type Tween = { to: (...a: unknown[]) => Tween; fromTo: (...a: unknown[]) => Tween; set: (...a: unknown[]) => Tween };
type Loop = Tween & { play: () => unknown; pause: () => unknown; time: (t: number) => unknown };
type Gsap = {
  timeline: (o?: unknown) => Tween;
  utils: { toArray: <T>(s: string, el: Element) => T[] };
};

/**
 * 場面の動き。tl は物語の長さ（BEAVER_BEATS 拍）で、スクロールに合わせて進める（文はページの側で重ねる）。
 * 落ち葉・雪・泳ぎの揺れ・波はくり返す動き（スクロールと別）で、一つのタイムラインにまとめて返す（場面が画面に
 * 無い間は止める。GSAP 公式スキル gsap-performance「見えない動きは止める」「別々の遅れより stagger」）。
 */
export function buildBeaverScene(gsap: Gsap, root: Element, tl: Tween, loops = true): Loop | null {
  const q = (s: string) => root.querySelectorAll(s);
  buildBeats(tl, q);
  return loops ? startLoops(gsap, root) : null;
}

function startLoops(gsap: Gsap, root: Element): Loop {
  const loop = gsap.timeline({ paused: true }) as Loop;
  const leaves = gsap.utils.toArray<Element>(".bw-leaf", root);
  const flakes = gsap.utils.toArray<Element>(".bw-flake", root);
  // 落ち葉：左右に揺れながら回って落ちる（一枚ずつ少しずらして、くり返す）。
  loop.to(leaves, { y: 900, x: (i: number) => `+=${(i % 2 ? 1 : -1) * (40 + (i % 5) * 12)}`, rotation: (i: number) => (i % 2 ? 1 : -1) * 540, duration: (i: number) => 7 + (i % 6), ease: "none", stagger: { each: 0.9, repeat: -1 } }, 0);
  // 雪：まっすぐ静かに。
  loop.to(flakes, { y: 900, x: (i: number) => `+=${((i % 3) - 1) * 10}`, duration: (i: number) => 9 + (i % 7), ease: "none", stagger: { each: 0.45, repeat: -1 } }, 0);
  loop.to(".bw-swim > g", { y: -2, duration: 1.1, yoyo: true, repeat: -1, ease: "sine.inOut" }, 0);
  loop.to(".bw-ripples", { x: 12, duration: 3, yoyo: true, repeat: -1, ease: "sine.inOut" }, 0);
  loop.to(".bw-moon-glow", { opacity: 0.75, duration: 2.6, yoyo: true, repeat: -1, ease: "sine.inOut" }, 0);
  // 開いたときに、もう降っている途中から。
  loop.time(40);
  return loop;
}

function buildBeats(tl: Tween, q: (s: string) => NodeListOf<Element>) {
  // 1 秋の森：森に寄ったカメラ、葉が落ちる。
  tl.fromTo(".bw-camera", { scale: 1.45, x: -60, y: -93, transformOrigin: "50% 50%" }, { scale: 1.2, x: -10, y: -46, duration: 1, ease: "none" }, 0);
  // 2 川へ：カメラが川へ降り、ビーバーが泳いで来る。
  tl.to(".bw-camera", { scale: 1.3, x: 20, y: -64, duration: 1, ease: "none" }, 1).fromTo(".bw-swim", { x: -80 }, { x: 196, duration: 1.4, ease: "none" }, 1);
  // 3 住みかを組む：泥の土台、枝が一本ずつ、水に蓄える枝。泳ぐ姿から住みかの上へ。
  tl.fromTo(".bw-mud", { opacity: 0 }, { opacity: 1, duration: 0.3 }, 2)
    .fromTo(q(".bw-stick"), { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.05, stagger: 0.016 }, 2.05)
    .to(".bw-swim", { opacity: 0, duration: 0.2 }, 2.4)
    .to(".bw-sit", { opacity: 1, duration: 0.25 }, 2.5)
    .to(".bw-stash", { opacity: 1, duration: 0.4 }, 2.6)
    // 枝を住みかに置く（16:45 のレビュー「ビーバーの存在感」）：前足と枝が下りて、また上がる。
    .fromTo(".bw-branch", { rotation: -5, svgOrigin: "262 632" }, { rotation: 4, duration: 0.18, ease: "power1.inOut", yoyo: true, repeat: 3 }, 2.55)
    .to(".bw-camera", { scale: 1.5, x: -150, y: -102, duration: 1, ease: "none" }, 2);
  // 4〜5 日が落ちる（16:27 のレビュー「昼から夜への移り変わりが急」）：空・水面・紅葉・星を時間差で、二つの文にまたがって。
  tl.to(".bw-sky-twi", { opacity: 1, duration: 0.9, ease: "sine.inOut" }, 2.9)
    .to(".bw-sky-night", { opacity: 1, duration: 1.2, ease: "sine.inOut" }, 3.5)
    .to(".bw-water-night", { opacity: 1, duration: 1.2, ease: "sine.inOut" }, 3.6)
    .fromTo(q(".bw-star"), { opacity: 0 }, { opacity: 0.9, duration: 0.1, stagger: { amount: 1.3, from: "random" } }, 3.4)
    .to(".bw-autumn", { opacity: 0.55, duration: 1.2 }, 3.4)
    .to(".bw-leaves", { opacity: 0.3, duration: 1 }, 3.6)
    .to(".bw-camera", { scale: 1.15, x: 0, y: -36, duration: 1, ease: "none" }, 3)
    // 月が昇る前に、丘の向こうが明るくなる。
    .to(".bw-moonrise", { opacity: 1, duration: 0.8, ease: "sine.in" }, 4.3);
  // 5 仕上がる：住みかに寄る（枝の影が深く）。
  tl.to(".bw-camera", { scale: 1.7, x: -75, y: -131, duration: 1, ease: "none" }, 4);
  // 6 満月が昇る：カメラが引き、丘の向こうから大きな月。
  tl.to(".bw-camera", { scale: 1, x: 0, y: -8, duration: 1, ease: "none" }, 5)
    .to(".bw-moon", { attr: { transform: "translate(150 380)" }, duration: 1.1, ease: "power1.out" }, 5)
    .to(".bw-leaves", { opacity: 0, duration: 0.4 }, 5)
    // ビーバーが月を見上げる（枝を持つ姿から、素材の見上げる姿へ）。
    .to(".bw-sit", { opacity: 0, duration: 0.3 }, 5.45)
    .to(".bw-look", { opacity: 1, duration: 0.3 }, 5.45)
    // 月が昇るにつれ、まわりは少し沈み（星と紅葉）、月の道が水面に伸びる（16:45 のレビュー「月光と水面の反射を連動」）。
    .to(".bw-stars", { opacity: 0.5, duration: 1 }, 5.2)
    .to(".bw-autumn", { opacity: 0.4, duration: 1 }, 5.2)
    .fromTo(".bw-road", { opacity: 0, scaleY: 0.2, svgOrigin: "150 622" }, { opacity: 1, scaleY: 1, duration: 1.1, ease: "power1.out" }, 5.35)
    .to(".bw-ripples", { opacity: 0.9, duration: 1 }, 5.5);
  // 7 月の道と霧。
  tl.to(".bw-fog", { opacity: 1, duration: 0.6 }, 6.2);
  // 8 初雪：月の下で冬支度。
  tl.to(".bw-snow", { opacity: 1, duration: 0.5 }, 7).to(".bw-camera", { scale: 1.12, x: -30, y: -31, duration: 1, ease: "none" }, 7);
  // 9 一枚の絵へ：世界が引いて収まる。
  tl.to(".bw-camera", { scale: 0.96, x: 0, y: 10, duration: 1, ease: "none" }, 8).to(".bw-fog", { opacity: 0.5, duration: 0.5 }, 8);
}
