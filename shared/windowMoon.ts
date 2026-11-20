// 窓の外の月（11/21 渡辺さん「アイデアも採用」）：物語の締めくくりに、いまの空の具合で一言だけ添える。物語の満月が見出しに
// 出ている間（前日と当日、skyEventShown）だけ。いま月が夜空にあれば「窓の外にも」（雲なら「雲の向こうに」）、まだなら、
// のぼる時刻と方角。年や日付に関わる文は持たず、すべて計算から。
import { moonTimes, moonTopo } from "./moon";
import { skyEventShown, type SkyEvent } from "./skyEvents";
import { solarAltitude } from "./sunTimes";

const jst = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const nextDay = (date: string) => jst(Date.parse(`${date}T12:00:00+09:00`) + 86_400_000).date;
/** 夜空：太陽が地平線の 6° より下（市民薄明の終わり）。 */
const DARK_SUN = -6;

/**
 * いまの一言。hidden は、いまの時間の天気が雲で月を隠すか（分からなければ null）。dir は方位（度）を「東北東」などに。
 * 見出しに出ていない満月・日食は null。
 */
export function windowMoonLine(now: number, event: SkyEvent, lat: number, lon: number, hidden: boolean | null, dir: (az: number) => string): string | null {
  if (event.kind.startsWith("solar")) return null;
  const shown = skyEventShown(now, lat, lon);
  if (!shown || shown.event.at !== event.at) return null;
  const eve = shown.phase === "eve";
  const j = jst(now);
  const up = moonTopo(now, lat, lon).altitude > 0;
  const dark = solarAltitude(j.date, j.min, lat, lon) < DARK_SUN;
  const moon = eve ? "満ちかけの月" : "同じ月";
  if (up && dark) {
    if (hidden === true) return `いま、雲の向こうに${moon}が出ています。`;
    if (hidden === false) return `いま、窓の外にも${moon}が出ています。`;
    return `いま、夜空に${moon}が出ています。`;
  }
  // まだのぼっていない（昼・夕方）：その晩の月の出。
  const today = moonTimes(j.date, lat, lon).rise;
  const rise = today && today.at > j.min ? today : null;
  if (rise && !up) {
    const h = Math.floor(rise.at / 60);
    return `今夜${h}時ごろ、${dir(rise.azimuth)}の空に${eve ? "満ちかけの月が" : ""}のぼります。`;
  }
  if (up && !dark) return eve ? "日が暮れたら、東の空に満ちかけの月が見えてきます。" : "日が暮れたら、東の空に同じ月が見えてきます。";
  // 今日の月の出が過ぎて沈んでいる（明け方など）：次の月の出。
  const next = moonTimes(nextDay(j.date), lat, lon).rise;
  return next ? `${Math.floor(next.at / 60)}時ごろ、${dir(next.azimuth)}の空にのぼります。` : null;
}
