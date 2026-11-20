// 見出しのロゴ（2026-11-18 渡辺さん）：使っているテーマの色のアイコンと、円弧と一点の上に乗った「Weather Note」。
// 絵は src/design/brand.ts（ホーム画面のアイコンと同じ形）。テーマを替えるとアプリが描き直されるので、ここも替わる。
// 空のイベントの日（11/20 渡辺さん）：満月・観測地から見える日食・月食の日だけ、見出しを帯の絵に替える。押すとその日の
// イベントの説明（EventSheet）。絵は台帳（src/design/eventAssets.ts）の絵で、アイコンと文字の場所を合わせた幅に1枚
// （11/20 渡辺さん「左側のロゴもこの期間は無くして広げる」、docs/event-banner.md）。絵が無い・止めている・読めないときは、
// アイコンを残して文字の所だけ手描きの帯（src/design/eventLogo.ts）。前日に開いたときは、翌日の絵を読んでおく。
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { brandIconSvg, type BrandTheme, WORDMARK } from "../design/brand";
import { eventBannerSvg } from "../design/eventLogo";
import { EVENT_ART_SIZE, eventArt } from "../design/eventAssets";
import { currentTheme } from "../design/tokens";
import { addDays, jstToday } from "../../shared/dates";
import { skyEventOn, SKY_EVENT_NAME, type SkyEvent } from "../../shared/skyEvents";
import { DEFAULT_LAT_LON } from "../../shared/sunTimes";
import type { WeatherStore } from "../data/store";
import { EventSheet } from "./EventSheet";
import { usePreviewDate } from "./eventPreview";

export function Brand({ store }: { store?: WeatherStore | null }) {
  const today = jstToday();
  // 「この日として見出しを表示」（確認用、src/ui/eventPreview.ts）：見出しだけその日に。
  const preview = usePreviewDate();
  const day = preview ?? today;
  // 観測地は高知（見出しは観測所を持たないので、太陽と月の既定の地点）。日が替われば計算し直す。
  const event = useMemo(() => skyEventOn(day, DEFAULT_LAT_LON.lat, DEFAULT_LAT_LON.lon), [day]);
  const [open, setOpen] = useState(false);
  const theme = currentTheme();
  // 前日に読んでおく（docs/event-banner.md 7章）：翌日の絵を、開いて少ししてから。当日に電波が弱くても出る。
  useEffect(() => {
    const next = skyEventOn(addDays(today, 1), DEFAULT_LAT_LON.lat, DEFAULT_LAT_LON.lon);
    const a = next ? eventArt(next, theme) : null;
    if (!a) return;
    const id = window.setTimeout(() => {
      new Image().src = a.src;
    }, PREFETCH_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [today, theme]);
  return (
    <h1 className="brand" aria-label="Weather Note">
      <BrandMark event={event} theme={theme} id="wn-head" onOpen={() => setOpen(true)} />
      {open && event && createPortal(<EventSheet event={event} store={store} onClose={() => setOpen(false)} />, document.body)}
    </h1>
  );
}

/**
 * 見出しの中身：ふだんはアイコンと文字。イベントの日は絵の帯（台帳に絵があるとき、アイコンなし）か、アイコンと手描きの帯。
 * 確認ページの一覧（EventPreviewSheet）も、これで見出しと同じ物を描く。id はページの中で重ならない接頭辞。
 */
export function BrandMark({ event, theme, id, onOpen }: { event: SkyEvent | null; theme: BrandTheme; id: string; onOpen?: () => void }) {
  const art = event ? eventArt(event, theme) : null;
  // 読めなかった絵（その URL）。読めなければ手描きの帯に戻る。
  const [failed, setFailed] = useState<string | null>(null);
  const showArt = !!art && failed !== art.src;
  const label = event ? `${event.kind === "full" ? `満月（${event.blue ? "ブルームーン" : event.name}）` : SKY_EVENT_NAME[event.kind]}。押すと説明が開きます` : "";
  const word = (className: string) => (
    <svg className={className} viewBox={WORDMARK.viewBox} aria-hidden>
      <path d={WORDMARK.arc} fill="none" stroke="currentColor" strokeWidth={WORDMARK.stroke} strokeLinecap="round" />
      <circle cx={WORDMARK.dot.cx} cy={WORDMARK.dot.cy} r={WORDMARK.dot.r} fill="currentColor" />
      <path d={WORDMARK.text} fill="currentColor" />
    </svg>
  );
  return (
    <>
      {!showArt && <span className="brand-icon" aria-hidden dangerouslySetInnerHTML={{ __html: brandIconSvg(theme, { rx: 112, id }) }} />}
      {event && art && showArt ? (
        <button type="button" className="brand-art" aria-label={`今日は${label}`} onClick={onOpen}>
          <img src={art.src} alt="" width={EVENT_ART_SIZE.width} height={EVENT_ART_SIZE.height} decoding="async" onError={() => setFailed(art.src)} />
          {art.text === "overlay" && word("brand-art-word")}
        </button>
      ) : event ? (
        <button type="button" className="brand-event" aria-label={`今日は${label}`} onClick={onOpen} dangerouslySetInnerHTML={{ __html: eventBannerSvg(theme, event.kind, event.name, event.blue, `${id}-ev`) }} />
      ) : (
        word("brand-word")
      )}
    </>
  );
}

/** 翌日の絵を読み始めるまで（開いた直後の読み込みの邪魔をしない）。 */
const PREFETCH_DELAY_MS = 3000;
