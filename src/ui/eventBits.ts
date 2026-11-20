// イベントの説明と満月の物語で使う小さな部品（11/20）：秒読みの文と、舞台の星の並び。
const HOUR_MS = 3_600_000;
/** 瞬間のあと、「いま、この夜」と出す長さ。 */
export const NOW_SPAN_MS = 3 * HOUR_MS;

/** 「あと 3日」「あと 11:54:12」（24時間を切ったら秒まで）「いま、この夜」（瞬間から NOW_SPAN_MS まで）「5時間前」。 */
export function countdown(at: number, now: number): string {
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
export const STARS: [number, number, number, number][] = [
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

