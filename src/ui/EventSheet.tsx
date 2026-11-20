// 空のイベントの説明（2026-11-20 渡辺さん「その時だけはロゴをタップするとモーダル、詳細な説明文。今年だけの情報系は
// この専用モーダルに」）。11/20 渡辺さん「全然特別感が伝わってきません」：文字だけの説明をやめ、その日の帯の絵を大きく
// 見せる → 瞬間の時刻とあと何時間 → 今夜（その日）の見え方（月の出・いちばん高い・月の入り、または食の始め・最大・終わり）
// と高知の天気 → 呼び名の話と、その年だけのこと → 呼び名のページ、の順にする。観測地は高知（天気も高知の観測所）。
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BLUE_MOON, fullMoonInfo } from "../../shared/fullMoonNames";
import { fullMoonAlias, fullMoonsOfYear, moonTopo } from "../../shared/moon";
import { SKY_EVENT_NAME, type SkyEvent } from "../../shared/skyEvents";
import { DEFAULT_LAT_LON, solarAltitude } from "../../shared/sunTimes";
import type { WeatherStore } from "../data/store";
import { eventArt, EVENT_ART_SIZE, eventIcon, EVENT_ICON_SIZE } from "../design/eventAssets";
import { eventBannerSvg, eventStage } from "../design/eventLogo";
import { currentTheme } from "../design/tokens";
import { EventMomentCard, EventNightCard, stageStyle } from "./EventInfo";
import { factTags, FullMoonSheet } from "./FullMoonSheet";
import { MoonStory } from "./MoonStory";
import { STARS } from "./eventBits";
import { ModalSheet } from "./ModalSheet";
import { Button, Glyph } from "./kit";

const WHERE = "高知";
const HOUR_MS = 3_600_000;

const jst = (ms: number) => {
  const d = new Date(ms + 9 * HOUR_MS);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, wd: "日月火水木金土"[d.getUTCDay()] };
};



/** day：確認ページの一覧から開くときの日付（見出しを「11/24 はビーバームーン」に）。ふだんは「今日は」。 */
export function EventSheet({ event, onClose, day, store }: { event: SkyEvent; onClose: () => void; day?: string; store?: WeatherStore | null }) {
  const { lat, lon } = DEFAULT_LAT_LON;
  const [names, setNames] = useState(false);
  // 満月の物語（全画面のスクロール、11/20）。
  const [story, setStory] = useState<number | null>(null);
  const solar = event.kind.startsWith("solar");
  const full = event.kind === "full";
  const date = jst(event.at).date;
  const year = Number(date.slice(0, 4));
  // その年だけのこと（その満月の札）：月食・ブルームーン・いちばん近い／遠い（計算から）。
  const facts = useMemo(() => (solar ? null : (fullMoonsOfYear(year, lat, lon).find((f) => Math.abs(f.at - event.at) < 2 * 86_400_000) ?? null)), [solar, year, lat, lon, event.at]);
  const info = event.name ? fullMoonInfo(event.name) : null;
  const what = event.kind === "full" ? (event.blue ? "ブルームーン" : event.name) : SKY_EVENT_NAME[event.kind];
  // 見出しは日付だけ（名前は下の主役で大きく）。
  const title = day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8))} の空` : "今日の空";
  const kicker = full ? `${Number(date.slice(5, 7))}月の満月${event.blue ? "（ひと月に2回目）" : ""}` : solar ? "日食" : "月食";
  // 舞台の色：紺は夜空、白と緑はそのテーマの地（14:24 渡辺さん「ダークにはいいですが、こっちには向きませんね」）。
  const stage = eventStage(event.kind, event.blue, currentTheme());
  const peakAlt = solar ? solarAltitude(date, jst(event.at).min, lat, lon) : moonTopo(event.at, lat, lon).altitude;

  return (
    <ModalSheet title={title} onClose={onClose} className="event-sheet" size="fit">
      {/* 舞台（11/20 渡辺さん「もっともっと演出を特別感を」）：テーマによらず夜空の舞台。瞬く星と、ときどき流れ星。
          文字の無い四角い絵がせり上がり、月の光がゆっくり脈打つ。名前はあとから浮かび上がる。瞬間までの秒読み（24時間を
          切ったら秒まで）。動きを減らす設定では動かさない。 */}
      <div className={stage.dark ? "event-stage" : "event-stage light"} style={stageStyle(stage, false)}>
        <span className="event-stars" aria-hidden>
          {STARS.map(([x, y, r, d], i) => (
            <i key={i} style={{ left: `${x}%`, top: `${y}%`, width: r, height: r, animationDelay: `${d}s` }} />
          ))}
          <b className="event-shoot" />
        </span>
        <div className="event-stage-pic">
          <EventPicture event={event} />
          <span className="event-glow" aria-hidden />
        </div>
        <div className="event-stage-text">
          <small>{kicker}</small>
          <b>{what}</b>
          {full && (info?.en ?? (event.blue ? BLUE_MOON.en : null)) && <span>{info?.en ?? BLUE_MOON.en}</span>}
          {full && !event.blue && fullMoonAlias(event.name, event.at) && <span>別名 {fullMoonAlias(event.name, event.at)}</span>}
        </div>
        <EventMomentCard event={event} stage={stage} />
      </div>

      {/* 物語（11/20 渡辺さん「ここの工夫」）：呼び名の紹介を引用のように、象徴の札を添えて。食はその説明と注意。 */}
      <div className="event-story">
        {full ? (
          <>
            {event.blue && <p>{BLUE_MOON.short}{event.name ? `（月の呼び名は${event.name}）` : ""}</p>}
            {info && <p>{info.short}</p>}
            {info && (
              <p className="event-symbols">
                {info.symbols.map((s) => (
                  <em key={s}>{s}</em>
                ))}
              </p>
            )}
          </>
        ) : (
          <>
            <p>
              {solar
                ? `${WHERE}から見える${SKY_EVENT_NAME[event.kind]}です。いちばん深いとき、太陽は地平線の上 ${Math.round(peakAlt)}° にあります。`
                : `${WHERE}から見える${SKY_EVENT_NAME[event.kind]}です。いちばん深いとき、月は地平線の上 ${Math.round(peakAlt)}° にあります。${event.name ? `この満月は${event.name}。` : ""}`}
              {event.obscuration != null && event.obscuration > 0 ? `欠ける割合は ${Math.round(event.obscuration * 100)}%。` : ""}
            </p>
            {event.kind === "lunar-total" && <p>皆既のあいだ、地球の大気を通って曲がった赤い光が月に届き、月が赤銅色に見えることがあります。</p>}
          </>
        )}
      </div>
      {solar && <p className="event-warn">太陽を直接見たり、カメラや双眼鏡で見たりしないでください。日食グラスなど専用の道具を使います。</p>}

      <EventNightCard event={event} stage={stage} store={store} tag="event-sheet" />

      {facts && factTags(facts, WHERE).length > 0 && (
        <p className="fm-tags event-tags">
          {factTags(facts, WHERE).map((t) => (
            <em key={t}>{t}</em>
          ))}
        </p>
      )}
      {!solar && (
        <Button size="sm" className="fm-open-btn" onClick={() => setStory(event.at)}>
          {event.blue ? "ブルームーンの物語" : event.name ? `${event.name}の物語` : "満月の物語"}
          <Glyph name="next" />
        </Button>
      )}
      <small className="set-help">時刻と見え方は{WHERE}で計算しています。天気は{WHERE}の観測所の記録・予報です。</small>
      {story != null && createPortal(<MoonStory key={story} at={story} store={store} onClose={() => setStory(null)} onNext={setStory} onList={() => { setStory(null); setNames(true); }} />, document.body)}
      {names && createPortal(<FullMoonSheet at={event.at} lat={lat} lon={lon} where={WHERE} onClose={() => setNames(false)} />, document.body)}
    </ModalSheet>
  );
}

/**
 * 主役の四角い絵：台帳の四角い絵（文字なし）。無ければ帯の絵の左（天体と主役のある所）を四角く切り出す。それも読めなければ
 * 手描きの帯の左を切り出す。どれも文字は見せない。
 */
function EventPicture({ event }: { event: SkyEvent }) {
  const theme = currentTheme();
  const icon = eventIcon(event);
  const art = eventArt(event, theme);
  const [failed, setFailed] = useState<string | null>(null);
  if (icon && failed !== icon) return <img className="event-pic" src={icon} alt="" width={EVENT_ICON_SIZE} height={EVENT_ICON_SIZE} onError={() => setFailed(icon)} />;
  if (art && failed !== art.src)
    return (
      <span className="event-pic crop">
        <img src={art.src} alt="" width={EVENT_ART_SIZE.width} height={EVENT_ART_SIZE.height} onError={() => setFailed(art.src)} />
      </span>
    );
  return <span className="event-pic crop hand" aria-hidden dangerouslySetInnerHTML={{ __html: eventBannerSvg(theme, event.kind, event.name, event.blue, "ev-pic") }} />;
}

