// 見出しのロゴ（2026-11-18 渡辺さん）：使っているテーマの色のアイコンと、円弧と一点の上に乗った「Weather Note」。
// 絵は src/design/brand.ts（ホーム画面のアイコンと同じ形）。テーマを替えるとアプリが描き直されるので、ここも替わる。
// 空のイベントの日（11/20 渡辺さん）：満月・観測地から見える日食・月食の日だけ、「Weather Note」の文字の所を帯の絵
// （src/design/eventLogo.ts）に替える。アイコンは替えない。押すとその日のイベントの説明（EventSheet）。
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { brandIconSvg, WORDMARK } from "../design/brand";
import { eventBannerSvg } from "../design/eventLogo";
import { currentTheme } from "../design/tokens";
import { jstToday } from "../../shared/dates";
import { skyEventOn, SKY_EVENT_NAME } from "../../shared/skyEvents";
import { DEFAULT_LAT_LON } from "../../shared/sunTimes";
import { EventSheet } from "./EventSheet";

export function Brand() {
  const today = jstToday();
  // 観測地は高知（見出しは観測所を持たないので、太陽と月の既定の地点）。日が替われば計算し直す。
  const event = useMemo(() => skyEventOn(today, DEFAULT_LAT_LON.lat, DEFAULT_LAT_LON.lon), [today]);
  const [open, setOpen] = useState(false);
  const theme = currentTheme();
  return (
    <h1 className="brand" aria-label="Weather Note">
      <span className="brand-icon" aria-hidden dangerouslySetInnerHTML={{ __html: brandIconSvg(theme, { rx: 112, id: "wn-head" }) }} />
      {event ? (
        <button
          type="button"
          className="brand-event"
          aria-label={`今日は${event.kind === "full" ? `満月（${event.blue ? "ブルームーン" : event.name}）` : SKY_EVENT_NAME[event.kind]}。押すと説明が開きます`}
          onClick={() => setOpen(true)}
          dangerouslySetInnerHTML={{ __html: eventBannerSvg(theme, event.kind, event.name, event.blue, "wn-ev") }}
        />
      ) : (
        <svg className="brand-word" viewBox={WORDMARK.viewBox} aria-hidden>
          <path d={WORDMARK.arc} fill="none" stroke="currentColor" strokeWidth={WORDMARK.stroke} strokeLinecap="round" />
          <circle cx={WORDMARK.dot.cx} cy={WORDMARK.dot.cy} r={WORDMARK.dot.r} fill="currentColor" />
          <path d={WORDMARK.text} fill="currentColor" />
        </svg>
      )}
      {open && event && createPortal(<EventSheet event={event} onClose={() => setOpen(false)} />, document.body)}
    </h1>
  );
}
