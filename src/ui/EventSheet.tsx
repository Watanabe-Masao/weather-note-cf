// 空のイベントの説明（2026-11-20 渡辺さん「その時だけはロゴをタップするとモーダル、詳細な説明文。今年だけの情報系は
// この専用モーダルに」）：満月なら呼び名・時刻・紹介と、その年だけのこと（計算から）、呼び名のページへ。日食・月食なら
// 種類・時刻（欠け始め〜終わり・最大）・欠ける割合、見え方の注意。観測地は高知。
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { clockOf } from "../../shared/dayParts";
import { BLUE_MOON, fullMoonInfo } from "../../shared/fullMoonNames";
import { fullMoonsOfYear } from "../../shared/moon";
import { SKY_EVENT_NAME, type SkyEvent } from "../../shared/skyEvents";
import { DEFAULT_LAT_LON } from "../../shared/sunTimes";
import { factTags, FullMoonSheet } from "./FullMoonSheet";
import { ModalSheet } from "./ModalSheet";
import { Button, Glyph } from "./kit";

const WHERE = "高知";
const clock = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${clockOf(d.getUTCHours() * 60 + d.getUTCMinutes())}`;
};

export function EventSheet({ event, onClose }: { event: SkyEvent; onClose: () => void }) {
  const { lat, lon } = DEFAULT_LAT_LON;
  const [names, setNames] = useState(false);
  const solar = event.kind.startsWith("solar");
  const year = new Date(event.at + 9 * 3_600_000).getUTCFullYear();
  // その年だけのこと（その満月の札）：月食・ブルームーン・いちばん近い／遠い（計算から）。
  const facts = useMemo(() => (solar ? null : (fullMoonsOfYear(year, lat, lon).find((f) => Math.abs(f.at - event.at) < 2 * 86_400_000) ?? null)), [solar, year, lat, lon, event.at]);
  const info = event.name ? fullMoonInfo(event.name) : null;
  const title = event.kind === "full" ? (event.blue ? "今日はブルームーン" : `今日は${event.name}`) : `今日は${SKY_EVENT_NAME[event.kind]}`;
  return (
    <ModalSheet title={title} onClose={onClose} className="event-sheet" size="fit">
      {event.kind === "full" ? (
        <>
          <p className="event-when">満月 {clock(event.at)}（日本時間）</p>
          {event.blue && <p className="event-lead">{BLUE_MOON.short}{event.name ? `（月の呼び名は${event.name}）` : ""}</p>}
          {info && <p className="event-lead">{info.short}</p>}
          {info && <p className="event-gloss">{info.en}　{info.gloss}</p>}
        </>
      ) : (
        <>
          <p className="event-when">
            {event.span ? `${clock(event.span.from)} 〜 ${clock(event.span.to)}` : ""}・最大 {clock(event.at)}
            {event.obscuration != null && event.obscuration > 0 ? `（欠ける割合 ${Math.round(event.obscuration * 100)}%）` : ""}
          </p>
          <p className="event-lead">
            {solar
              ? `${WHERE}から見える${SKY_EVENT_NAME[event.kind]}です（最大のとき太陽が地平線の上）。`
              : `${WHERE}から見える${SKY_EVENT_NAME[event.kind]}です（最大のとき月が地平線の上）。${event.name ? `この満月は${event.name}。` : ""}`}
          </p>
          {solar && <p className="event-warn">太陽を直接見たり、カメラや双眼鏡で見たりしないでください。日食グラスなど専用の道具を使います。</p>}
          {event.kind === "lunar-total" && <p className="event-gloss">皆既のあいだ、地球の大気を通って曲がった赤い光が月に届き、月が赤銅色に見えることがあります。</p>}
        </>
      )}
      {facts && factTags(facts, WHERE).length > 0 && (
        <p className="fm-tags event-tags">
          {factTags(facts, WHERE).map((t) => (
            <em key={t}>{t}</em>
          ))}
        </p>
      )}
      {!solar && (
        <Button size="sm" className="fm-open-btn" onClick={() => setNames(true)}>
          {event.name ? `${event.name}の由来と、この年の満月` : "満月の呼び名"}
          <Glyph name="next" />
        </Button>
      )}
      <small className="set-help">時刻と見えるかどうかは{WHERE}で計算しています（天気は考えていません）。</small>
      {names && createPortal(<FullMoonSheet at={event.at} lat={lat} lon={lon} where={WHERE} onClose={() => setNames(false)} />, document.body)}
    </ModalSheet>
  );
}
