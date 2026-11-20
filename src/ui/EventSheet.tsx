// 空のイベントの説明（2026-11-20 渡辺さん「その時だけはロゴをタップするとモーダル、詳細な説明文。今年だけの情報系は
// この専用モーダルに」）。11/20 渡辺さん「全然特別感が伝わってきません」：文字だけの説明をやめ、その日の帯の絵を大きく
// 見せる → 瞬間の時刻とあと何時間 → 今夜（その日）の見え方（月の出・いちばん高い・月の入り、または食の始め・最大・終わり）
// と高知の天気 → 呼び名の話と、その年だけのこと → 呼び名のページ、の順にする。観測地は高知（天気も高知の観測所）。
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { addDays } from "../../shared/dates";
import { clockOf } from "../../shared/dayParts";
import { skyHidden } from "../../shared/dayWeather";
import { BLUE_MOON, fullMoonInfo } from "../../shared/fullMoonNames";
import { fullMoonsOfYear, moonTimes, moonTopo } from "../../shared/moon";
import { SKY_EVENT_NAME, type SkyEvent } from "../../shared/skyEvents";
import { DEFAULT_LAT_LON, solarAltitude } from "../../shared/sunTimes";
import type { WeatherStore } from "../data/store";
import { Priority } from "../data/plan";
import { eventArt, EVENT_ART_SIZE, eventIcon, EVENT_ICON_SIZE } from "../design/eventAssets";
import { eventBannerSvg, eventGlow } from "../design/eventLogo";
import { BRAND } from "../design/brand";
import { currentTheme, onSkyVars } from "../design/tokens";
import { dirName } from "./moonParts";
import { factTags, FullMoonSheet } from "./FullMoonSheet";
import { ModalSheet } from "./ModalSheet";
import { Button, Glyph } from "./kit";

const WHERE = "高知";
/** 天気は高知の観測所（時刻と見え方を計算する地点と同じ所）。 */
const STATION = "47893";
const HOUR_MS = 3_600_000;
/** 秒読みを描き直す間（24時間を切ったら秒まで出すので1秒）。 */
const TICK_MS = 1000;
/** 瞬間のあと、「いま、この夜」と出す長さ。 */
const NOW_SPAN_MS = 3 * HOUR_MS;

const jst = (ms: number) => {
  const d = new Date(ms + 9 * HOUR_MS);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, wd: "日月火水木金土"[d.getUTCDay()] };
};

/** 「あと 3日」「あと 11:54:12」（24時間を切ったら秒まで）「いま、この夜」（瞬間から NOW_SPAN_MS まで）「5時間前」。 */
function countdown(at: number, now: number): string {
  const d = at - now;
  const a = Math.abs(d);
  if (d >= 0) {
    if (a >= 24 * HOUR_MS) return `あと ${Math.floor(a / (24 * HOUR_MS))}日`;
    const h = Math.floor(a / HOUR_MS);
    const m = Math.floor((a % HOUR_MS) / 60_000);
    const sec = Math.floor((a % 60_000) / 1000);
    return `あと ${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  if (a < NOW_SPAN_MS) return "いま、この夜";
  return a >= 24 * HOUR_MS ? `${Math.floor(a / (24 * HOUR_MS))}日前` : `${Math.floor(a / HOUR_MS)}時間前`;
}

/** 舞台の星（x%・y%・大きさ px・瞬きの遅れ 秒）。並びは固定（開くたびに替わらない）。 */
const STARS: [number, number, number, number][] = [
  [6, 14, 2, 0],
  [14, 62, 1.5, 1.2],
  [22, 30, 2.5, 2.1],
  [31, 8, 1.5, 0.6],
  [38, 70, 2, 2.8],
  [47, 18, 1.5, 1.6],
  [56, 52, 2, 0.3],
  [63, 10, 2.5, 2.4],
  [71, 38, 1.5, 1],
  [78, 72, 2, 1.9],
  [85, 22, 2, 0.8],
  [92, 56, 1.5, 2.6],
  [96, 8, 2, 1.4],
];

/** day：確認ページの一覧から開くときの日付（見出しを「11/24 はビーバームーン」に）。ふだんは「今日は」。 */
export function EventSheet({ event, onClose, day, store }: { event: SkyEvent; onClose: () => void; day?: string; store?: WeatherStore | null }) {
  const { lat, lon } = DEFAULT_LAT_LON;
  const [names, setNames] = useState(false);
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
  // 秒読み（1秒ごと）。瞬間の前後は札を光らせる。
  const [now, setNow] = useState(() => Date.now());
  const near = Math.abs(event.at - now) < NOW_SPAN_MS;
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // 今夜の月（満月・月食）：その日の月の出から、いちばん高い・月の入り（日をまたげば翌日）。
  const night = useMemo(() => {
    if (solar) return null;
    const t0 = moonTimes(date, lat, lon);
    const t1 = moonTimes(addDays(date, 1), lat, lon);
    const rise = t0.rise ? { at: t0.rise.at, azimuth: t0.rise.azimuth, next: false } : null;
    const after = (m: number | undefined) => (rise ? (m ?? -1) > rise.at : true);
    const high = t0.transit && after(t0.transit.at) ? { ...t0.transit, next: false } : t1.transit ? { ...t1.transit, next: true } : null;
    const set = t0.set && after(t0.set.at) ? { ...t0.set, next: false } : t1.set ? { ...t1.set, next: true } : null;
    return { rise, high, set };
  }, [solar, date, lat, lon]);

  // 見え方の天気（高知の観測所の記録・予報）：満月なら月が出ている夜の時間、食なら食の間。
  useEffect(() => {
    if (!store) return;
    store.wantHours(STATION, [date], Priority.Visible, "event-sheet");
    return () => store.wantHours(STATION, [], Priority.Visible, "event-sheet");
  }, [store, date]);
  const rows = store?.getHours(STATION, date).rows ?? [];
  const sky = useMemo(() => {
    if (!rows.length) return null;
    // 見る時間（その日の JMA の時間 n）：満月は月が地平線の上にある 17〜24時、食はその間。
    const hours: number[] = [];
    if (event.span) {
      for (let t = event.span.from; t <= event.span.to; t += HOUR_MS) if (jst(t).date === date) hours.push(Math.floor(jst(t).min / 60) + 1);
      if (jst(event.at).date === date) hours.push(Math.floor(jst(event.at).min / 60) + 1);
    } else {
      for (let n = 18; n <= 24; n++) {
        const ms = Date.parse(`${date}T00:00:00+09:00`) + (n - 0.5) * HOUR_MS;
        if (moonTopo(ms, lat, lon).altitude > 0) hours.push(n);
      }
    }
    const seen = [...new Set(hours)].map((n) => skyHidden(rows, n, STATION)).filter((x): x is NonNullable<typeof x> => !!x);
    if (!seen.length) return null;
    const hidden = seen.filter((x) => x.hidden).length;
    const verdict = hidden === 0 ? "よく見えそう" : hidden === seen.length ? "雲で見えにくいかも" : "雲の切れ間から見えそう";
    const forecast = rows.some((r) => r.type === "forecast");
    // 同じ天気の続く時間をまとめる：「17〜21時台 晴れ・22〜23時台 くもり」。
    const runs: { from: number; to: number; text: string }[] = [];
    for (const x of [...new Map(seen.map((x) => [x.hour, x])).values()].sort((a, b) => a.hour - b.hour)) {
      const last = runs.at(-1);
      if (last && last.text === x.text && x.hour === last.to + 1) last.to = x.hour;
      else runs.push({ from: x.hour, to: x.hour, text: x.text });
    }
    const text = runs.map((r) => `${r.from - 1}${r.to > r.from ? `〜${r.to - 1}` : ""}時台 ${r.text}`).join("・");
    return { verdict, text, forecast, good: hidden === 0 };
  }, [rows, event.span, event.at, date, lat, lon]);

  const peakAlt = solar ? solarAltitude(date, jst(event.at).min, lat, lon) : moonTopo(event.at, lat, lon).altitude;

  return (
    <ModalSheet title={title} onClose={onClose} className="event-sheet" size="fit">
      {/* 舞台（11/20 渡辺さん「もっともっと演出を特別感を」）：テーマによらず夜空の舞台。瞬く星と、ときどき流れ星。
          文字の無い四角い絵がせり上がり、月の光がゆっくり脈打つ。名前はあとから浮かび上がる。瞬間までの秒読み（24時間を
          切ったら秒まで）。動きを減らす設定では動かさない。 */}
      <div className="event-stage" style={{ ...(onSkyVars() as CSSProperties), background: `linear-gradient(${BRAND.navy.bg[0]}, ${BRAND.navy.bg[1]})`, ["--ev-glow" as string]: eventGlow(event.kind, event.blue) }}>
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
        </div>
        <div className="event-stage-time">
          <small>{full ? "満月の瞬間" : "食がいちばん深くなる時刻"}</small>
          <b>
            {jst(event.at).md}（{jst(event.at).wd}）{clockOf(jst(event.at).min)}
          </b>
          <span className={near ? "event-count now" : "event-count"} role="timer">
            {countdown(event.at, now)}
          </span>
        </div>
      </div>

      {/* 物語（呼び名の短い紹介、または食の説明）。 */}
      {full ? (
        <>
          {event.blue && <p className="event-lead">{BLUE_MOON.short}{event.name ? `（月の呼び名は${event.name}）` : ""}</p>}
          {info && <p className="event-lead">{info.short}</p>}
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
          <p className="event-lead">
            {solar
              ? `${WHERE}から見える${SKY_EVENT_NAME[event.kind]}です。いちばん深いとき、太陽は地平線の上 ${Math.round(peakAlt)}° にあります。`
              : `${WHERE}から見える${SKY_EVENT_NAME[event.kind]}です。いちばん深いとき、月は地平線の上 ${Math.round(peakAlt)}° にあります。${event.name ? `この満月は${event.name}。` : ""}`}
            {event.obscuration != null && event.obscuration > 0 ? `欠ける割合は ${Math.round(event.obscuration * 100)}%。` : ""}
          </p>
          {solar && <p className="event-warn">太陽を直接見たり、カメラや双眼鏡で見たりしないでください。日食グラスなど専用の道具を使います。</p>}
          {event.kind === "lunar-total" && <p className="event-lead">皆既のあいだ、地球の大気を通って曲がった赤い光が月に届き、月が赤銅色に見えることがあります。</p>}
        </>
      )}

      {/* その日の見え方：満月は月の出・いちばん高い・月の入り、食は始め・最大・終わり。 */}
      <h4 className="event-h">{solar ? "その日の見え方" : `${jst(event.at).md} の夜の月（${WHERE}）`}</h4>
      <div className="sun-keys event-keys">
        {event.span ? (
          <>
            <div className="sun-key">
              <small>欠け始め</small>
              <b>{clockOf(jst(event.span.from).min)}</b>
              <small>{jst(event.span.from).md}</small>
            </div>
            <div className="sun-key">
              <small>いちばん深い</small>
              <b>{clockOf(jst(event.at).min)}</b>
              <small>高さ {Math.round(peakAlt)}°</small>
            </div>
            <div className="sun-key">
              <small>終わり</small>
              <b>{clockOf(jst(event.span.to).min)}</b>
              <small>{jst(event.span.to).md}</small>
            </div>
          </>
        ) : (
          <>
            <div className="sun-key">
              <small>月の出</small>
              <b>{night?.rise ? clockOf(Math.round(night.rise.at)) : "—"}</b>
              <small>{night?.rise ? dirName(night.rise.azimuth) : "この日は無し"}</small>
            </div>
            <div className="sun-key">
              <small>いちばん高い</small>
              <b>{night?.high ? clockOf(Math.round(night.high.at)) : "—"}</b>
              <small>{night?.high ? `${night.high.next ? "翌 " : ""}高さ ${Math.round(night.high.altitude)}°` : ""}</small>
            </div>
            <div className="sun-key">
              <small>月の入り</small>
              <b>{night?.set ? clockOf(Math.round(night.set.at)) : "—"}</b>
              <small>{night?.set ? `${night.set.next ? "翌 " : ""}${dirName(night.set.azimuth)}` : ""}</small>
            </div>
          </>
        )}
      </div>
      <p className={sky?.good ? "event-sky good" : "event-sky"} role="status">
        {sky ? (
          <>
            <b>{sky.verdict}</b>（{WHERE}の{sky.forecast ? "予報" : "記録"}：{sky.text}）
          </>
        ) : (
          `${WHERE}の天気は、予報が出たらここに出ます。`
        )}
      </p>

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
      <small className="set-help">時刻と見え方は{WHERE}で計算しています。天気は{WHERE}の観測所の記録・予報です。</small>
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
