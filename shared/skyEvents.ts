// 空のイベント（2026-11-20 渡辺さん「満月イベント用のロゴ」「日食・月食系イベントロゴ」）：その日（日本時間）に、
// 観測地から見える日食・月食、または満月があるか。見出しのロゴを帯に替え、押すと説明のモーダルを出すために使う。
// 日食・月食は観測地で見える日だけ（11/20 渡辺さん）：日食は最大のとき太陽が地平線の上、月食は最大のとき月が地平線の上。
// 計算は Astronomy Engine（月の満ち欠けと同じ）。どの年でも同じ仕組み（その年だけの文は持たない）。
import { AstroTime, EclipseKind, NextLocalSolarEclipse, NextLunarEclipse, Observer, SearchLocalSolarEclipse, SearchLunarEclipse, SearchMoonPhase } from "astronomy-engine";
import { fullMoonName, moonTopo } from "./moon";

const DAY_MS = 86_400_000;
const jstDate = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);

export type SkyEventKind = "full" | "lunar-total" | "lunar-partial" | "lunar-penumbral" | "solar-total" | "solar-annular" | "solar-partial";

export interface SkyEvent {
  kind: SkyEventKind;
  /** 満月の時刻、または食の最大の時刻。 */
  at: number;
  /** 満月の呼び名（満月・月食のとき）。 */
  name: string | null;
  blue: boolean;
  /** 食の始まりと終わり（部分食の始め・終わり。月食は欠け始め〜戻り）。 */
  span: { from: number; to: number } | null;
  /** 欠ける割合（0〜1、食のとき）。 */
  obscuration: number | null;
}

export const SKY_EVENT_NAME: Record<SkyEventKind, string> = {
  full: "満月",
  "lunar-total": "皆既月食",
  "lunar-partial": "部分月食",
  "lunar-penumbral": "半影月食",
  "solar-total": "皆既日食",
  "solar-annular": "金環日食",
  "solar-partial": "部分日食",
};

type LocalSolar = ReturnType<typeof SearchLocalSolarEclipse>;
type Lunar = ReturnType<typeof SearchLunarEclipse>;

/** 観測地で見える日食（最大のとき太陽が地平線の上）のイベント。見えなければ null。 */
function solarEvent(sol: LocalSolar): SkyEvent | null {
  if (!(sol.peak.altitude > 0)) return null;
  const kind = sol.kind === EclipseKind.Total ? "solar-total" : sol.kind === EclipseKind.Annular ? "solar-annular" : "solar-partial";
  return { kind, at: sol.peak.time.date.getTime(), name: null, blue: false, span: { from: sol.partial_begin.time.date.getTime(), to: sol.partial_end.time.date.getTime() }, obscuration: sol.obscuration };
}

/** 観測地で見える月食（最大のとき月が地平線の上）のイベント。見えなければ null。 */
function lunarEvent(lun: Lunar, lat: number, lon: number): SkyEvent | null {
  const lp = lun.peak.date.getTime();
  if (!(moonTopo(lp, lat, lon).altitude > 0)) return null;
  const kind = lun.kind === EclipseKind.Total ? "lunar-total" : lun.kind === EclipseKind.Partial ? "lunar-partial" : "lunar-penumbral";
  // 半影食の続く時間（sd_penum：最大の前後の分）で始め・終わり。
  const half = lun.sd_penum * 60_000;
  const n = fullMoonName(lp);
  return { kind, at: lp, name: n.name, blue: n.blue, span: { from: lp - half, to: lp + half }, obscuration: lun.obscuration };
}

function fullEvent(at: number): SkyEvent {
  const n = fullMoonName(at);
  return { kind: "full", at, name: n.name, blue: n.blue, span: null, obscuration: null };
}

/** その日（日本時間の date）の空のイベント。日食 → 月食 → 満月 の順に1つ。無ければ null。 */
export function skyEventOn(date: string, lat: number, lon: number): SkyEvent | null {
  const start = Date.parse(`${date}T00:00:00+09:00`);
  // 日食（観測地で見えるもの）
  const sol = SearchLocalSolarEclipse(new Date(start - DAY_MS), new Observer(lat, lon, 0));
  if (jstDate(sol.peak.time.date.getTime()) === date) {
    const e = solarEvent(sol);
    if (e) return e;
  }
  // 月食（最大のとき観測地で月が地平線の上）
  const lun = SearchLunarEclipse(new Date(start - DAY_MS));
  if (jstDate(lun.peak.date.getTime()) === date) {
    const e = lunarEvent(lun, lat, lon);
    if (e) return e;
  }
  // 満月
  const f = SearchMoonPhase(180, new AstroTime(new Date(start - DAY_MS)), 3);
  if (f && jstDate(f.date.getTime()) === date) return fullEvent(f.date.getTime());
  return null;
}

/**
 * from〜to（日本時間の日付、両端を含む）の空のイベントを日付の順に（イベントの見出しの確認用、docs/event-banner.md 5章）。
 * skyEventOn と同じ決まり（観測地から見える食だけ、1日に1つ、日食 → 月食 → 満月）。日ごとに探さず、満月・月食・日食を
 * それぞれ順にたどる（15年で 0.1秒ほど）。
 */
export function skyEventsBetween(from: string, to: string, lat: number, lon: number): { date: string; event: SkyEvent }[] {
  const start = Date.parse(`${from}T00:00:00+09:00`);
  const end = Date.parse(`${to}T00:00:00+09:00`) + DAY_MS;
  const byDay = new Map<string, SkyEvent>();
  const rank = (e: SkyEvent) => (e.kind.startsWith("solar") ? 0 : e.kind === "full" ? 2 : 1);
  const put = (e: SkyEvent | null) => {
    if (!e || e.at < start || e.at >= end) return;
    const d = jstDate(e.at);
    const had = byDay.get(d);
    if (!had || rank(e) < rank(had)) byDay.set(d, e);
  };
  for (let t = start - DAY_MS; ; ) {
    const f = SearchMoonPhase(180, new AstroTime(new Date(t)), 40);
    if (!f || f.date.getTime() >= end) break;
    put(fullEvent(f.date.getTime()));
    t = f.date.getTime() + DAY_MS;
  }
  for (let e = SearchLunarEclipse(new Date(start - DAY_MS)); e.peak.date.getTime() < end; e = NextLunarEclipse(e.peak)) put(lunarEvent(e, lat, lon));
  const obs = new Observer(lat, lon, 0);
  for (let e = SearchLocalSolarEclipse(new Date(start - DAY_MS), obs); e.peak.time.date.getTime() < end; e = NextLocalSolarEclipse(e.peak.time, obs)) put(solarEvent(e));
  return [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, event]) => ({ date, event }));
}
