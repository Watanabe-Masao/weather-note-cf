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

  // スクロールの演出（GSAP + ScrollTrigger、このページを開いたときだけ読み込む）。
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReady(true);
      return;
    }
    let ctx: { revert: () => void } | null = null;
    let live = true;
    void (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
      if (!live) return;
      gsap.registerPlugin(ScrollTrigger);
      ctx = gsap.context(() => {
        const scroller = el;
        const scrub = (trigger: string, start = "top top", end = "bottom bottom") => ({ trigger: el.querySelector(trigger), scroller, start, end, scrub: 0.6 });
        // 1. 幕開け：絵が画面いっぱいに広がり、暗くなって名前が浮かぶ。
        const fill = Math.max(el.clientWidth, el.clientHeight) / 150;
        const hero = gsap.timeline({ scrollTrigger: scrub(".ms-hero") });
        hero
          .fromTo(".ms-hero-pic", { scale: 1, borderRadius: "22%" }, { scale: fill, borderRadius: "0%", ease: "power2.in", duration: 1 })
          .to(".ms-hero-veil", { opacity: 0.55, duration: 0.5 }, 0.55)
          .fromTo(".ms-hero-title", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.4 }, 0.6)
          .to(".ms-hero-hint", { opacity: 0, duration: 0.15 }, 0);
        // 2〜4・7. 文と札が一つずつ浮かび上がる。
        gsap.utils.toArray<HTMLElement>(".ms-rise", el).forEach((t) => {
          gsap.fromTo(t, { opacity: 0, y: 48 }, { opacity: 1, y: 0, ease: "none", scrollTrigger: { trigger: t, scroller, start: "top 92%", end: "top 62%", scrub: 0.5 } });
        });
        // 背景の絵がゆっくり動く（奥行き）。
        gsap.utils.toArray<HTMLElement>(".ms-parallax", el).forEach((b) => {
          gsap.fromTo(b, { yPercent: -12, scale: 1.25 }, { yPercent: 12, scale: 1.1, ease: "none", scrollTrigger: { trigger: b.parentElement, scroller, start: "top bottom", end: "bottom top", scrub: true } });
        });
        // 5. 数字の札が少しずつ大きく。
        gsap.utils.toArray<HTMLElement>(".ms-fact", el).forEach((f, i) => {
          gsap.fromTo(f, { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, ease: "back.out(1.6)", scrollTrigger: { trigger: f, scroller, start: "top 90%", end: "top 65%", scrub: 0.5 }, delay: i * 0.05 });
        });
        // 2. 季節の物語：一段落ずつ、画面の真ん中に来ると明るくなる（Apple の文の演出）。
        gsap.utils.toArray<HTMLElement>(".ms-tale-line", el).forEach((t) => {
          gsap.fromTo(t, { opacity: 0.14, y: 16 }, { opacity: 1, y: 0, ease: "none", scrollTrigger: { trigger: t, scroller, start: "top 80%", end: "top 48%", scrub: 0.5 } });
        });
        // 満月の光が脈打つ（幕開けの絵）。
        gsap.to(".ms-hero-glow", { opacity: 0.75, duration: 2.6, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }, el);
      setReady(true);
    })();
    return () => {
      live = false;
      ctx?.revert();
    };
  }, []);

  const pct = facts ? Math.round((facts.diameter / MOON_MEAN_DIAMETER - 1) * 1000) / 10 : null;
  const style = { ...(onSkyVars() as CSSProperties), ["--ev-glow" as string]: stage.glow, ["--ev-line" as string]: stage.line, ["--ev-star" as string]: stage.star } as CSSProperties;

  return (
    <div className={ready ? "moon-story ready" : "moon-story"} ref={root} role="dialog" aria-modal="true" aria-label={`${title}の物語`} tabIndex={-1} style={style}>
      <div className="ms-close">
        <IconButton label="閉じる" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      {/* 1. 幕開け */}
      <section className="ms-hero">
        <div className="ms-sticky">
          <span className="event-stars" aria-hidden>
            {STARS.map(([x, y, r, d], i) => (
              <i key={i} style={{ left: `${x}%`, top: `${y}%`, width: r, height: r, animationDelay: `${d}s` }} />
            ))}
            <b className="event-shoot" />
          </span>
          <div className="ms-hero-pic">
            {pic && <img src={pic} alt="" className={wide ? "wide" : undefined} />}
            <span className="ms-hero-glow" aria-hidden />
          </div>
          <span className="ms-hero-veil" aria-hidden />
          <div className="ms-hero-title">
            <small>{j.m}月の満月</small>
            <h2>{title}</h2>
            {story && <span>{story.en}</span>}
            {story && <p>{story.gloss}</p>}
          </div>
          <span className="ms-hero-hint" aria-hidden>
            スクロール
            <Glyph name="down" />
          </span>
        </div>
      </section>

      {/* 2. 季節の物語（情景 → 自然の営み → 名前の由来 → 月に込められた意味）。物語の無い呼び名は、象徴の文だけ。 */}
      {story && (
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
          {pic && <img className="ms-parallax" src={pic} alt="" aria-hidden />}
          <span className="ms-shade" aria-hidden />
          <h3 className="ms-rise">名前の由来</h3>
          {story.origin.map((t, i) => (
            <p key={i} className="ms-rise">
              {t}
            </p>
          ))}
        </section>
      )}

      {/* 5. 知識：自然との関係 */}
      {story && (
        <section className="ms-chapter ms-text">
          <h3 className="ms-rise">自然との関係</h3>
          {story.nature.map((t, i) => (
            <p key={i} className="ms-rise">
              {t}
            </p>
          ))}
          <p className="ms-symbols ms-rise">
            {story.symbols.map((s) => (
              <em key={s}>{s}</em>
            ))}
          </p>
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
