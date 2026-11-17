// 地点ごとの読む場所 (要件 R4「場所」, 2026-11-17)：同じ「高知」でも、予報の区域・気温の地点・アメダスの
// 観測点・雨雲の画像の中の位置と、単位ごとに場所が違う。それを地点（気象庁の観測点の番号）ごとに1つの表に
// まとめる。表にない地点は推測しない（予報の履歴は supported: false、雨雲は保存しない）。

export interface StationPlaces {
  name: string;
  /** 予報の履歴 (R6)：週間の天気・降水確率の予報区、府県天気予報の区域、気温の地点。 */
  forecast: { office: string; area: string; point: string };
  /** 雨雲レーダー：地点の位置と、保存する地図タイルの段階・まわりの枚数（around 1 で 3×3）。 */
  radar: { lat: number; lon: number; z: number; around: number };
}

export const STATION_PLACES: Record<string, StationPlaces> = {
  // 高知：高知県（390000）、府県天気予報の中部（390010）、気温は高知（74182）。雨雲は高知市、段階8 の 3×3（四国全体）。
  "47893": {
    name: "高知",
    forecast: { office: "390000", area: "390010", point: "74182" },
    radar: { lat: 33.56, lon: 133.53, z: 8, around: 1 },
  },
};
