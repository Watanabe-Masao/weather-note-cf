// 見出しのロゴ（2026-11-18 渡辺さん）：使っているテーマの色のアイコンと、円弧と一点の上に乗った「Weather Note」。
// 絵は src/design/brand.ts（ホーム画面のアイコンと同じ形）。テーマを替えるとアプリが描き直されるので、ここも替わる。
// 空のイベントの日（11/20 渡辺さん）：満月・観測地から見える日食・月食の日だけ、見出しを帯の絵に替える。押すとその日の
// イベントの説明（EventSheet）。絵は台帳（src/design/eventAssets.ts）の絵で、アイコンと文字の場所を合わせた幅に1枚
// （11/20 渡辺さん「左側のロゴもこの期間は無くして広げる」、docs/event-banner.md）。絵が無い・止めている・読めないときは、
// アイコンを残して文字の所だけ手描きの帯（src/design/eventLogo.ts）。前日に開いたときは、翌日の絵を読んでおく。
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { brandIconSvg, type BrandTheme, WORDMARK } from "../design/brand";
import { eventBannerSvg, eventStage } from "../design/eventLogo";
import { EVENT_ART_SIZE, eventArt } from "../design/eventAssets";
import { currentTheme } from "../design/tokens";
import { skyEventOn, skyEventShown, SKY_EVENT_NAME, type SkyEvent, type SkyEventPhase } from "../../shared/skyEvents";
import { DEFAULT_LAT_LON } from "../../shared/sunTimes";
import type { WeatherStore } from "../data/store";
import { EventSheet } from "./EventSheet";
import { usePreviewDate } from "./eventPreview";

export function Brand({ store }: { store?: WeatherStore | null }) {
  const now = Date.now();
  // 「この日として見出しを表示」（確認用、src/ui/eventPreview.ts）：見出しだけその日（の夜）に。
  const preview = usePreviewDate();
  // 出す期間（11/21 渡辺さん「前日＋当日」、shared/skyEvents.ts の skyEventShown）：イベントの夜の前日と当日。夜明け
  // （5時）で日が替わる扱いなので、その単位で計算し直す。観測地は高知（見出しは観測所を持たないので、既定の地点）。
  const span = Math.floor((now + 4 * 3_600_000) / 86_400_000);
  const shown = useMemo(() => {
    const { lat, lon } = DEFAULT_LAT_LON;
    if (!preview) return skyEventShown(now, lat, lon);
    const e = skyEventOn(preview, lat, lon);
    return skyEventShown(Date.parse(`${preview}T20:00:00+09:00`), lat, lon) ?? (e ? { event: e, phase: "tonight" as const } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, span]);
  const event = shown?.event ?? null;
  const phase = shown?.phase ?? "tonight";
  const [open, setOpen] = useState(false);
  const theme = currentTheme();
  // 前日に読んでおく（docs/event-banner.md 7章）：翌日の絵を、開いて少ししてから。当日に電波が弱くても出る。
  useEffect(() => {
    const next = skyEventShown(Date.now() + 86_400_000, DEFAULT_LAT_LON.lat, DEFAULT_LAT_LON.lon)?.event;
    const a = next && next.at !== event?.at ? eventArt(next, theme) : null;
    if (!a) return;
    const id = window.setTimeout(() => {
      new Image().src = a.src;
    }, PREFETCH_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [span, theme, event]);
  // 押せると気づかせる印（11/21 渡辺さん「ロゴがクリックできるようにさりげない工夫」）：まだ開いていないイベントには、
  // 右上に小さな金の星（✦）を灯す。一度開けば、そのイベントの間は消える（この端末だけの覚え）。
  const [seen, setSeen] = useState(() => (event ? readSeen() === event.at : true));
  useEffect(() => setSeen(event ? readSeen() === event.at : true), [event]);
  const openSheet = () => {
    setOpen(true);
    if (event) {
      writeSeen(event.at);
      setSeen(true);
    }
  };
  return (
    <h1 className="brand" aria-label="Weather Note">
      <BrandMark event={event} theme={theme} id="wn-head" onOpen={openSheet} fresh={!seen} phase={phase} />
      {open && event && createPortal(<EventSheet event={event} phase={phase} store={store} onClose={() => setOpen(false)} />, document.body)}
    </h1>
  );
}

/**
 * 見出しの中身：ふだんはアイコンと文字。イベントの日は絵の帯（台帳に絵があるとき、アイコンなし）か、アイコンと手描きの帯。
 * 確認ページの一覧（EventPreviewSheet）も、これで見出しと同じ物を描く。id はページの中で重ならない接頭辞。
 */
export function BrandMark({ event, theme, id, onOpen, fresh = false, phase = "tonight" }: { event: SkyEvent | null; theme: BrandTheme; id: string; onOpen?: () => void; fresh?: boolean; phase?: SkyEventPhase }) {
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
  const when = phase === "eve" ? (event?.kind.startsWith("solar") ? "明日は" : "明日の夜は") : "今日は";
  // 月の呼吸（11/21）：絵の月のあたりが数秒に一度ふわっと明るむ。光の色はイベントの舞台と同じ（eventStage の glow）。
  const glow = event ? ({ ["--brand-glow" as string]: eventStage(event.kind, event.blue, theme).glow } as CSSProperties) : undefined;
  const cls = (base: string) => [base, "brand-tap", fresh ? "fresh" : ""].filter(Boolean).join(" ");
  return (
    <>
      {!showArt && <span className="brand-icon" aria-hidden dangerouslySetInnerHTML={{ __html: brandIconSvg(theme, { rx: 112, id }) }} />}
      {event && art && showArt ? (
        <button type="button" className={cls("brand-art")} style={glow} aria-label={`${when}${label}`} onClick={onOpen}>
          <img src={art.src} alt="" width={EVENT_ART_SIZE.width} height={EVENT_ART_SIZE.height} decoding="async" onError={() => setFailed(art.src)} />
          {art.text === "overlay" && word("brand-art-word")}
          <span className="brand-star" aria-hidden />
        </button>
      ) : event ? (
        <button type="button" className={cls("brand-event")} style={glow} aria-label={`${when}${label}`} onClick={onOpen}>
          <span className="brand-event-art" aria-hidden dangerouslySetInnerHTML={{ __html: eventBannerSvg(theme, event.kind, event.name, event.blue, `${id}-ev`) }} />
          <span className="brand-star" aria-hidden />
        </button>
      ) : (
        word("brand-word")
      )}
    </>
  );
}

/** 翌日の絵を読み始めるまで（開いた直後の読み込みの邪魔をしない）。 */
const PREFETCH_DELAY_MS = 3000;

/** 開いたイベントの覚え（満月の瞬間の時刻）。読めない・書けない端末では、毎回星を出すだけ。 */
const SEEN_KEY = "wn-event-seen";
function readSeen(): number | null {
  try {
    const v = Number(localStorage.getItem(SEEN_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeSeen(at: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    /* 覚えられなくても動く */
  }
}
