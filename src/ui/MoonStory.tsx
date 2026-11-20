// 満月の物語（2026-11-20 渡辺さん「GSAP + ScrollTrigger Apple風の複雑なスクロール演出」、全画面のページ）：
// 一つの満月を、スクロールで章ごとに見せる。流れは渡辺さんの資料「満月の物語」の考え（情景 → 自然の営み →
// 名前の由来 → 月に込められた意味）に沿い、知識はそのあとに正確に添える。
//   1. 幕開け：四角い絵が小さく現れ、スクロールで画面いっぱいに広がり、その上に名前が浮かぶ（画面に留めたまま）。
//   2. 季節の物語：ひと言（例：冬が来る前に、小さな枝を一本ずつ）と、物語の一段落ずつが、スクロールで明るくなる。
//   3. 瞬間：満月になる時刻と秒読み。
//   4. この年だけのこと：月食・ブルームーン・いちばん近い／遠い・見かけの大きさ（計算から、shared/moon.ts）。
//   5. 知識：名前の由来・自然との関係（段落が浮かび上がる。背景の絵はゆっくり動く）。
//   6. その夜の月：通り道（EventPath）と天気。最後に、次の満月の物語へ（一年を巡る13の物語）と、この年の一覧へ。
// 文は毎年使える部分だけ（shared/fullMoonNames.ts）、その年だけのことは計算から（11/20 渡辺さんの決まり）。
// 絵と動きは文化的なイメージで、実際の月の色や見え方とは別（ページの終わりに断る）。
// GSAP と ScrollTrigger は、このページを開いたときだけ読み込む（動的 import）。動きを減らす設定では動かさず、
// 全部を最初から見せる。テーマによらず夜の色（映画のような全画面）。
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { addDays } from "../../shared/dates";
import { clockOf } from "../../shared/dayParts";
import { BLUE_MOON, fullMoonInfo, type FullMoonNameInfo } from "../../shared/fullMoonNames";
import { dms, fullMoonName, fullMoonsOfYear, MOON_MEAN_DIAMETER } from "../../shared/moon";
import { skyEventOn, SKY_EVENT_NAME, type SkyEvent } from "../../shared/skyEvents";
import { DEFAULT_LAT_LON } from "../../shared/sunTimes";
import type { WeatherStore } from "../data/store";
import { Priority } from "../data/plan";
import { eventArt, eventIcon } from "../design/eventAssets";
import { eventStage } from "../design/eventLogo";
import { bookVars, Flourish, GoldFrame, Medallion } from "../design/story/Book";
import { STORY_SCENES } from "../design/story/scenes";
import { onSkyVars } from "../design/tokens";
import { EventPath, pathDays } from "./EventPath";
import { countdown, STARS } from "./eventBits";
import { CloseIcon } from "./icons";
import { Button, Glyph, IconButton } from "./kit";

const WHERE = "高知";
const STATION = "47893";
const HOUR_MS = 3_600_000;
/** 秒読みを描き直す間。 */
const TICK_MS = 1000;
const jst = (ms: number) => {
  const d = new Date(ms + 9 * HOUR_MS);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: "日月火水木金土"[d.getUTCDay()] };
};

export function MoonStory({ at, store, onClose, onList, onNext }: { at: number; store?: WeatherStore | null; onClose: () => void; onList?: () => void; onNext?: (at: number) => void }) {
  const { lat, lon } = DEFAULT_LAT_LON;
  const root = useRef<HTMLDivElement>(null);
  const j = jst(at);
  // その満月のイベント（食の日は食、ふだんは満月）と呼び名・説明。
  const event: SkyEvent = useMemo(() => {
    const e = skyEventOn(j.date, lat, lon);
    if (e && Math.abs(e.at - at) < 2 * 86_400_000) return e;
    const n = fullMoonName(at);
    return { kind: "full", at, name: n.name, blue: n.blue, span: null, obscuration: null };
  }, [at, j.date, lat, lon]);
  const info: FullMoonNameInfo | null = event.name ? fullMoonInfo(event.name) : null;
  const story = event.blue ? { ...BLUE_MOON, short: BLUE_MOON.short } : info;
  const title = event.blue ? "ブルームーン" : (event.name ?? "満月");
  const facts = useMemo(() => fullMoonsOfYear(Number(j.date.slice(0, 4)), lat, lon).find((f) => Math.abs(f.at - at) < 2 * 86_400_000) ?? null, [j.date, lat, lon, at]);
  const stage = eventStage(event.kind, event.blue, "navy");
  const pic = eventIcon(event) ?? eventArt(event, "navy")?.src ?? null;
  const wide = !eventIcon(event);
  // 絵本の場面（一文が一コマ）。場面の無い満月は、本の表紙と文だけ。
  const lines = story?.tale?.lines ?? [];
  const scene = !event.blue && event.name && lines.length ? (STORY_SCENES[event.name] ?? null) : null;
  const World = scene?.World;
  // 次の満月（一年を巡る物語）。
  const next = useMemo(() => {
    const y = Number(j.date.slice(0, 4));
    return [...fullMoonsOfYear(y, lat, lon), ...fullMoonsOfYear(y + 1, lat, lon)].find((f) => f.at > at + 86_400_000) ?? null;
  }, [j.date, lat, lon, at]);

  // 秒読み。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // その夜の天気（通り道の描き分け）：その晩と翌日。
  const nightDate = jst(at - 12 * HOUR_MS).date;
  useEffect(() => {
    if (!store) return;
    store.wantHours(STATION, pathDays(nightDate), Priority.Visible, "moon-story");
    return () => store.wantHours(STATION, [], Priority.Visible, "moon-story");
  }, [store, nightDate]);
  const rows = store?.getHours(STATION, nightDate).rows ?? [];
  const nextRows = store?.getHours(STATION, addDays(nightDate, 1)).rows ?? [];

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
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let mm: { revert: () => void } | null = null;
    let live = true;
    void (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
      if (!live) return;
      gsap.registerPlugin(ScrollTrigger);
      const media = gsap.matchMedia(el);
      mm = media;
      // 動きを減らす設定：場面は動かさず、月が昇ったあとの一枚の絵として見せる（文はその下に全部）。
      media.add("(prefers-reduced-motion: reduce)", () => {
        if (!scene) return;
        const tl = gsap.timeline({ paused: true });
        scene.build(gsap as never, el, tl as never, () => ".ms-none", false);
        tl.progress((scene.beats - 1.5) / scene.beats);
      });
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const scroller = el;
        const scrub = (trigger: string) => ({ trigger: el.querySelector(trigger), scroller, start: "top top", end: "bottom bottom", scrub: 0.6 });
        // 1. 本：表紙が開き、紙のページ（ひと言）が見え、そのページの中へ入っていく（紙の色で次の場面へつなぐ）。
        const book = gsap.timeline({ scrollTrigger: scrub(".ms-book") });
        book
          .to(".ms-book-hint", { opacity: 0, duration: 0.1 }, 0)
          .fromTo(".bk-cover", { rotateY: 0 }, { rotateY: -168, ease: "power1.inOut", duration: 1 }, 0.05)
          .fromTo(".bk", { xPercent: 0, rotateX: 8 }, { xPercent: 14, rotateX: 0, ease: "power1.inOut", duration: 1 }, 0.05)
          .fromTo(".bk-page-text > *", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.25, stagger: 0.08 }, 0.7)
          .to(".bk", { scale: 7, xPercent: 0, yPercent: 6, ease: "power2.in", duration: 0.9 }, 1.35)
          .to(".ms-book-dive", { opacity: 1, duration: 0.35 }, 1.85);
        // 表紙のメダルの光が脈打つ（本が画面にある間だけ）。
        const glow = gsap.to(".bk-medal-glow", { opacity: 0.85, duration: 2.6, yoyo: true, repeat: -1, ease: "sine.inOut", paused: true });
        ScrollTrigger.create({ trigger: el.querySelector(".ms-book"), scroller, start: "top bottom", end: "bottom top", onToggle: (t) => (t.isActive ? glow.play() : glow.pause()) });
        // 2. 絵本の場面：一文ごとに一コマ（世界の絵が動き、文が浮かぶ）。最初は紙の色から絵が現れる。
        if (scene) {
          const world = gsap.timeline({ scrollTrigger: scrub(".ms-world") });
          world.to(".ms-world-paper", { opacity: 0, duration: 0.35 }, 0);
          const loop = scene.build(gsap as never, el, world as never, (i) => `.ms-cap[data-i="${i}"]`);
          world.fromTo(".ms-world-frame", { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1, duration: 0.5 }, scene.beats - 0.7);
          // 下の点：いまどのコマか。
          world.fromTo(".ms-beat", { opacity: 0.3, scale: 1 }, { opacity: 1, scale: 1.4, duration: 0.15, stagger: { each: 1, yoyo: true, repeat: 1, repeatDelay: 0.65 } }, 0.05);
          world.set({}, {}, scene.beats);
          // 落ち葉や雪は、場面が画面にある間だけ動かす。
          if (loop) ScrollTrigger.create({ trigger: el.querySelector(".ms-world"), scroller, start: "top bottom", end: "bottom top", onToggle: (t) => (t.isActive ? loop.play() : loop.pause()) });
        }
        // 3〜6. 文・札・段落が、ページの上から順に浮かび上がる。
        gsap.utils.toArray<HTMLElement>(".ms-rise, .ms-fact, .ms-tale-line", el).forEach((t) => {
          const at = { trigger: t, scroller, scrub: 0.5 };
          if (t.classList.contains("ms-fact")) gsap.fromTo(t, { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, ease: "back.out(1.6)", scrollTrigger: { ...at, start: "top 90%", end: "top 65%" } });
          else if (t.classList.contains("ms-tale-line")) gsap.fromTo(t, { opacity: 0.14, y: 16 }, { opacity: 1, y: 0, ease: "none", scrollTrigger: { ...at, start: "top 80%", end: "top 48%" } });
          else gsap.fromTo(t, { opacity: 0, y: 48 }, { opacity: 1, y: 0, ease: "none", scrollTrigger: { ...at, start: "top 92%", end: "top 62%" } });
        });
      });
      // 明朝の字が読み込まれると高さが変わるので、測り直す。
      void document.fonts?.ready.then(() => live && ScrollTrigger.refresh());
      setReady(true);
    })();
    return () => {
      live = false;
      mm?.revert();
    };
  }, [scene]);

  const pct = facts ? Math.round((facts.diameter / MOON_MEAN_DIAMETER - 1) * 1000) / 10 : null;
  const style = { ...(onSkyVars() as CSSProperties), ...bookVars(), ["--beats" as string]: scene?.beats ?? 0, ["--ev-glow" as string]: stage.glow, ["--ev-line" as string]: stage.line, ["--ev-star" as string]: stage.star } as CSSProperties;

  return (
    <div className={ready ? "moon-story ready" : "moon-story"} ref={root} role="dialog" aria-modal="true" aria-label={`${title}の物語`} tabIndex={-1} style={style}>
      <div className="ms-close">
        <IconButton label="閉じる" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      {/* 1. 本：紺の革の表紙（金の枠・満月のメダル・名前）が開き、紙のページにひと言。そのページの中へ入っていく。 */}
      <section className={scene ? "ms-book into-paper" : "ms-book"}>
        <div className="ms-sticky ms-book-stage">
          <span className="event-stars" aria-hidden>
            {STARS.map(([x, y, r, d], i) => (
              <i key={i} style={{ left: `${x}%`, top: `${y}%`, width: r, height: r, animationDelay: `${d}s` }} />
            ))}
            <b className="event-shoot" />
          </span>
          <div className="bk">
            <div className="bk-page">
              <GoldFrame />
              <div className="bk-page-text">
                <small>{j.m}月の満月の物語</small>
                <h3>{story?.tale?.tagline ?? story?.gloss ?? title}</h3>
                <Flourish />
                <span>{title}</span>
              </div>
            </div>
            <div className="bk-cover">
              <div className="bk-front">
                <GoldFrame />
                <small>満月の物語</small>
                <div className="bk-medal">
                  <span className="bk-medal-glow" aria-hidden />
                  {pic && <img src={pic} alt="" className={wide ? "wide" : undefined} />}
                  <Medallion />
                </div>
                <h2>{title}</h2>
                {story && <span className="bk-en">{story.en}</span>}
                <Flourish />
                {story && <p>{story.gloss}</p>}
              </div>
              <div className="bk-back" aria-hidden />
            </div>
            <span className="bk-ribbon" aria-hidden />
          </div>
          <span className="ms-book-dive" aria-hidden />
          <span className="ms-book-hint ms-hero-hint" aria-hidden>
            スクロールでページをひらく
            <Glyph name="down" />
          </span>
        </div>
      </section>

      {/* 2. 絵本の場面：一つの続いた世界を、物語の一文ごとに一コマずつ（情景 → 自然の営み → 名前の由来 → 意味）。 */}
      {scene && World && (
        <section className="ms-world" aria-label={`${title}の物語`}>
          <div className="ms-sticky ms-world-stage">
            <World />
            <span className="ms-world-frame" aria-hidden>
              <GoldFrame w={400} h={860} inset={10} />
            </span>
            <span className="ms-world-paper" aria-hidden />
            <div className="ms-caps">
              {lines.map((t, i) => (
                <p key={i} className="ms-cap" data-i={i}>
                  {t}
                </p>
              ))}
            </div>
            <div className="ms-beats" aria-hidden>
              {lines.map((_, i) => (
                <i key={i} className="ms-beat" />
              ))}
            </div>
          </div>
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

      {/* 3. 瞬間 */}
      <section className="ms-chapter ms-moment">
        <small className="ms-rise">満月になる時刻（日本時間）</small>
        <p className="ms-big ms-rise">
          {j.m}
          <i>月</i>
          {j.d}
          <i>日</i>
          <br />
          {clockOf(j.min)}
        </p>
        <span className="event-count ms-rise" role="timer">
          {countdown(at, now)}
        </span>
        {story && <p className="ms-lead ms-rise">{story.short}</p>}
      </section>

      {/* 4. この年だけのこと（計算から） */}
      {facts && (
        <section className="ms-chapter ms-facts">
          <h3 className="ms-rise">{j.date.slice(0, 4)}年のこの満月</h3>
          <div className="ms-fact-grid">
            <div className="ms-fact">
              <small>見かけの大きさ</small>
              <b>{dms(facts.diameter)}</b>
              <span>平均より {pct != null && pct >= 0 ? `+${pct}` : pct}%</span>
            </div>
            {facts.eclipse && (
              <div className="ms-fact hot">
                <small>{facts.eclipse.kind}</small>
                <b>{clockOf(jst(facts.eclipse.peak).min)}</b>
                <span>{facts.eclipse.visible ? `${WHERE}から見える` : `${WHERE}からは見えない`}</span>
              </div>
            )}
            {facts.blue && (
              <div className="ms-fact">
                <small>ブルームーン</small>
                <b>2回目</b>
                <span>同じ月の2回目の満月</span>
              </div>
            )}
            {facts.nearest && (
              <div className="ms-fact">
                <small>この年いちばん</small>
                <b>近い</b>
                <span>地球にいちばん近い満月</span>
              </div>
            )}
            {facts.farthest && (
              <div className="ms-fact">
                <small>この年いちばん</small>
                <b>遠い</b>
                <span>地球からいちばん遠い満月</span>
              </div>
            )}
          </div>
          {event.kind !== "full" && <p className="ms-lead ms-rise">この夜は{SKY_EVENT_NAME[event.kind]}。{WHERE}から見られます（天気しだい）。</p>}
        </section>
      )}

      {/* 5. 知識：名前の由来 */}
      {story && (
        <section className="ms-chapter ms-text">
          <div className="ms-paper ms-rise">
            <h3>名前の由来</h3>
            <Flourish />
            {story.origin.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
          </div>
        </section>
      )}

      {/* 5. 知識：自然との関係 */}
      {story && (
        <section className="ms-chapter ms-text">
          <div className="ms-paper ms-rise">
            <h3>自然との関係</h3>
            <Flourish />
            {story.nature.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
            <p className="ms-symbols">
              {story.symbols.map((s) => (
                <em key={s}>{s}</em>
              ))}
            </p>
          </div>
        </section>
      )}

      {/* 6. その夜の月と、次の満月 */}
      <section className="ms-chapter ms-tonight">
        <h3 className="ms-rise">
          {Number(nightDate.slice(5, 7))}/{Number(nightDate.slice(8))} の夜の月（{WHERE}）
        </h3>
        <div className="ms-rise ms-path">
          <EventPath event={event} date={nightDate} lat={lat} lon={lon} weather={{ rows: { [nightDate]: rows, [addDays(nightDate, 1)]: nextRows }, station: STATION }} ends={{ from: null, to: null }} />
        </div>
        {next && onNext && (
          <button type="button" className="ms-next ms-rise" onClick={() => onNext(next.at)}>
            <small>次の満月の物語</small>
            <b>
              {jst(next.at).m}/{jst(next.at).d} {next.blue ? "ブルームーン" : next.name}
            </b>
            <Glyph name="next" />
          </button>
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
        <small className="ms-note">名前は主に北米の季節に基づく文化的な呼び名で、日本の季節とは必ずしも一致しません。絵や動きは文化的なイメージで、実際の月の色や明るさ・見え方とは別です。時刻と見え方は{WHERE}で計算しています。</small>
      </section>
    </div>
  );
}
