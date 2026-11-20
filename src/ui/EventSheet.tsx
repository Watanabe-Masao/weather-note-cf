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
import { fullMoonsOfYear, moonLimb, moonNorth, moonPhase, moonTimes, moonTopo } from "../../shared/moon";
import { SKY_EVENT_NAME, type SkyEvent } from "../../shared/skyEvents";
import { DEFAULT_LAT_LON, solarAltitude } from "../../shared/sunTimes";
import type { WeatherStore } from "../data/store";
import { Priority } from "../data/plan";
import { eventArt, EVENT_ART_SIZE, eventIcon, EVENT_ICON_SIZE } from "../design/eventAssets";
import { eventBannerSvg, eventStage } from "../design/eventLogo";
import { currentTheme, onSkyVars } from "../design/tokens";
import { dirName, MoonSphere, PhaseIcon } from "./moonParts";
import { EventPath, pathDays } from "./EventPath";
import { factTags, FullMoonSheet } from "./FullMoonSheet";
import { MoonStory } from "./MoonStory";
import { countdown, NOW_SPAN_MS, STARS } from "./eventBits";
import { ModalSheet } from "./ModalSheet";
import { Button, Glyph } from "./kit";

const WHERE = "高知";
/** 天気は高知の観測所（時刻と見え方を計算する地点と同じ所）。 */
const STATION = "47893";
const HOUR_MS = 3_600_000;
/** 秒読みを描き直す間（24時間を切ったら秒まで出すので1秒）。 */
const TICK_MS = 1000;

const jst = (ms: number) => {
  const d = new Date(ms + 9 * HOUR_MS);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, wd: "日月火水木金土"[d.getUTCDay()] };
};

/** 舞台とその夜の空の地と色（紺は空の上の色 onSkyVars で、白と緑はテーマの色のまま）。flip：下のカードは上下を返す。 */
function stageStyle(st: ReturnType<typeof eventStage>, flip: boolean): CSSProperties {
  const [a, b] = flip ? [st.bg[1], st.bg[0]] : st.bg;
  return {
    ...(st.dark ? (onSkyVars() as CSSProperties) : {}),
    background: `linear-gradient(${a}, ${b})`,
    ["--ev-glow" as string]: st.glow,
    ["--ev-line" as string]: st.line,
    ["--ev-star" as string]: st.star,
  };
}


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
  // 秒読み（1秒ごと）。瞬間の前後は札を光らせる。
  const [now, setNow] = useState(() => Date.now());
  const near = Math.abs(event.at - now) < NOW_SPAN_MS;
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // その夜の日付（満月・月食）：瞬間が夜中を過ぎていれば前の晩（例：1/1 1:51 の月食は 12/31 の夜）。日食はその日。
  const nightDate = solar ? date : jst(event.at - 12 * HOUR_MS).date;
  // その夜の月：その晩の月の出から、いちばん高い・月の入り（日をまたげば翌日）。
  const night = useMemo(() => {
    if (solar) return null;
    const t0 = moonTimes(nightDate, lat, lon);
    const t1 = moonTimes(addDays(nightDate, 1), lat, lon);
    const rise = t0.rise ? { at: t0.rise.at, azimuth: t0.rise.azimuth, next: false } : null;
    const after = (m: number | undefined) => (rise ? (m ?? -1) > rise.at : true);
    const high = t0.transit && after(t0.transit.at) ? { ...t0.transit, next: false } : t1.transit ? { ...t1.transit, next: true } : null;
    const set = t0.set && after(t0.set.at) ? { ...t0.set, next: false } : t1.set ? { ...t1.set, next: true } : null;
    return { rise, high, set };
  }, [solar, nightDate, lat, lon]);

  // 見え方の天気（高知の観測所の記録・予報）：その晩と翌日の分。満月は月が出ている 18時〜翌6時、食はその間（日食は昼）。
  useEffect(() => {
    if (!store) return;
    store.wantHours(STATION, pathDays(nightDate), Priority.Visible, "event-sheet");
    return () => store.wantHours(STATION, [], Priority.Visible, "event-sheet");
  }, [store, nightDate]);
  const rows = store?.getHours(STATION, nightDate).rows ?? [];
  const nextRows = store?.getHours(STATION, addDays(nightDate, 1)).rows ?? [];
  const sky = useMemo(() => {
    const byDate: Record<string, typeof rows> = { [nightDate]: rows, [addDays(nightDate, 1)]: nextRows };
    // 見る時刻（1時間ごと）：食はその間、満月は月が地平線の上にある 18時〜翌6時。
    const times: number[] = [];
    if (event.span) {
      for (let t = event.span.from; t <= event.span.to; t += HOUR_MS) times.push(t);
      times.push(event.at);
    } else {
      const start = Date.parse(`${nightDate}T18:30:00+09:00`);
      for (let k = 0; k < 12; k++) if (moonTopo(start + k * HOUR_MS, lat, lon).altitude > 0) times.push(start + k * HOUR_MS);
    }
    const seen = [...new Map(times.map((t) => [Math.floor(t / HOUR_MS), t])).values()]
      .sort((a, b) => a - b)
      .map((t) => {
        const j = jst(t);
        const s = byDate[j.date]?.length ? skyHidden(byDate[j.date], Math.floor(j.min / 60) + 1, STATION) : null;
        return s ? { ...s, at: Math.floor(t / HOUR_MS) * HOUR_MS } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (!seen.length) return null;
    const hidden = seen.filter((x) => x.hidden).length;
    const verdict = hidden === 0 ? "よく見えそう" : hidden === seen.length ? "雲で見えにくいかも" : "雲の切れ間から見えそう";
    const forecast = [...rows, ...nextRows].some((r) => r.type === "forecast");
    // 同じ天気の続く時間をまとめる：「17〜20時台 晴れ・21〜23時台 くもり」（日をまたいでも時刻だけ）。
    const runs: { from: number; to: number; text: string }[] = [];
    for (const x of seen) {
      const last = runs.at(-1);
      if (last && last.text === x.text && x.at === last.to + HOUR_MS) last.to = x.at;
      else runs.push({ from: x.at, to: x.at, text: x.text });
    }
    const hour = (t: number) => Math.floor(jst(t).min / 60);
    const text = runs.map((r) => `${hour(r.from)}${r.to > r.from ? `〜${hour(r.to)}` : ""}時台 ${r.text}`).join("・");
    return { verdict, text, forecast, good: hidden === 0 };
  }, [rows, nextRows, event.span, event.at, nightDate, lat, lon]);

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
        </div>
        {/* 瞬間のカード（14:35 渡辺さんの見本）：左に「満月になる時刻（日本時間）」と時刻を光の色で大きく、秒読み。
            右にその瞬間の月（日食は太陽）と雲。 */}
        <div className="event-moment-card">
          <div className="emc-text">
            <small>
              {solar ? <span className="emc-dot" aria-hidden /> : <PhaseIcon kind={2} size={14} />}
              {full ? "満月になる時刻（日本時間）" : "食がいちばん深くなる時刻（日本時間）"}
            </small>
            <b className="emc-time">
              {Number(jst(event.at).date.slice(5, 7))}
              <i>月</i>
              {Number(jst(event.at).date.slice(8))}
              <i>日</i> {clockOf(jst(event.at).min)}
            </b>
            <span className={near ? "event-count now" : "event-count"} role="timer">
              {countdown(event.at, now)}
            </span>
          </div>
          <div className="emc-sky" aria-hidden>
            {solar ? (
              <SunMark kind={event.kind} />
            ) : (
              <MoonSphere phase={moonPhase(event.at)} size={64} limb={moonLimb(event.at, lat, lon)} north={moonNorth(event.at, lat, lon)} tint={stage.glow} dark={false} />
            )}
            <svg className="emc-clouds" viewBox="0 0 120 40">
              <path d="M8 34 C 6 26 16 22 22 26 C 26 18 40 18 44 26 C 52 24 58 30 54 34 Z" />
              <path d="M64 36 C 64 30 72 27 77 30 C 81 24 93 25 95 31 C 102 30 106 35 102 38 Z" />
            </svg>
          </div>
        </div>
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

      {/* その夜の空（11/20 渡辺さん「ここの工夫」）：舞台と同じ夜空に、月（日食は太陽）の通り道を天気で描き分け、
          見込みを札で。下に出・いちばん高い・入り（食は始め・いちばん深い・終わり）。 */}
      <div className={stage.dark ? "event-night" : "event-night light"} style={stageStyle(stage, true)}>
        <div className="event-night-head">
          <h4>{solar ? `${jst(event.at).md} の太陽（${WHERE}）` : `${Number(nightDate.slice(5, 7))}/${Number(nightDate.slice(8))} の夜の月（${WHERE}）`}</h4>
          <span className={sky ? (sky.good ? "event-verdict good" : "event-verdict") : "event-verdict unknown"} role="status">
            {sky ? sky.verdict : "天気は予報待ち"}
          </span>
        </div>
        <EventPath event={event} date={nightDate} lat={lat} lon={lon} weather={{ rows: { [nightDate]: rows, [addDays(nightDate, 1)]: nextRows }, station: STATION }}
          ends={{ from: night?.rise ? `${clockOf(Math.round(night.rise.at))} 出` : null, to: night?.set ? `${night.set.next ? "翌" : ""}${clockOf(Math.round(night.set.at))} 入` : null }}
        />
        <p className="event-night-legend" aria-hidden>
          <span className="clear">晴れ間</span>
          <span className="cloud">雲で見えにくい</span>
          <span className="unknown">天気がまだ無い</span>
        </p>
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
        {sky && (
          <small className="event-night-wx">
            {WHERE}の{sky.forecast ? "予報" : "記録"}：{sky.text}
          </small>
        )}
      </div>

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

/** 瞬間のカードの太陽（日食）：欠けた所は空の地のまま（月は描かない）。金環は光の輪、皆既はコロナ。色は舞台の光の色。 */
function SunMark({ kind }: { kind: SkyEvent["kind"] }) {
  return (
    <svg className="emc-sun" viewBox="0 0 64 64">
      <defs>
        <mask id="emc-bite">
          <rect width="64" height="64" fill="white" />
          {kind === "solar-partial" && <circle cx="44" cy="26" r="21" fill="black" />}
          {kind === "solar-annular" && <circle cx="32" cy="32" r="19" fill="black" />}
          {kind === "solar-total" && <circle cx="32" cy="32" r="21.5" fill="black" />}
        </mask>
      </defs>
      {kind === "solar-total" && <circle cx="32" cy="32" r="29" className="emc-corona" />}
      <circle cx="32" cy="32" r="22" className="emc-sun-disc" mask="url(#emc-bite)" />
    </svg>
  );
}
