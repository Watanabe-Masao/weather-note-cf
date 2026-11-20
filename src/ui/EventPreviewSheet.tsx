// イベントの見出しの確かめ（2026-11-20、docs/event-banner.md 5章）：管理者だけ。設定から開く。
// ① この日として見出しを表示：日付を選ぶと、見出しだけがその日のイベントになる（src/ui/eventPreview.ts、開き直すと戻る）。
// ② 全部の種類：見出しと同じ物（BrandMark）を、台帳の状態（絵・版／手描き／止めている）と次の日付つきで。押すとその日の説明。
// ③ これからの1年：イベントの日と、出る帯（絵か手描きか）。押すとその日として見出しに出す。
// 見えるのはいまのテーマ。3つを見るには 設定 → 表示 → テーマ を替える。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { addDays, jstToday } from "../../shared/dates";
import { SKY_EVENT_NAME, skyEventsBetween, type SkyEvent } from "../../shared/skyEvents";
import { DEFAULT_LAT_LON } from "../../shared/sunTimes";
import { EVENT_ART, eventArt, eventArtKey, FULL_MOON_ART, type EventArtKey } from "../design/eventAssets";
import { currentTheme } from "../design/tokens";
import { BrandMark } from "./Brand";
import type { WeatherStore } from "../data/store";
import { EventSheet } from "./EventSheet";
import { setPreviewDate, usePreviewDate } from "./eventPreview";
import { Button, InfoNote } from "./kit";
import { ModalSheet } from "./ModalSheet";

/** 「次は」を探す長さ（高知から見える日食は数年に1度なので長めに）。 */
const LOOK_YEARS = 15;
/** シートが開いて描かれてから計算する（開く動きを止めない）。 */
const COMPUTE_AFTER_MS = 50;

const KEYS = Object.keys(EVENT_ART) as EventArtKey[];
const NAME_OF: Record<string, string> = Object.fromEntries(Object.entries(FULL_MOON_ART).map(([name, key]) => [key, name]));

/** 種類の名前（満月は呼び名、ほかは食の名前）。 */
const kindName = (key: EventArtKey) => (key === "blue" ? "ブルームーン" : (NAME_OF[key] ?? SKY_EVENT_NAME[key as SkyEvent["kind"]] ?? key));

/** 起きる日が見つからない種類の、絵を見るためだけのイベント（押しても説明は開かない）。 */
function sampleEvent(key: EventArtKey): SkyEvent {
  if (key in SKY_EVENT_NAME) return { kind: key as SkyEvent["kind"], at: 0, name: null, blue: false, span: null, obscuration: null };
  return { kind: "full", at: 0, name: key === "blue" ? null : NAME_OF[key], blue: key === "blue", span: null, obscuration: null };
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const ymd = (d: string) => `${d.slice(0, 4)}/${md(d)}`;

export function EventPreviewSheet({ onClose, store }: { onClose: () => void; store?: WeatherStore | null }) {
  const theme = currentTheme();
  const today = jstToday();
  const preview = usePreviewDate();
  const [pick, setPick] = useState(preview ?? today);
  const [open, setOpen] = useState<{ event: SkyEvent; day: string } | null>(null);
  // これからのイベント（LOOK_YEARS 年）：開いてから計算する（0.1〜0.5秒）。
  const [upcoming, setUpcoming] = useState<{ date: string; event: SkyEvent }[] | null>(null);
  useEffect(() => {
    const id = window.setTimeout(() => setUpcoming(skyEventsBetween(today, addDays(today, LOOK_YEARS * 366), DEFAULT_LAT_LON.lat, DEFAULT_LAT_LON.lon)), COMPUTE_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [today]);
  const nextOf = (key: EventArtKey) => upcoming?.find((x) => eventArtKey(x.event) === key) ?? null;
  const yearEnd = addDays(today, 365);
  const state = (key: EventArtKey) => {
    const a = EVENT_ART[key];
    return !a ? "手描き（絵がまだ無い）" : a.off ? "手描き（止めている）" : `絵・版 ${a.rev}${a.text === "baked" ? "・文字入り（仮）" : ""}`;
  };
  return (
    <ModalSheet title="イベントの見出しの確かめ" onClose={onClose} className="ev-preview">
      <InfoNote more="テーマは 設定 → 表示 → テーマ で替えて、3つとも見てください。絵が読めないときや台帳に絵が無いときは、アイコンと手描きの帯になります（見出しと同じ）。">
        見出しと同じ大きさで、いまのテーマの帯を並べています。管理者にだけ表示されます。
      </InfoNote>

      <h4 className="ev-h">この日として見出しを表示</h4>
      <div className="ev-day">
        <input type="date" aria-label="見出しに出す日" value={pick} onChange={(e) => e.target.value && setPick(e.target.value)} />
        <Button size="sm" onClick={() => setPreviewDate(pick === today ? null : pick)}>
          見出しに出す
        </Button>
        <Button size="sm" kind="quiet" disabled={!preview} onClick={() => setPreviewDate(null)}>
          元に戻す
        </Button>
      </div>
      <small className="set-help" role="status">
        {preview ? `いまの見出しは ${ymd(preview)} として表示しています（天気やほかの画面は替わりません。アプリを開き直すと戻ります）。` : "いまの見出しは今日のままです。"}
      </small>

      <h4 className="ev-h">これからの1年</h4>
      {!upcoming ? (
        <p className="set-help">計算しています…</p>
      ) : (
        <ul className="ev-year">
          {upcoming
            .filter((x) => x.date <= yearEnd)
            .map(({ date, event }) => {
              const key = eventArtKey(event);
              return (
                <li key={date}>
                  <Button size="sm" kind="quiet" block aria-pressed={preview === date} onClick={() => setPreviewDate(date)}>
                    <span className="ev-date">{ymd(date)}</span>
                    <span className="ev-name">{key ? kindName(key) : SKY_EVENT_NAME[event.kind]}</span>
                    <small>{eventArt(event, theme) ? "絵" : "手描き"}</small>
                  </Button>
                </li>
              );
            })}
        </ul>
      )}

      <h4 className="ev-h">全部の種類</h4>
      <ul className="ev-kinds">
        {KEYS.map((key) => {
          const next = nextOf(key);
          const event = next?.event ?? sampleEvent(key);
          return (
            <li key={key}>
              <div className="brand ev-brand">
                <BrandMark event={event} theme={theme} id={`ev-${key}`} onOpen={next ? () => setOpen({ event: next.event, day: next.date }) : undefined} />
              </div>
              <div className="ev-meta">
                <b>{kindName(key)}</b>
                <small>{state(key)}</small>
                <small>{!upcoming ? "次の日を計算しています…" : next ? `次は ${ymd(next.date)}` : `${LOOK_YEARS}年のうちに高知から見える日なし`}</small>
              </div>
            </li>
          );
        })}
      </ul>
      {open && createPortal(<EventSheet event={open.event} day={open.day} store={store} onClose={() => setOpen(null)} />, document.body)}
    </ModalSheet>
  );
}
