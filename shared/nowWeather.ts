// 今の天気（見た空）の言葉（2026-11-28 渡辺さん「今の天気だけをアンケート形式で」「雨を選択したらポツポツ、パラパラ、
// ザーザー、ゴウゴウ」）。天気の記録（weather_obs）が正本で、肌感の記録の「今の天気」と空の写真の天気も同じ言葉で入る。
// 使い道：あとでアメダスの値と合っているかを確かめる（今は作らない）。雨の強さは、そのときのために 4 段に分けておく。

/** 空の様子（気象庁の観測の言葉）。肌感の記録（reports の sky）と同じ id。 */
export const SKIES = [
  { id: "clear", label: "快晴" },
  { id: "sunny", label: "晴れ" },
  { id: "thin", label: "薄曇り" },
  { id: "cloudy", label: "曇り" },
  { id: "rain", label: "雨" },
  { id: "snow", label: "雪" },
] as const;
export type Sky = (typeof SKIES)[number]["id"];

/** 雨の強さ（見た・聞いた感じ）。雨を選んだときだけ。弱い順。 */
export const RAIN_LEVELS = [
  { id: "potsu", label: "ポツポツ" },
  { id: "para", label: "パラパラ" },
  { id: "zaa", label: "ザーザー" },
  { id: "gou", label: "ゴウゴウ" },
] as const;
export type RainLevel = (typeof RAIN_LEVELS)[number]["id"];

/** どこから入った天気か：アンケート・肌感の記録・空の写真。 */
export const OBS_SOURCES = ["survey", "feel", "photo"] as const;
export type ObsSource = (typeof OBS_SOURCES)[number];

export const isSky = (v: unknown): v is Sky => typeof v === "string" && SKIES.some((s) => s.id === v);
export const isRainLevel = (v: unknown): v is RainLevel => typeof v === "string" && RAIN_LEVELS.some((s) => s.id === v);
export const skyLabel = (v: string | null | undefined) => SKIES.find((s) => s.id === v)?.label ?? null;
export const rainLabel = (v: string | null | undefined) => RAIN_LEVELS.find((s) => s.id === v)?.label ?? null;
