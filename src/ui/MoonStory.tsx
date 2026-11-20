// 満月の物語（2026-11-20 渡辺さん「GSAP + ScrollTrigger Apple風の複雑なスクロール演出」、全画面のページ）。
// 11/20 渡辺さん「一コマ一コマ、一つ一つのパーツ、背景、描画を通じた一体感で物語の世界観を表現し、満月の魅力を体験させる」
// 「テーマカラー関係なく共通で一本で」：一冊の絵本として見せる。
//   1. 本：紺の革の表紙が開き（見開きが画面に収まる）、紙のページにひと言。そのページの中へ入っていく。
//   2. 絵本の場面：一枚の続いた世界を、物語の一文ごとに一コマずつ（src/design/story）。文は空に一字ずつ浮かぶ。
//      場面の無い満月は、ひと言と物語の一段落ずつ。
//   3. 今夜の情報（11/20 渡辺さん「物語の最後には情報も」）：瞬間のカードと、その夜の空のカード（イベントの説明と同じ
//      部品、EventInfo）、その年だけのこと。
//   4. 知識：名前の由来・自然との関係（紙のページ）。次の満月の物語へ（一年を巡る13の物語）と、この年の一覧へ。
// 文は毎年使える部分だけ（shared/fullMoonNames.ts）、その年だけのことは計算から。絵と動きは文化的なイメージで、実際の
// 月の色や見え方とは別（ページの終わりに断る）。GSAP と ScrollTrigger は、このページを開いたときだけ読み込む。
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BLUE_MOON,
  FULL_MOON_NAMES,
  fullMoonInfo,
  type FullMoonNameInfo,
} from "../../shared/fullMoonNames";
import {
  fullMoonAlias,
  fullMoonName,
  fullMoonsOfYear,
} from "../../shared/moon";
import { skyEventOn, type SkyEvent } from "../../shared/skyEvents";
import { DEFAULT_LAT_LON } from "../../shared/sunTimes";
import type { WeatherStore } from "../data/store";
import { eventArt, eventIcon } from "../design/eventAssets";
import { eventStage } from "../design/eventLogo";
import {
  bookVars,
  Flourish,
  GoldDefs,
  GoldFrame,
  spineVar,
} from "../design/story/Book";
import {
  CloudMark,
  Glint,
  LeafRule,
  PaperCorner,
  PhaseRow,
  MoonEmblem,
  SpineHills,
  SpineLatin,
  Sprig,
  SymbolIcon,
  Twig,
} from "../design/story/emblems";
import { STORY_SCENES } from "../design/story/scenes";
import { storyAsset } from "../design/story/storyAssets";
import { onSkyVars } from "../design/tokens";
import { EventMomentCard, EventNightCard } from "./EventInfo";
import { STARS } from "./eventBits";
import { factTags } from "./FullMoonSheet";
import { type Pager, storyPager } from "./storyPager";
import { CloseIcon } from "./icons";
import { Button, Glyph, IconButton } from "./kit";

const WHERE = "高知";
/** 開いた本（見開き）を画面に収める縮め方（表紙は画面の幅の 84% まで大きく、見開きはその 2 倍の幅）。 */
const SPREAD = 0.56;
const HOUR_MS = 3_600_000;
/** 締めくくりのきらめき：[横 %, 縦 %, 大きさ（倍）, 遅れ（秒）]。文のまわりに散らし、同時には一つ二つだけ光る。 */
const GLINTS: [number, number, number, number][] = [
  [18, 30, 0.9, 0.4],
  [82, 34, 0.7, 1.6],
  [12, 52, 0.6, 2.7],
  [88, 50, 1, 3.5],
  [26, 66, 0.55, 1.1],
  [74, 70, 0.75, 2.2],
  [50, 22, 0.5, 4.2],
];

/**
 * 物語の区切り（スクロールの px、小さい順）：表紙・見開き・場面の一コマずつ（文が読める所）・場面の終わり（一枚の絵）・
 * 締めくくり・今夜の情報の頭。下のドットは場面のコマ（firstBeat から一つずつ）。
 */
function storyStops(
  el: HTMLElement,
  scene: { beats: number } | null | undefined,
): { px: number[]; firstBeat: number } {
  const vh = el.clientHeight;
  const b = el.querySelector<HTMLElement>(".ms-book");
  const w = el.querySelector<HTMLElement>(".ms-world");
  const ep = el.querySelector<HTMLElement>(".ms-epilogue");
  const end = el.querySelector<HTMLElement>(".ms-info")?.offsetTop ?? 0;
  const px: number[] = [0];
  let firstBeat = -1;
  if (b) px.push(((b.offsetHeight - vh) * 1.35) / 2.8);
  if (w && scene) {
    const r = w.offsetHeight - vh;
    firstBeat = px.length;
    for (let i = 0; i < scene.beats; i++)
      px.push(w.offsetTop + ((i + 0.55) / scene.beats) * r);
    px.push(w.offsetTop + r);
  } else if (b) px.push(b.offsetHeight - vh);
  if (ep) px.push(ep.offsetTop + ep.offsetHeight / 2 - vh / 2);
  px.push(end);
  return {
    px: px.map((p) => Math.round(Math.min(end, Math.max(0, p)))),
    firstBeat,
  };
}
const jst = (ms: number) => {
  const d = new Date(ms + 9 * HOUR_MS);
  return {
    date: d.toISOString().slice(0, 10),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
  };
};

/** 一字ずつ浮かぶ文（読み上げは文のまま、字の箱は読み上げない）。 */
function Letters({ text }: { text: string }) {
  return (
    <>
      <span className="ms-sr">{text}</span>
      <span aria-hidden>
        {[...text].map((c, i) => (
          <span key={i} className="ms-ch">
            {c}
          </span>
        ))}
      </span>
    </>
  );
}

export function MoonStory({
  at,
  store,
  onClose,
  onList,
  onNext,
}: {
  at: number;
  store?: WeatherStore | null;
  onClose: () => void;
  onList?: () => void;
  onNext?: (at: number) => void;
}) {
  const { lat, lon } = DEFAULT_LAT_LON;
  const root = useRef<HTMLDivElement>(null);
  const pager = useRef<Pager | null>(null);
  /** 場面の最初のコマの区切りの番号（ドットの 0 番）。場面が無ければ -1。 */
  const beatAt = useRef(-1);
  const j = jst(at);
  // その満月のイベント（食の日は食、ふだんは満月）と呼び名・説明。
  const event: SkyEvent = useMemo(() => {
    const e = skyEventOn(j.date, lat, lon);
    if (e && Math.abs(e.at - at) < 2 * 86_400_000) return e;
    const n = fullMoonName(at);
    return {
      kind: "full",
      at,
      name: n.name,
      blue: n.blue,
      span: null,
      obscuration: null,
    };
  }, [at, j.date, lat, lon]);
  const info: FullMoonNameInfo | null = event.name
    ? fullMoonInfo(event.name)
    : null;
  const story = event.blue ? { ...BLUE_MOON, short: BLUE_MOON.short } : info;
  const title = event.blue ? "ブルームーン" : (event.name ?? "満月");
  const facts = useMemo(
    () =>
      fullMoonsOfYear(Number(j.date.slice(0, 4)), lat, lon).find(
        (f) => Math.abs(f.at - at) < 2 * 86_400_000,
      ) ?? null,
    [j.date, lat, lon, at],
  );
  const tags = facts ? factTags(facts, WHERE) : [];
  const stage = eventStage(event.kind, event.blue, "navy");
  const pic = eventIcon(event) ?? eventArt(event, "navy")?.src ?? null;
  const wide = !eventIcon(event);
  // 絵本の場面（一文が一コマ）。場面の無い満月は、本の表紙と文だけ。
  const lines = story?.tale?.lines ?? [];
  // 場面は呼び名で引く（ブルームーンは「ブルームーン」で）。
  const sceneKey = event.blue ? "ブルームーン" : event.name;
  const scene =
    sceneKey && lines.length ? (STORY_SCENES[sceneKey] ?? null) : null;
  const World = scene?.World;
  const Win = scene?.Window;
  // 次の満月（一年を巡る物語）。
  // 本棚（11/20 18:01 渡辺さん「本棚っぽく。タップすると取り出すようなエフェクトからページが切り替わる」）：
  // 一年を巡る満月の物語を、暦の順（1月〜12月、ブルームーンは最後）に背を並べる。それぞれの本は、その呼び名の次の
  // 満月（今から5年先まで）を開く。読んでいる本は棚から抜けている。次に来る満月の本には「次」の印。
  const shelf = useMemo(() => {
    const y = Number(j.date.slice(0, 4));
    const all = [y, y + 1, y + 2, y + 3, y + 4].flatMap((yy) =>
      fullMoonsOfYear(yy, lat, lon),
    );
    const from = Math.min(at, Date.now()) - 12 * HOUR_MS;
    const later = all.filter(
      (f) => f.at > from && Math.abs(f.at - at) > 2 * 86_400_000,
    );
    const soon = all.find((f) => f.at > at + 86_400_000) ?? null;
    const books = [...FULL_MOON_NAMES.map((n) => n.name), "ブルームーン"].map(
      (name) => {
        const hit =
          later.find((f) =>
            name === "ブルームーン" ? f.blue : !f.blue && f.name === name,
          ) ?? null;
        const reading = name === (event.blue ? "ブルームーン" : event.name);
        const en =
          name === "ブルームーン"
            ? BLUE_MOON.en
            : (fullMoonInfo(name)?.en ?? "");
        return {
          name,
          en,
          at: hit?.at ?? null,
          reading,
          next: !!hit && !!soon && hit.at === soon.at,
        };
      },
    );
    return { books, soon };
  }, [j.date, lat, lon, at, event.blue, event.name]);
  const next = shelf.soon;
  // 本を取り出す：背が棚から持ち上がり、表紙をこちらへ向けながら画面の真ん中へ（次の物語の表紙と同じ位置・大きさ）。
  // そこで次の物語に切り替わる（次の物語は表紙から始まる）。動きを減らす設定では、すぐ切り替える。
  const pull = (
    e: React.MouseEvent<HTMLButtonElement>,
    book: { at: number | null; en: string; name: string },
  ) => {
    if (!book.at || !onNext) return;
    const target = book.at;
    const spine = e.currentTarget;
    const fly = root.current?.querySelector<HTMLElement>(".ms-flybook");
    if (
      !fly ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !spine.animate
    )
      return onNext(target);
    const r = spine.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(vw * 0.84, 340);
    const h = (w * 7) / 5;
    fly.querySelector("b")!.textContent = book.name;
    fly.querySelector(":scope > span")!.textContent = book.en;
    fly.style.cssText = `${spine.getAttribute("style") ?? ""}`;
    fly.hidden = false;
    spine.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-38%)" }],
      { duration: 220, easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" },
    );
    const from = `perspective(1200px) translate(${r.left}px, ${r.top - r.height * 0.38}px) scale(${r.width / w}, ${r.height / h}) rotateY(78deg)`;
    const to = `perspective(1200px) translate(${(vw - w) / 2}px, ${(vh - h) / 2}px) scale(1, 1) rotateY(0deg)`;
    fly.style.width = `${w}px`;
    fly.style.height = `${h}px`;
    const a = fly.animate(
      [
        { transform: from, opacity: 0 },
        { transform: from, opacity: 1, offset: 0.15 },
        { transform: to, opacity: 1 },
      ],
      {
        duration: 720,
        delay: 160,
        easing: "cubic-bezier(.45,.05,.25,1)",
        fill: "forwards",
      },
    );
    a.onfinish = () => onNext(target);
  };

  // 閉じる：Esc と、開いている間は後ろをスクロールさせない。
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.focus();
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // スクロールの演出（GSAP + ScrollTrigger、このページを開いたときだけ読み込む）。GSAP 公式スキル（greensock/gsap-skills）
  // の決まりに合わせる：動きを減らす設定は gsap.matchMedia で分け（設定が変わっても直る）、ScrollTrigger はページの上から
  // 順に作り、タイムラインの上にだけ付け、くり返す動きは見えない間は止め、字が読み込まれたら位置を測り直す。
  const [ready, setReady] = useState(false);
  // 物語をとばす（今夜の情報へ）：情報が見えたら消す。場面を押すと次の場面へ（スクロールで進むのと同じ）。
  const infoRef = useRef<HTMLElement>(null);
  const [skip, setSkip] = useState(true);
  useEffect(() => {
    const el = root.current;
    const info = infoRef.current;
    if (!el || !info) return;
    const watch = () =>
      setSkip(info.getBoundingClientRect().top > el.clientHeight * 0.6);
    el.addEventListener("scroll", watch, { passive: true });
    return () => el.removeEventListener("scroll", watch);
  }, []);
  const skipStory = () => {
    const el = root.current;
    const info = infoRef.current;
    if (el && info && pager.current) pager.current.glide(info.offsetTop);
    else info?.scrollIntoView({ behavior: "smooth" });
  };
  // 場面を押すと次のコマへ（ページ送りと同じ動き）。
  const nextBeat = () => pager.current?.step(1);
  // 下のドットを押すと、そのコマへ（同じ動き）。ドットの列が一つのボタン（高さ 44px）で、押した所に近いドットへ。
  const toDot = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const dots = [...e.currentTarget.querySelectorAll<HTMLElement>(".ms-beat")];
    if (!dots.length || beatAt.current < 0) return;
    let k = 0;
    dots.forEach((d, i) => {
      const r = d.getBoundingClientRect();
      const r0 = dots[k].getBoundingClientRect();
      if (
        Math.abs(r.left + r.width / 2 - e.clientX) <
        Math.abs(r0.left + r0.width / 2 - e.clientX)
      )
        k = i;
    });
    pager.current?.goTo(beatAt.current + k);
  };
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let mm: { revert: () => void } | null = null;
    let unPager = () => {};
    let live = true;
    void (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (!live) return;
      gsap.registerPlugin(ScrollTrigger);
      const media = gsap.matchMedia(el);
      mm = media;
      // 動きを減らす設定：場面は動かさず、月が昇ったあとの一枚の絵として見せる（文はその下に全部）。
      media.add("(prefers-reduced-motion: reduce)", () => {
        if (!scene) return;
        const tl = gsap.timeline({ paused: true });
        scene.build(gsap as never, el, tl as never, false);
        tl.progress((scene.beats - 1.5) / scene.beats);
      });
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const scroller = el;
        const scrub = (trigger: string) => ({
          trigger: el.querySelector(trigger),
          scroller,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.6,
        });
        // 1. 本：表紙が左へ開いて見開きになる（本は右へ寄りながら小さくなり、見開きが画面に収まる）。表紙は開くほど
        //    暗く、ページには表紙の影が落ちて消える。続いて文が消え、ページの中へ寄っていき、紙の色で次の場面へつなぐ。
        // 本は場面が止まる位置まで留まり（場面はその下に重なって上がってくる）、最後に窓の空の色で覆って、本の舞台を消す。
        // 場面は止まるとすぐにその色から溶けて現れるので、何も無い時間をはさまない（11/20 17:58 渡辺さん「夕焼けが長すぎる」）。
        const book = gsap.timeline({
          scrollTrigger: { ...scrub(".ms-book"), invalidateOnRefresh: true },
        });
        // 窓が画面を覆う大きさと、窓の真ん中を画面の真ん中へ動かす量（本の真ん中を軸に大きくする）。
        const dive = () => {
          const b = el.querySelector<HTMLElement>(".bk");
          const w = el.querySelector<HTMLElement>(".bk-window");
          if (!b || !w) return { s: 4, x: 0, y: 0 };
          const s =
            Math.max(
              el.clientWidth / w.offsetWidth,
              el.clientHeight / w.offsetHeight,
            ) * 1.04;
          const dx = w.offsetLeft + w.offsetWidth / 2 - b.offsetWidth / 2;
          const dy = w.offsetTop + w.offsetHeight / 2 - b.offsetHeight / 2;
          return { s, x: -s * dx, y: -s * dy };
        };
        book
          .to(".ms-book-hint", { opacity: 0, duration: 0.1 }, 0)
          // 縮めたあとに背（左の端）が画面の真ん中に来るよう、ずらす量は 50% × 縮める割合。
          .fromTo(
            ".bk",
            { xPercent: 0, scale: 1 },
            {
              xPercent: 50 * SPREAD,
              scale: SPREAD,
              ease: "power2.inOut",
              duration: 1,
            },
            0.3,
          )
          // 表紙は背（左の端）を軸に、前半で起き上がり（幅が縮み、手前に来るので少し大きく、影が濃く）、後半で表紙の裏が
          // 左へ倒れて見開きになる（幅が広がり、影が抜ける）。背でつながったまま、二つのページは同じ大きさ（11/20 16:23
          // 渡辺さん「ページが離れていく動きが不自然」）。
          .fromTo(
            ".bk-cover",
            { scaleX: 1, scaleY: 1 },
            { scaleX: 0, scaleY: 1.05, ease: "power2.in", duration: 0.5 },
            0.3,
          )
          .fromTo(
            ".bk-cover-shade",
            { opacity: 0 },
            { opacity: 0.6, ease: "power1.in", duration: 0.5 },
            0.3,
          )
          .fromTo(
            ".bk-back",
            { scaleX: 0, scaleY: 1.05 },
            { scaleX: 1, scaleY: 1, ease: "power2.out", duration: 0.5 },
            0.8,
          )
          .fromTo(
            ".bk-back-shade",
            { opacity: 0.6 },
            { opacity: 0, ease: "power1.out", duration: 0.5 },
            0.8,
          )
          .fromTo(
            ".bk-page-shadow",
            { opacity: 1 },
            { opacity: 0, ease: "power1.out", duration: 0.9 },
            0.4,
          )
          // 窓の中へ寄る：窓が画面いっぱいになるまで本を大きくし、窓の真ん中を画面の真ん中へ。文と枠は先に消える。
          .to(
            [
              ".bk-page-text > small",
              ".bk-page-text > h3",
              ".bk-page .bk-frame",
            ],
            { opacity: 0, duration: 0.25 },
            1.65,
          )
          .to(
            ".bk",
            {
              xPercent: 0,
              scale: () => dive().s,
              x: () => dive().x,
              y: () => dive().y,
              ease: "power2.inOut",
              duration: 1,
            },
            1.75,
          )
          .to(".ms-book-dive", { opacity: 1, duration: 0.25 }, 2.55)
          .set(".ms-book > .ms-sticky", { autoAlpha: 0 }, 2.8);
        // 場面の無い満月：覆った夜の色は本の終わりに自分で溶かす（場面が溶かす役をしないので）。
        if (!scene)
          book.to(".ms-dive-wrap", { opacity: 0, duration: 0.3 }, 2.8);
        // 表紙のメダルの光が脈打つ（本が画面にある間だけ）。
        const glow = gsap.to(".bk-medal-glow", {
          opacity: 0.85,
          duration: 2.6,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
          paused: true,
        });
        ScrollTrigger.create({
          trigger: el.querySelector(".ms-book"),
          scroller,
          start: "top bottom",
          end: "bottom top",
          onToggle: (t) => (t.isActive ? glow.play() : glow.pause()),
        });
        // 2. 絵本の場面：一文ごとに一コマ。紙が中心から溶けて絵が現れ、文は空に一字ずつ浮かぶ。
        if (scene) {
          const world = gsap.timeline({ scrollTrigger: scrub(".ms-world") });
          // 窓の絵（場面の最初の空）から、本当の場面へ溶ける。
          // 本の終わりに画面を覆った空の色（.ms-book-dive は画面に固定）は、場面が止まってから溶ける。場面が下から
          // 上がってくる間は覆ったままなので、境目は見えない。
          world.fromTo(
            ".ms-dive-wrap",
            { opacity: 1 },
            {
              opacity: 0,
              ease: "power1.in",
              duration: 0.3,
              immediateRender: false,
            },
            0,
          );
          const loop = scene.build(gsap as never, el, world as never);
          lines.forEach((_, i) => {
            const cap = `.ms-cap[data-i="${i}"]`;
            world
              .set(cap, { opacity: 1 }, i + 0.06)
              .fromTo(
                `${cap} .ms-ch`,
                { opacity: 0, y: 10, filter: "blur(3px)" },
                {
                  opacity: 1,
                  y: 0,
                  filter: "blur(0px)",
                  duration: 0.12,
                  ease: "power1.out",
                  stagger: { amount: 0.42 },
                },
                i + 0.06,
              )
              .to(
                cap,
                {
                  opacity: 0,
                  y: -12,
                  filter: "blur(2px)",
                  duration: 0.16,
                  ease: "power1.in",
                },
                i + 0.84,
              )
              .set(cap, { y: 0, filter: "blur(0px)" }, i + 1);
          });
          world.fromTo(
            ".ms-world-frame",
            { opacity: 0, scale: 1.06 },
            { opacity: 1, scale: 1, duration: 0.5 },
            scene.beats - 0.7,
          );

          world.set({}, {}, scene.beats);
          // 物語の月 → 今夜の情報の月：場面が画面から出始めてから、瞬間のカードの月が所定の位置に来るまで、浮かぶ月が
          // 二つの月の間を（どちらも今の位置から測って）移る。途中は元の二つの月を隠す。
          const fly = el.querySelector<HTMLElement>(".ms-flymoon");
          // 場面の月の目印は、どの場面でも StoryMoon（src/design/story/parts.tsx）が付ける。
          const from = el.querySelector<SVGGElement>("[data-story-moon]");
          const disc = el.querySelector<SVGElement>("[data-story-disc]");
          const to = () =>
            el.querySelector<HTMLElement>(".ms-info .emc-sky > canvas");
          const ease = gsap.parseEase("power2.inOut");
          const place = (p: number) => {
            const target = to();
            if (!fly || !from || !disc || !target) return;
            const moving = p > 0 && p < 1;
            fly.style.opacity = moving ? "1" : "0";
            from.style.opacity = p > 0 ? "0" : "";
            target.style.opacity = p < 1 ? "0" : "";
            if (!moving) return;
            const a = disc.getBoundingClientRect();
            const b = target.getBoundingClientRect();
            const k = ease(p);
            const size = a.width + (b.width - a.width) * k;
            const cx =
              a.left +
              a.width / 2 +
              (b.left + b.width / 2 - a.left - a.width / 2) * k;
            const cy =
              a.top +
              a.height / 2 +
              (b.top + b.height / 2 - a.top - a.height / 2) * k;
            gsap.set(fly, {
              width: size,
              height: size,
              x: cx - size / 2,
              y: cy - size / 2,
            });
          };
          ScrollTrigger.create({
            trigger: el.querySelector(".ms-world"),
            scroller,
            start: "bottom bottom",
            endTrigger: el.querySelector(".ms-info .event-moment-card"),
            end: "center 55%",
            onUpdate: (t) => place(t.progress),
            onLeave: () => place(1),
            onLeaveBack: () => place(0),
          });
          // 落ち葉や雪は、場面が画面にある間だけ動かす。
          if (loop)
            ScrollTrigger.create({
              trigger: el.querySelector(".ms-world"),
              scroller,
              start: "top bottom",
              end: "bottom top",
              onToggle: (t) => (t.isActive ? loop.play() : loop.pause()),
            });
        }
        // 3〜6. 文・札・段落が、ページの上から順に浮かび上がる。
        gsap.utils
          .toArray<HTMLElement>(".ms-rise, .ms-fact, .ms-tale-line", el)
          .forEach((t) => {
            const at = { trigger: t, scroller, scrub: 0.5 };
            // clamp：ページの終わり近くの段も、いちばん下までスクロールすれば浮かび終わる（途中で止まって重ならない）。
            if (t.classList.contains("ms-fact"))
              gsap.fromTo(
                t,
                { opacity: 0, scale: 0.86 },
                {
                  opacity: 1,
                  scale: 1,
                  ease: "back.out(1.6)",
                  scrollTrigger: {
                    ...at,
                    start: "clamp(top 90%)",
                    end: "clamp(top 65%)",
                  },
                },
              );
            else if (t.classList.contains("ms-tale-line"))
              gsap.fromTo(
                t,
                { opacity: 0.14, y: 16 },
                {
                  opacity: 1,
                  y: 0,
                  ease: "none",
                  scrollTrigger: {
                    ...at,
                    start: "clamp(top 80%)",
                    end: "clamp(top 48%)",
                  },
                },
              );
            else
              gsap.fromTo(
                t,
                { opacity: 0, y: 48 },
                {
                  opacity: 1,
                  y: 0,
                  ease: "none",
                  scrollTrigger: {
                    ...at,
                    start: "clamp(top 92%)",
                    end: "clamp(top 62%)",
                  },
                },
              );
          });
        // 物語から今夜の情報へ移る間の一言：画面の下から入ると現れ、真ん中を過ぎると消える（ずれは少し、文字は動かしすぎない）。
        // 物語から今夜の情報へ移る間の一言（11/20 21:16 渡辺さん「すっと現れて、滲みながら消える」）：くっきり現れ、
        // 消えるときは一字ずつ滲んで溶ける（端の字から少し先に、字間がわずかに開く）。滲みは控えめ（iPhone で重くしない）。
        const herald = el.querySelector(".ms-herald-text");
        const hl = gsap.utils.toArray<HTMLElement>(".ms-herald-text .ms-hl");
        if (herald && hl.length) {
          const mid = (hl.length - 1) / 2;
          gsap
            .timeline({
              scrollTrigger: {
                trigger: herald,
                scroller,
                start: "top 88%",
                end: "bottom 18%",
                scrub: 0.4,
              },
            })
            .fromTo(
              herald,
              { opacity: 0, y: 12 },
              { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" },
            )
            .to(herald, { opacity: 1, duration: 0.25 })
            .to(hl, {
              opacity: 0,
              filter: "blur(5px)",
              x: (i: number) => (i - mid) * 1.6,
              duration: 0.32,
              ease: "power1.in",
              stagger: { each: 0.016, from: "edges" },
            });
        }
        // 区切りのドットは、場面の動きではなく、ページ送りの「いまの区切り」で灯す（storyPager の onIndex）。
      });
      // 明朝の字が読み込まれると高さが変わるので、測り直す。
      void document.fonts?.ready.then(() => live && ScrollTrigger.refresh());
      // ページ送り（11/20 20:17 渡辺さん「慣性スクロール・スナップ改善」、src/ui/storyPager.ts）：物語の部分は、指の
      // 動きから行き先の区切りを決めて、指を離した速さのまま滑らかに運ぶ。区切りは ScrollTrigger が測り直すたびに取り直す。
      let firstBeat = -1;
      const dots = [...el.querySelectorAll<HTMLElement>(".ms-beat")];
      const pg = storyPager(el, {
        measure: () => {
          const m = storyStops(el, scene);
          firstBeat = m.firstBeat;
          beatAt.current = firstBeat;
          return m.px;
        },
        reduced: () =>
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        onIndex: (i) =>
          dots.forEach((d, k) =>
            d.classList.toggle("on", firstBeat >= 0 && k === i - firstBeat),
          ),
      });
      pager.current = pg;
      ScrollTrigger.addEventListener("refresh", pg.refresh);
      unPager = () => {
        ScrollTrigger.removeEventListener("refresh", pg.refresh);
        pg.destroy();
        pager.current = null;
      };
      setReady(true);
    })();
    return () => {
      live = false;
      mm?.revert();
      unPager();
    };
  }, [scene]);

  const style = {
    ...(onSkyVars() as CSSProperties),
    ...bookVars(),
    ["--beats" as string]: scene?.beats ?? 0,
    ["--ms-scene-sky" as string]: scene?.sky ?? "none",
    ["--ev-glow" as string]: stage.glow,
    ["--ev-line" as string]: stage.line,
    ["--ev-star" as string]: stage.star,
  } as CSSProperties;

  return (
    <div
      className={ready ? "moon-story ready" : "moon-story"}
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={`${title}の物語`}
      tabIndex={-1}
      style={style}
    >
      {/* 上の帯：閉じる・とばすの下を夜の色で薄く覆い、文と重ならないように（11/20 17:58 渡辺さん「✖️ボタンとの文字被り」）。 */}
      <GoldDefs />
      <span className="ms-topband" aria-hidden />
      {/* 本棚から取り出す本（押したときだけ見える）。 */}
      <span className="ms-flybook" aria-hidden hidden>
        <GoldFrame />
        <CloudMark className="bk-cloud" />
        <b />
        <span />
      </span>
      <div className={skip ? "ms-skip" : "ms-skip gone"}>
        <Button size="sm" kind="quiet" onClick={skipStory}>
          物語をとばす
        </Button>
      </div>
      {/* 物語の月を、今夜の情報の月へ引き継ぐ（16:45 のレビュー「同じ月が形を変えて次の画面へ」）。 */}
      {scene && <span className="ms-flymoon" aria-hidden />}
      {/* 本の終わりに画面を覆う空の色（画面に固定。場面の上に重ねるので、本の舞台の外に置く）。 */}
      {/* 覆うのは本が（中の色）、溶かすのは場面が（外の枠）。同じ値を二つのタイムラインで動かさない。 */}
      <span className="ms-dive-wrap" aria-hidden>
        <span className={scene ? "ms-book-dive scene" : "ms-book-dive"} />
      </span>
      <div className="ms-close">
        <IconButton label="閉じる" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      {/* 1. 本：紺の革の表紙（金の枠・満月のメダル・英語の名前を主に、日本語は小さく）が開き、紙のページにひと言。 */}
      <section className="ms-book">
        <div className="ms-sticky ms-book-stage">
          <span className="event-stars" aria-hidden>
            {STARS.map(([x, y, r, d], i) => (
              <i
                key={i}
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: r,
                  height: r,
                  animationDelay: `${d}s`,
                }}
              />
            ))}
            <b className="event-shoot" />
          </span>
          <div className="bk">
            <div className="bk-page">
              <div className="bk-inner">
                <GoldFrame />
                <div className="bk-page-text">
                  <small>{j.m}月の満月の物語</small>
                  {/* ページの窓：場面の最初のコマの小さな絵。この中へ寄って場面に入る（16:45 のレビュー「ページの中に風景が
                      広がる連続的な転換」）。場面の無い満月は、その満月の絵。 */}
                  <div className="bk-window">
                    {Win ? (
                      <Win />
                    ) : (
                      pic && (
                        <img
                          src={pic}
                          alt=""
                          className={wide ? "wide" : undefined}
                        />
                      )
                    )}
                  </div>
                  <h3>{story?.tale?.tagline ?? story?.gloss ?? title}</h3>
                </div>
              </div>
              <span className="bk-page-shadow" aria-hidden />
            </div>
            <div className="bk-cover">
              {/* 表紙（11/20 18:19 渡辺さんの見本）：革のしぼ、金の二重の枠と四隅の唐草、Weather Note の印、名前は明朝の金、
                  型押しの満月（絵を革に押したように）、ひと言、The Story of the Full Moon。 */}
              <div className="bk-front">
                <GoldFrame />
                {scene?.coverCorner && (
                  <>
                    <img
                      className="bk-corner l"
                      src={scene.coverCorner}
                      alt=""
                      aria-hidden
                    />
                    <img
                      className="bk-corner r"
                      src={scene.coverCorner}
                      alt=""
                      aria-hidden
                    />
                  </>
                )}
                <span className="bk-mark">
                  <CloudMark className="bk-cloud" />
                  <small>Weather Note</small>
                </span>
                <Flourish />
                <h2>{title}</h2>
                {story && <span className="bk-en">{story.en}</span>}
                {scene?.CoverArt ? (
                  // 素材を重ねた表紙の絵（11/20 18:42 渡辺さんの素材）。
                  <div className="bk-medal art">
                    <scene.CoverArt />
                  </div>
                ) : (
                  <div className="bk-medal">
                    <span className="bk-medal-glow" aria-hidden />
                    {pic && (
                      <img
                        src={pic}
                        alt=""
                        className={wide ? "wide" : undefined}
                      />
                    )}
                    <MoonEmblem
                      name={sceneKey ?? ""}
                      className="bk-medal-emblem"
                    />
                  </div>
                )}
                {story?.tale && (
                  <p className="bk-tag">{story.tale.tagline}。</p>
                )}
                <small className="bk-sub">
                  The Story of the Full Moon
                  {!event.blue && fullMoonAlias(event.name, at)
                    ? `・別名 ${fullMoonAlias(event.name, at)}`
                    : ""}
                </small>
                <span className="bk-cover-shade" aria-hidden />
              </div>
            </div>
            {/* 表紙の裏（開くと左のページになる）。 */}
            <div className="bk-back" aria-hidden>
              {pic && (
                <img src={pic} alt="" className={wide ? "wide" : undefined} />
              )}
              <span className="bk-back-shade" />
            </div>
          </div>
          <span className="ms-book-hint ms-hero-hint" aria-hidden>
            スクロールでページをひらく
            <Glyph name="down" />
          </span>
        </div>
      </section>

      {/* 2. 絵本の場面：一つの続いた世界を、物語の一文ごとに一コマずつ。文は空に一字ずつ。 */}
      {scene && World && (
        <section className="ms-world" aria-label={`${title}の物語`}>
          <div
            className="ms-sticky ms-world-stage"
            role="presentation"
            onClick={nextBeat}
          >
            <World />
            <span className="ms-world-frame" aria-hidden>
              <GoldFrame w={400} h={860} inset={10} bevel={false} />
            </span>
            <span className="ms-caps-veil" aria-hidden />
            <div className="ms-caps">
              {lines.map((t, i) => (
                <p key={i} className="ms-cap" data-i={i}>
                  <Letters text={t} />
                </p>
              ))}
            </div>
            <button
              type="button"
              className="ms-beats"
              aria-label="コマを選ぶ"
              onClick={toDot}
            >
              {lines.map((_, i) => (
                <i key={i} className="ms-beat" />
              ))}
            </button>
          </div>
        </section>
      )}

      {/* 締めくくり（16:27 のレビュー「最後の余韻」）：ひと言をもう一度。ここから今夜の情報へつなぐ。 */}
      {scene && story?.tale && (
        <section className="ms-chapter ms-epilogue">
          {/* きらめき（11/20 20:42 渡辺さん「ここにもちょっとキラッとしたエフェクトを」）：飾りの線の真ん中の菱形と、
              文のまわりに小さな星が、間をおいて一つずつ瞬く。動きを減らす設定では出さない。 */}
          <span className="ms-glints" aria-hidden>
            {GLINTS.map(([x, y, s, d], i) => (
              <Glint
                key={i}
                className="ms-glint"
                style={
                  {
                    ["--x" as string]: `${x}%`,
                    ["--y" as string]: `${y}%`,
                    ["--s" as string]: s,
                    ["--d" as string]: `${d}s`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
          <span className="ms-flourish-glint">
            <Flourish />
            <Glint className="ms-glint lead" />
          </span>
          <p className="ms-rise">
            {story.tale.tagline.split("、").map((t, i, all) => (
              <span key={i}>
                {t}
                {i < all.length - 1 ? "、" : "。"}
                {i < all.length - 1 && <br />}
              </span>
            ))}
          </p>
          <small className="ms-rise">{title}</small>
          {/* 小さな金の枯れ枝（11/20 21:05 渡辺さん）：名前の下にそっと。 */}
          <Twig className="ms-twig ms-rise" />
        </section>
      )}

      {/* 物語から今夜の情報へ移る間の一言（11/20 20:45 渡辺さん）：スクロールに合わせて、すっと現れ、すっと消える。 */}
      {scene && story?.tale?.herald && (
        <section className="ms-herald" aria-label={story.tale.herald}>
          <p className="ms-herald-text">
            {[...story.tale.herald].map((c, i) => (
              <span key={i} className="ms-hl">
                {c}
              </span>
            ))}
          </p>
        </section>
      )}

      {/* 2. 季節の物語（場面の無い満月）：ひと言と、物語の一段落ずつ。物語の無い呼び名は、象徴の文だけ。 */}
      {story && !scene && (
        <section className="ms-chapter ms-tale">
          <small className="ms-rise">{j.m}月の満月の物語</small>
          <h3 className="ms-rise">{story.tale?.tagline ?? story.gloss}</h3>
          {(story.tale?.lines ?? [story.meaning]).map((t, i) => (
            <p key={i} className="ms-tale-line">
              {t}
            </p>
          ))}
        </section>
      )}

      {/* 3. 今夜の情報（11/20 渡辺さん「物語の最後には情報も」）：イベントの説明と同じカード。 */}
      <section className="ms-chapter ms-info" ref={infoRef}>
        <small className="ms-rise">
          {j.m}月{j.d}日
        </small>
        <h3 className="ms-rise">今夜の{title}</h3>
        <div className="ms-rise ms-card">
          <EventMomentCard event={event} stage={stage} />
        </div>
        <div className="ms-rise ms-card">
          <EventNightCard
            event={event}
            stage={stage}
            store={store}
            tag="moon-story"
          />
        </div>
        {tags.length > 0 && (
          <p className="fm-tags ms-rise">
            {tags.map((t) => (
              <em key={t}>{t}</em>
            ))}
          </p>
        )}
      </section>

      {/* 5. 知識：名前の由来・自然との関係（11/20 20:56 渡辺さんの見本）：古い紙のページ、角を内に丸く切った金の二重の枠、
          見出しの下に小枝の線、最初の字を大きく、象徴の言葉は小さな絵と並べ、ページの下に淡いセピアの絵（場面ごと）。 */}
      {story &&
        (
          [
            ["名前の由来", story.origin, false],
            ["自然との関係", story.nature, true],
          ] as const
        ).map(([head, paras, last]) => (
          <section key={head} className="ms-chapter ms-text">
            {/* 紙のページ（11/20 21:14 渡辺さん：四隅は角の丸い枠と唐草にそろえる）。見出しまわりはページごと：
                名前の由来は上に月の満ち欠けと菱形の飾り、自然との関係は小枝の線と象徴の言葉の札。 */}
            <div
              className={[
                "ms-paper",
                "origin",
                last ? "nature" : "",
                scene?.PaperArt ? "with-art" : "",
                "ms-rise",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {["tl", "tr", "bl", "br"].map((c) => (
                <PaperCorner key={c} className={`ms-paper-corner ${c}`} />
              ))}
              {!last && (
                <PhaseRow
                  moon={storyAsset("common", "emboss")}
                  className="ms-phases"
                />
              )}
              <h3>{head}</h3>
              {last ? <LeafRule className="ms-leafrule" /> : <Flourish />}
              {paras.map((t, i) => (
                <p key={i} className={i === 0 ? "lead" : undefined}>
                  {t}
                </p>
              ))}
              {last && (
                <p className="ms-symbols">
                  {story.symbols.map((w) => (
                    <em key={w}>
                      <SymbolIcon word={w} className="ms-symbol-icon" />
                      {w}
                    </em>
                  ))}
                </p>
              )}
              {scene?.PaperArt && (
                <span className="ms-paper-art">
                  <scene.PaperArt kind={last ? "nature" : "origin"} />
                </span>
              )}
            </div>
          </section>
        ))}

      {/* 5. 本棚（一年を巡る満月の物語）と、終わり */}
      <section className="ms-chapter ms-tonight">
        {/* 本棚（11/20 18:19 渡辺さんの見本）：木目の棚、上に飾り板。革の背に、型押しの月・紋・名前・日付・山並み・金の帯。 */}
        <div className="ms-case ms-rise">
          <div className="ms-crest">
            <CloudMark className="ms-crest-cloud" />
            <small>Weather Note</small>
            <h3>満月の物語の本棚</h3>
            <span className="ms-crest-sub">
              <Sprig className="ms-sprig" />
              The Full Moon Stories
              <Sprig className="ms-sprig" flip />
            </span>
          </div>
          <div className="ms-shelf" role="list" aria-label="満月の物語の本棚">
            {shelf.books.map((bk, i) => (
              <div
                key={bk.name}
                role="listitem"
                className={bk.reading ? "ms-slot reading" : "ms-slot"}
              >
                {bk.reading ? (
                  <span
                    className="ms-spine-gap"
                    aria-label={`${bk.name}（いま読んでいる本）`}
                  />
                ) : (
                  <button
                    type="button"
                    className={bk.next ? "ms-spine next" : "ms-spine"}
                    style={spineVar(i)}
                    disabled={!bk.at || !onNext}
                    onClick={(e) => pull(e, bk)}
                    aria-label={
                      bk.at
                        ? `${bk.name}の物語を開く（${jst(bk.at).m}/${jst(bk.at).d}）${bk.next ? "、次の満月" : ""}`
                        : `${bk.name}（5年以内に無し）`
                    }
                  >
                    <span className="sp-band" aria-hidden />
                    {/* 背（11/20 19:52 渡辺さんの見本の背）：型押しの月、英語の呼び名、日本語の呼び名、紋、日付、山並み。 */}
                    <img
                      className="sp-moon art"
                      src={
                        STORY_SCENES[bk.name]?.spineArt?.moon ??
                        storyAsset("common", "emboss")
                      }
                      alt=""
                    />
                    <SpineLatin className="sp-latin" lines={bk.en.split(" ")} />
                    <span className="sp-rule" aria-hidden />
                    {/* 日本語の呼び名（11/20 20:09 渡辺さん「ストロベリ／ーと分かれる。コーンムーンなど短いものは一行に」）：
                        7字までは一列。長いものは「〇〇／ムーン」の二列で、語の途中では折らない。 */}
                    <b className={bk.name.length > 7 ? "two" : undefined}>
                      {bk.name.length > 7 && bk.name.endsWith("ムーン") ? (
                        <>
                          <span>{bk.name.slice(0, -3)}</span>
                          <span>ムーン</span>
                        </>
                      ) : (
                        <span>{bk.name}</span>
                      )}
                    </b>
                    {STORY_SCENES[bk.name]?.spineArt ? (
                      <img
                        className="sp-emblem art"
                        src={STORY_SCENES[bk.name]!.spineArt!.emblem}
                        alt=""
                      />
                    ) : (
                      <MoonEmblem name={bk.name} className="sp-emblem" />
                    )}
                    {bk.at && (
                      <small>
                        {jst(bk.at).m}/{jst(bk.at).d}
                      </small>
                    )}
                    <SpineHills className="sp-hills" />
                    <span className="sp-band" aria-hidden />
                    {bk.next && <span className="sp-ribbon" aria-hidden />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        {next && (
          <p className="ms-shelf-hint ms-rise">
            次の満月は {jst(next.at).m}/{jst(next.at).d}
            。背を押すと、その本を取り出して開きます。
          </p>
        )}
        <div className="ms-end ms-rise">
          {onList && (
            <Button size="sm" onClick={onList}>
              この年の満月の一覧
              <Glyph name="next" />
            </Button>
          )}
          <Button size="sm" kind="quiet" onClick={onClose}>
            閉じる
          </Button>
        </div>
        <small className="ms-note">
          名前は主に北米の季節に基づく文化的な呼び名で、日本の季節とは必ずしも一致しません。絵や動きは文化的なイメージで、実際の月の色や明るさ・見え方とは別です。時刻と見え方は
          {WHERE}で計算しています。
        </small>
      </section>
    </div>
  );
}
