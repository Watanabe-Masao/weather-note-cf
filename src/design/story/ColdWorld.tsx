// コールドムーンの絵本の世界（PR-2：場面。Project「コールドムーン_絵コンテと本文」v0.5・「実装計画」v0.2）。
// 一枚の続いた雪の森を、絵本の1ページごとに場面（コマ）として見せる：
//   1 雪の森（遠景）→ 2 雪の枝の小さなコガラ → 3 幹のすきまに種をかくす → 4 はやい夕暮れ（引く）→ 5 木の穴へ →
//   6 引いて、北東の地平線から月が昇る（穴の口のコガラが月を見る）→ 7 見上げる（月が高く）→ 8 穴の口に寄る（眠る）→
//   9 夜明けの森の一枚の絵（西の空に白い月、枝でさえずるコガラ）。
// この PR は、コマごとの寄り・引きと主役の出入りまで。言葉に合わせた細かい動き（跳ねる・種・ひゅう・月明かりの帯・
// 夜明けの順）は PR-3。色はここ（デザインの層）にだけ書く。素材は design-src/story/cold/pack/（11/22 検収）。
import type { ReactElement } from "react";
import { storyAsset } from "./storyAssets";
import {
  cssSky,
  MoonDefs,
  rand,
  SkyGradient as Sky,
  STORY_H as H,
  STORY_W as W,
  StoryMoon,
  stars as starField,
} from "./parts";

/** 物語の一文の数（場面の数）。 */
export const COLD_BEATS = 9;

/** 渡辺さんの素材（src/design/story/storyAssets.ts の cold）。 */
const A = (name: string) => storyAsset("cold", name);

const SKY = {
  /** 昼の冬の空（1〜3ページ）。 */
  day: ["#9fbbe0", "#c6d8ee", "#e8eef6", "#f4efe8"],
  /** はやい夕暮れ（4・5ページ）：青いかげ。 */
  dusk: ["#2a3a74", "#4f5b98", "#a48aae", "#e2b6a2"],
  /** 夜（6〜8ページ）。 */
  night: ["#050c24", "#0b1840", "#15285a", "#21386c"],
  /** 夜明け（9ページ）。 */
  dawn: ["#3b578f", "#86a0cc", "#e6c4b6", "#f6dcc0"],
};
/** 地面の雪（近景の絵の下を埋める）。 */
const SNOW = "#e9edf6";

// 置く位置（世界の座標 400×860。素材の目印は design-src/story/cold/pack/anchors.json）。
/** 穴のある幹（c05、1024×1536）。穴の口の中心は画像の (510, 671)。 */
const TRUNK = { x: 190, y: 430, w: 230, h: 345 };
const HOLE = {
  x: TRUNK.x + (TRUNK.w * 510) / 1024,
  y: TRUNK.y + (TRUNK.h * 671) / 1536,
  r: ((TRUNK.w * 255) / 1024) * 0.5,
};
/** 枝のコガラ（c01、1536×1024。足が枝に触れる点は (886,975)・(1044,975)）。枝は前景の枝（c09）の上。 */
const PERCH = { w: 98, h: (98 * 1024) / 1536, foot: [965, 975] as const, at: [126, 214] as const };
/** 幹のすきまに種をかくす（c03・c03b、1024×1536）：世界の左の外（3ページだけカメラが向く）。 */
const SEED = { x: -330, y: 300, w: 330, h: 495 };
/** 穴の中のふくらんだコガラ（c06、1536×1024。鳥の幅は画像の約 6 割）。 */
const FLUFF = { w: HOLE.r * 2 * 1.5, h: (HOLE.r * 2 * 1.5 * 1024) / 1536 };
/** 夜明けの枝でさえずるコガラ（c07、1536×1024、枝つき）。 */
const SONG = { x: 92, y: 470, w: 128, h: (128 * 1024) / 1536 };

/** 場面の最初の空（本のページの窓から場面へつなぐ色。CSS の背景）。 */
export const COLD_SKY = cssSky(SKY.day);

/**
 * カメラ（.cw-camera、拡大の中心は世界の (200, 430) ＝画面の真ん中。svgOrigin で決める：組の大きさで中心が動かないように）：
 * 世界の点 (px, py) を画面の真ん中に、倍率 s で。
 */
const cam = (px: number, py: number, s: number) => ({ scale: s, x: -s * (px - 200), y: -s * (py - 430) });

/** 表紙の真ん中の絵：大きな満月、雪の丘とシラカバの林、雪の枝にとまるコガラ。文字は表紙の側（HTML）で重ねる。 */
export function ColdCoverArt(): ReactElement {
  return (
    <svg className="bca" viewBox="0 0 300 260" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <MoonDefs p="cca" />
        <radialGradient id="cca-fade" cx="0.5" cy="0.5" r="0.62">
          <stop offset="0.72" stopColor="#ffffff" />
          <stop offset="1" stopColor="#000000" />
        </radialGradient>
        <mask id="cca-mask">
          <rect width={300} height={260} fill="url(#cca-fade)" />
        </mask>
      </defs>
      <g mask="url(#cca-mask)">
        <circle cx={150} cy={96} r={150} fill="url(#cca-moon-glow)" />
        <image href={storyAsset("cold", "moon")} x={92} y={38} width={116} height={116} />
        <image href={A("far")} x={-120} y={92} width={540} height={180} opacity={0.9} />
        <image href={A("middle")} x={-150} y={110} width={600} height={200} />
        <image href={A("perch-berry")} x={150} y={150} width={150} height={100} />
      </g>
    </svg>
  );
}

/** 紙のページの下の淡い絵（セピア）：名前の由来は雪の丘と森、自然との関係は木の穴で眠るコガラ。 */
export function ColdPaperArt({ kind }: { kind: "origin" | "nature" }): ReactElement {
  return (
    <svg className="bpa" viewBox="0 0 400 160" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <linearGradient id="cpa-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" />
          <stop offset="0.4" stopColor="#ffffff" />
        </linearGradient>
        <mask id="cpa-mask">
          <rect width={400} height={160} fill="url(#cpa-fade)" />
        </mask>
      </defs>
      <g mask="url(#cpa-mask)">
        {kind === "nature" ? (
          <>
            <image className="bpa-ink" href={A("trunk-hole")} x={150} y={-40} width={133} height={200} opacity={0.6} />
            <image className="bpa-ink" href={A("fluff-closed")} x={186} y={42} width={60} height={40} opacity={0.65} />
            <image className="bpa-ink" href={A("near")} x={-80} y={70} width={560} height={187} opacity={0.4} />
          </>
        ) : (
          <>
            <image className="bpa-ink" href={A("far")} x={-60} y={10} width={520} height={173} opacity={0.5} />
            <image className="bpa-ink" href={A("middle")} x={-80} y={30} width={560} height={187} opacity={0.45} />
          </>
        )}
      </g>
    </svg>
  );
}

/** 本のページの窓の絵（場面の最初のコマの小さな絵：冬の昼の空、雪の丘、シラカバの林）。 */
export function ColdWindow(): ReactElement {
  return (
    <svg className="bk-window-art" viewBox="0 0 200 240" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <Sky id="ckw-sky" c={SKY.day} />
      </defs>
      <rect width={200} height={240} fill="url(#ckw-sky)" />
      <image href={A("far")} x={-110} y={88} width={420} height={140} />
      <image href={A("middle")} x={-130} y={110} width={460} height={153} />
      <rect x={-10} y={226} width={220} height={20} fill={SNOW} />
    </svg>
  );
}

/** 絵本の世界の SVG（スクロールの場面は buildColdScene が動かす）。 */
export function ColdWorld(): ReactElement {
  const r = rand(53);
  const stars = starField("cw", 90, 53, 420);
  const flakes = Array.from({ length: 60 }, (_, i) => (
    <circle
      key={i}
      className="cw-flake"
      r={1 + r() * 1.8}
      cx={(r() * W).toFixed(0)}
      cy={-10}
      fill="#ffffff"
      opacity={0.85}
    />
  ));
  const sky = (k: keyof typeof SKY, cls: string, first = false) => (
    <rect
      className={cls}
      x={-700}
      y={-400}
      width={W + 1100}
      height={H + 860}
      fill={`url(#cw-sky-${k})`}
      opacity={first ? 1 : 0}
    />
  );
  return (
    <svg className="cw" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <Sky id="cw-sky-day" c={SKY.day} />
        <Sky id="cw-sky-dusk" c={SKY.dusk} />
        <Sky id="cw-sky-night" c={SKY.night} />
        <Sky id="cw-sky-dawn" c={SKY.dawn} />
        <MoonDefs p="cw" />
        {/* 幹の上は空へ溶かす（素材の幹は上下が切れている）。 */}
        <linearGradient id="cw-trunk-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" />
          <stop offset="0.3" stopColor="#ffffff" />
        </linearGradient>
        <mask id="cw-trunk-mask" maskUnits="userSpaceOnUse" x={TRUNK.x} y={TRUNK.y} width={TRUNK.w} height={TRUNK.h}>
          <rect x={TRUNK.x} y={TRUNK.y} width={TRUNK.w} height={TRUNK.h} fill="url(#cw-trunk-fade)" />
        </mask>
        <mask id="cw-seed-mask" maskUnits="userSpaceOnUse" x={SEED.x} y={SEED.y} width={SEED.w} height={SEED.h}>
          <rect x={SEED.x} y={SEED.y} width={SEED.w} height={SEED.h} fill="url(#cw-trunk-fade)" />
        </mask>
        {/* 穴の口（穴の中のコガラは口の形に切る）。 */}
        <clipPath id="cw-hole">
          <ellipse cx={HOLE.x} cy={HOLE.y} rx={HOLE.r * 0.92} ry={HOLE.r * 0.96} />
        </clipPath>
        <radialGradient id="cw-vignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.6" stopColor="#000000" stopOpacity={0} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.45} />
        </radialGradient>
      </defs>
      <g className="cw-camera">
        {sky("day", "cw-sky-day", true)}
        {sky("dusk", "cw-sky-dusk")}
        {sky("night", "cw-sky-night")}
        {sky("dawn", "cw-sky-dawn")}
        <g className="cw-stars" opacity={0}>
          {stars}
        </g>
        {/* 満月（6ページで北東の地平線から昇る。昇る前は見せない）。 */}
        <g className="cw-moon-show" opacity={0}>
          <StoryMoon p="cw" at="translate(130 640)" img={storyAsset("cold", "moon")} />
        </g>
        {/* 地上の物（夕方・夜は暗く沈める：.cw-land の filter）。 */}
        <g className="cw-land">
          <image href={A("far")} x={-420} y={300} width={1140} height={380} />
          {/* 遠景の丘の下の雪原（遠景と中景の絵のすきまに空が見えないように） */}
          <rect x={-430} y={660} width={1160} height={640} fill={SNOW} />
          <image href={A("middle")} x={-430} y={402} width={1160} height={387} />
          {/* 穴のあるシラカバ（c05） */}
          <image
            className="cw-trunk"
            href={A("trunk-hole")}
            x={TRUNK.x}
            y={TRUNK.y}
            width={TRUNK.w}
            height={TRUNK.h}
            mask="url(#cw-trunk-mask)"
          />
          {/* 穴の中で丸くなるコガラ（5・8ページは目を閉じ、6ページは開く）。穴の口の形に切る。 */}
          <g clipPath="url(#cw-hole)">
            <rect x={HOLE.x - HOLE.r} y={HOLE.y - HOLE.r} width={HOLE.r * 2} height={HOLE.r * 2} fill="#1a0f08" opacity={0} />
            <g className="cw-fluff-closed cw-breath" opacity={0}>
              <image
                href={A("fluff-closed")}
                x={HOLE.x - FLUFF.w / 2}
                y={HOLE.y - FLUFF.h * 0.42}
                width={FLUFF.w}
                height={FLUFF.h}
              />
            </g>
            <g className="cw-fluff-open cw-breath" opacity={0}>
              <image
                href={A("fluff-open")}
                x={HOLE.x - FLUFF.w / 2}
                y={HOLE.y - FLUFF.h * 0.42}
                width={FLUFF.w}
                height={FLUFF.h}
              />
            </g>
          </g>
          {/* 幹のすきまに種をかくすコガラ（3ページ、c03）。世界の左の外にあり、3ページだけカメラが向く。 */}
          <g className="cw-seed cw-breath">
            <image href={A("seed-trunk")} x={SEED.x} y={SEED.y} width={SEED.w} height={SEED.h} mask="url(#cw-seed-mask)" />
          </g>
          {/* 雪原（中景と近景の間を埋め、幹の根元を雪に沈める） */}
          <rect x={-430} y={TRUNK.y + TRUNK.h - 8} width={1160} height={600} fill={SNOW} />
          <image href={A("near")} x={-430} y={548} width={1160} height={387} />
          {/* 夜明けの枝でさえずるコガラ（9ページ、c07）。 */}
          <g className="cw-song cw-breath" opacity={0}>
            <image href={A("song")} x={SONG.x} y={SONG.y} width={SONG.w} height={SONG.h} />
          </g>
        </g>
        {/* 前景の雪の枝（1・2ページ、c09）と、枝にとまるコガラ（2ページ、c01）。後半のページには残さない。 */}
        <g className="cw-bough">
          <image href={A("branch")} x={-150} y={92} width={420} height={210} />
          <g className="cw-perch cw-breath" opacity={0}>
            <image
              href={A("perch")}
              x={PERCH.at[0] - (PERCH.w * PERCH.foot[0]) / 1536}
              y={PERCH.at[1] - (PERCH.h * PERCH.foot[1]) / 1024}
              width={PERCH.w}
              height={PERCH.h}
            />
          </g>
        </g>
      </g>
      {/* 雪（場面に合わせて見せる） */}
      <g className="cw-snow">{flakes}</g>
      <rect width={W} height={H} fill="url(#cw-vignette)" pointerEvents="none" />
    </svg>
  );
}

// ---- 動き（GSAP、型は最小限。BeaverWorld.tsx と同じ形） ---------------------------------------------

type Tween = {
  to: (...a: unknown[]) => Tween;
  fromTo: (...a: unknown[]) => Tween;
  set: (...a: unknown[]) => Tween;
};
type Loop = Tween & {
  play: () => unknown;
  pause: () => unknown;
  time: (t: number) => unknown;
};
type Gsap = {
  timeline: (o?: unknown) => Tween;
  utils: { toArray: <T>(s: string, el: Element) => T[] };
};

/** 場面の動き（tl は COLD_BEATS 拍、スクロールに合わせる）と、くり返す動き（雪・呼吸・月の光）。 */
export function buildColdScene(gsap: Gsap, root: Element, tl: Tween, loops = true): Loop | null {
  buildBeats(tl);
  return loops ? startLoops(gsap, root) : null;
}

function startLoops(gsap: Gsap, root: Element): Loop {
  const loop = gsap.timeline({ paused: true }) as Loop;
  const flakes = gsap.utils.toArray<Element>(".cw-flake", root);
  // 雪：まっすぐ静かに。
  loop.to(
    flakes,
    {
      y: 900,
      x: (i: number) => `+=${((i % 3) - 1) * 8}`,
      duration: (i: number) => 11 + (i % 7),
      ease: "none",
      stagger: { each: 0.5, repeat: -1 },
    },
    0,
  );
  // 呼吸（docs/moon-story.md「動き」）：止まっている姿は、数秒に一度、ごくわずかにふくらんで戻る。
  loop.to(
    ".cw-breath",
    { scaleY: 1.015, scaleX: 1.005, transformOrigin: "50% 100%", duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: -1, repeatDelay: 1.8 },
    0,
  );
  loop.to(".cw-moon-glow", { opacity: 0.75, duration: 2.6, yoyo: true, repeat: -1, ease: "sine.inOut" }, 0);
  loop.time(40);
  return loop;
}

/** 各コマの動きは、そのコマの頭から 0.75 までに終える（docs/moon-story.md「動きの決まり」）。 */
function buildBeats(tl: Tween) {
  const move = (at: number, c: ReturnType<typeof cam>) =>
    tl.to(".cw-camera", { ...c, duration: 0.75, ease: "power2.inOut" }, at);
  // 1 雪の森：少し寄った遠景から、森全体へ。
  tl.fromTo(
    ".cw-camera",
    { ...cam(200, 470, 1.25), svgOrigin: "200 430" },
    { ...cam(200, 450, 1.05), duration: 0.75, ease: "power2.inOut" },
    0,
  );
  // 2 雪の枝の小さなコガラ：枝に寄る。
  move(1, cam(150, 250, 2.1)).to(".cw-perch", { opacity: 1, duration: 0.12 }, 1.2);
  // 3 ひとつぶずつ：幹のすきまに種をかくすコガラ（世界の左）へ。
  move(2, cam(SEED.x + SEED.w * 0.5, SEED.y + SEED.h * 0.44, 1.4));
  // 4 はやい夕暮れ：引いて空を広く。空と雪が青いかげへ。前景の枝は画面から出る。
  move(3, cam(200, 420, 1.0))
    .to(".cw-perch", { opacity: 0, duration: 0.05 }, 3.0)
    .to(".cw-sky-dusk", { opacity: 1, duration: 0.6, ease: "sine.inOut" }, 3.05)
    .to(".cw-land", { filter: "brightness(0.72) saturate(0.8)", duration: 0.6, ease: "sine.inOut" }, 3.05)
    .to(".cw-bough", { opacity: 0, duration: 0.4 }, 3.1);
  // 5 木の穴へ：穴に寄る。コガラが穴の中で丸くなる（目を閉じた姿）。
  move(4, cam(HOLE.x, HOLE.y + 10, 2.5)).to(".cw-fluff-closed", { opacity: 1, duration: 0.15 }, 4.35);
  // 6 月が昇る：引いて、北東の地平線から月。夜になり、穴の口のコガラは目を開けて月を見る。
  move(5, cam(200, 470, 1.0))
    .to(".cw-sky-night", { opacity: 1, duration: 0.5, ease: "sine.inOut" }, 5)
    .to(".cw-land", { filter: "brightness(0.5) saturate(0.7)", duration: 0.5, ease: "sine.inOut" }, 5)
    .to(".cw-stars", { opacity: 1, duration: 0.4 }, 5.1)
    .to(".cw-moon-show", { opacity: 1, duration: 0.03 }, 5.15)
    .to(".cw-moon", { attr: { transform: "translate(130 520)" }, duration: 0.55, ease: "power1.out" }, 5.18)
    .to(".cw-fluff-closed", { opacity: 0, duration: 0.05 }, 5.2)
    .to(".cw-fluff-open", { opacity: 1, duration: 0.05 }, 5.22);
  // 7 高く、高く：見上げる（下に森、上に月）。月は東から南の高い所へ。真上にはしない。
  move(6, cam(200, 330, 1.0))
    .to(".cw-moon", { attr: { transform: "translate(150 150)" }, duration: 0.7, ease: "sine.inOut" }, 6.02)
    .to(".cw-fluff-open", { opacity: 0, duration: 0.05 }, 6.1)
    .to(".cw-fluff-closed", { opacity: 1, duration: 0.05 }, 6.12);
  // 8 ながい夜：穴の口に寄る。月の円盤は画面に入れない（光だけ。光の帯は PR-3）。
  move(7, cam(HOLE.x, HOLE.y + 6, 2.9)).to(".cw-moon", { attr: { transform: "translate(-60 330)" }, duration: 0.6 }, 7.05);
  // 9 コールドムーン：夜明けの森の一枚の絵。西の空の低い所に白い月、コガラは穴から出て枝でさえずる。
  move(8, cam(200, 440, 0.96))
    .to(".cw-sky-dawn", { opacity: 1, duration: 0.6, ease: "sine.inOut" }, 8)
    .to(".cw-sky-night", { opacity: 0, duration: 0.6, ease: "sine.inOut" }, 8.05)
    .to(".cw-stars", { opacity: 0, duration: 0.5 }, 8.05)
    .to(".cw-land", { filter: "brightness(0.9) saturate(0.9)", duration: 0.6, ease: "sine.inOut" }, 8.05)
    .set(".cw-moon", { attr: { transform: "translate(64 330) scale(0.55)" } }, 8.02)
    .to(".cw-fluff-closed", { opacity: 0, duration: 0.05 }, 8.1)
    .to(".cw-song", { opacity: 1, duration: 0.15 }, 8.3);
}
