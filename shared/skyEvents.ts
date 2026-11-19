// 空のイベント（2026-11-20 渡辺さん「満月イベント用のロゴ」「日食・月食系イベントロゴ」）：その日（日本時間）に、
// 観測地から見える日食・月食、または満月があるか。見出しのロゴを帯に替え、押すと説明のモーダルを出すために使う。
// 日食・月食は観測地で見える日だけ（11/20 渡辺さん）：日食は最大のとき太陽が地平線の上、月食は最大のとき月が地平線の上。
// 計算は Astronomy Engine（月の満ち欠けと同じ）。どの年でも同じ仕組み（その年だけの文は持たない）。
import { AstroTime, EclipseKind, Observer, SearchLocalSolarEclipse, SearchLunarEclipse, SearchMoonPhase } from "astronomy-engine";
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

/** その日（日本時間の date）の空のイベント。日食 → 月食 → 満月 の順に1つ。無ければ null。 */
export function skyEventOn(date: string, lat: number, lon: number): SkyEvent | null {
  const start = Date.parse(`${date}T00:00:00+09:00`);
  // 日食（観測地で見えるもの）
  const sol = SearchLocalSolarEclipse(new Date(start - DAY_MS), new Observer(lat, lon, 0));
  const sp = sol.peak.time.date.getTime();
  if (jstDate(sp) === date && sol.peak.altitude > 0) {
    const kind = sol.kind === EclipseKind.Total ? "solar-total" : sol.kind === EclipseKind.Annular ? "solar-annular" : "solar-partial";
    return { kind, at: sp, name: null, blue: false, span: { from: sol.partial_begin.time.date.getTime(), to: sol.partial_end.time.date.getTime() }, obscuration: sol.obscuration };
  }
  // 月食（最大のとき観測地で月が地平線の上）
  const lun = SearchLunarEclipse(new Date(start - DAY_MS));
  const lp = lun.peak.date.getTime();
  if (jstDate(lp) === date && moonTopo(lp, lat, lon).altitude > 0) {
    const kind = lun.kind === EclipseKind.Total ? "lunar-total" : lun.kind === EclipseKind.Partial ? "lunar-partial" : "lunar-penumbral";
    // 半影食の続く時間（sd_penum：最大の前後の分）で始め・終わり。
    const half = lun.sd_penum * 60_000;
    const n = fullMoonName(lp);
    return { kind, at: lp, name: n.name, blue: n.blue, span: { from: lp - half, to: lp + half }, obscuration: lun.obscuration };
  }
  // 満月
  const f = SearchMoonPhase(180, new AstroTime(new Date(start - DAY_MS)), 3);
  if (f) {
    const at = f.date.getTime();
    if (jstDate(at) === date) {
      const n = fullMoonName(at);
      return { kind: "full", at, name: n.name, blue: n.blue, span: null, obscuration: null };
    }
  }
  return null;
}
