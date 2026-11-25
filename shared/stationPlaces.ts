// 地点ごとの読む場所 (要件 R4「場所」, 2026-11-17)：同じ「高知」でも、予報の区域・気温の地点・アメダスの
// 観測点・雨雲の画像の中の位置と、単位ごとに場所が違う。それを地点（気象庁の観測点の番号）ごとに1つの表に
// まとめる。表にない地点は推測しない（予報の履歴は supported: false、雨雲は保存しない）。

export interface StationPlaces {
  name: string;
  /** 予報の履歴 (R6)：週間の天気・降水確率の予報区、府県天気予報の区域、気温の地点。 */
  forecast: { office: string; area: string; point: string };
  /** 雨雲レーダー：地点の位置と、保存する地図タイルの段階・まわりの枚数（around 1 で 3×3）。 */
  radar: { lat: number; lon: number; z: number; around: number };
  /** 長い先の予報：地方の予報（1か月予報・早期天候情報）を出す官署（地方の中枢）。2週間気温予報は全国1通。 */
  longRange: { regionOffice: string };
  /** アメダスの観測点（10分ごとの JSON を R2 に残す、amedasArchive.ts）。 */
  amedas: string;
  /** 大気汚染の実測（そらまめくん、soramame.ts）：都道府県コードと測定局コード、画面に出す局の名前。 */
  soramame: { pref: string; station: string; name: string };
}

export const STATION_PLACES: Record<string, StationPlaces> = {
  // 高知：高知県（390000）、府県天気予報の中部（390010）、気温は高知（74182）。雨雲は高知市、段階8 の 3×3（四国全体）。
  "47893": {
    name: "高知",
    forecast: { office: "390000", area: "390010", point: "74182" },
    radar: { lat: 33.56, lon: 133.53, z: 8, around: 1 },
    // 四国地方の1か月予報は高松地方気象台（ファイル名 370000、#283 KC-02）。早期天候情報も同じと見込む（実物で確かめる）。
    longRange: { regionOffice: "370000" },
    // アメダスは高知（74182、高知地方気象台）。視程・天気（自動観測）が入る（KC-04）。
    amedas: "74182",
    // 大気汚染の実測は高知市の介良局（39201350、一般局。PM2.5 を測る高知市でただ一つの局。KC-04）。
    soramame: { pref: "39", station: "39201350", name: "高知市 介良局" },
  },
};
