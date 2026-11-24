// 時点に印を付ける（2026-11-24 渡辺さん、設計改善書の「発注判断をした時点までたどる」の軽い形、見本の OK）：
// 選んだ時刻までに出ていた発表のうち、いちばん新しいものに「この時点の最新」の印。それより後の発表は薄く。
// 訂正・取消がいつ出たかは記録に無い（同じ発表時刻の版として持つ）ので、訂正のある発表には「あとで訂正あり」と添えるだけで、
// その時点で訂正後の値が見えていたかは言い切らない。
import { addDays } from "./dates";
import { leadLabel, type Slot } from "./forecastHistoryModel";

/** よく使う時点（ボタン）：前日 9時・14時・18時、当日 7時（渡辺さん OK）。lead：対象日の何日前か。 */
export const POINT_PRESETS = [
  { lead: 1, h: 9, m: 0 },
  { lead: 1, h: 14, m: 0 },
  { lead: 1, h: 18, m: 0 },
  { lead: 0, h: 7, m: 0 },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** 対象日 `day` の `lead` 日前の h:m（日本時間の ISO）。 */
export const pointIso = (day: string, lead: number, h: number, m = 0) => `${addDays(day, -lead)}T${pad(h)}:${pad(m)}:00+09:00`;

/** 時点の言葉：「前日 14時」「2日前 9:30」「当日 7時」。 */
export function pointLabel(day: string, iso: string): string {
  const d = iso.slice(0, 10);
  const lead = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
  const h = Number(iso.slice(11, 13));
  const m = Number(iso.slice(14, 16));
  return `${leadLabel(lead)} ${m ? `${h}:${pad(m)}` : `${h}時`}`;
}

/** 選べる時刻：対象日の7日前 0:00 から対象日 23:30 まで、30分ごと（新しい順）。 */
export function pointOptions(day: string): string[] {
  const out: string[] = [];
  for (let lead = 0; lead <= 7; lead++) for (let i = 47; i >= 0; i--) out.push(pointIso(day, lead, Math.floor(i / 2), (i % 2) * 30));
  return out;
}

/** その時刻までに出ていた発表のうち、いちばん新しい「発表あり」（一覧の slots から）。無ければ null。 */
export function latestAt(slots: Slot[], until: string): Slot | null {
  const t = Date.parse(until);
  let best: Slot | null = null;
  for (const s of slots) if (s.state === "ok" && s.values && Date.parse(s.at) <= t && (!best || Date.parse(s.at) >= Date.parse(best.at))) best = s;
  return best;
}

/** その発表に訂正があるか（同じ発表の版に「訂正」がある）。いつ出たかは分からない。 */
export const corrected = (s: Slot) => s.copies.some((c) => c.info_type === "訂正");
