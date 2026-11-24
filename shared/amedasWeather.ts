// アメダスの天気の番号（気象台など天気を自動観測する地点だけ、1時間ごと）を、過去の気象データ（時別値）と同じ
// 文字に。対応は高知の9日分（205時間）を同じ時刻で突き合わせて確かめたものだけ（KC-05、2026-11-21）：
// 0 → 晴れ（97回）、1 → 曇（80回）、7 → 雨（24回）、食い違い 0。
// それ以外の番号（霧・雪など、まだ出会っていない）は推測で決めず、天気なし（予報の天気を借りる）にする。
export const AMEDAS_WEATHER: Record<number, string> = { 0: "晴れ", 1: "曇", 7: "雨" };

export const amedasWeather = (code: number | null): string | null => (code == null ? null : (AMEDAS_WEATHER[code] ?? null));
