// 空気のデータの提供スケジュール（2026-11-25 渡辺さん「漏れなく、抜かりなく、重複が無いような設計」「データ取得の提供
// スケジュールはスケジュール管理を行いチェック、対応や判断ができるように」）。
//
// 取りに行く3つの系統ごとに、提供元がいつ出すか・こちらがいつ取るか・いつまでに無ければ遅れか・いつまで取り戻せるか・
// 止まったときの手順を、1か所に書く。見張り（shared/healthJudge.ts）・欠けの発見（worker/src/airAudit.ts）・データの保守の
// 画面・毎朝の点検は、ここの数を使う（同じことを別々に書かない）。
// 数の根拠：
//   CAMS 全球：9時・21時（日本時間）の計算、ECMWF の提供目安はそれぞれ19時・翌7時。Open-Meteo への取り込みはさらに遅れる。
//              過ぎた日の値は日付が変われば出る（11/25 レビュー）。2023-01 からいつでも取り直せる。
//   そらまめくん：直近7日の CSV は、その1時間の終わりから約1時間で出る（11/25 15:16 の実機で 14時台＝15時の値まで）。
//              検索の API は前日の夜まで。速報値は後で直ることがある。検索の API は今月から1年まで。

export interface AirFeed {
  id: "cams" | "forecast" | "soramame";
  name: string;
  /** 提供元。 */
  provider: string;
  /** 提供元が出す時刻・遅れ。 */
  publish: string;
  /** こちらが取る間隔。 */
  fetch: string;
  /** これより遅ければ「遅れ」として見張りが注意する（時間）。 */
  lateH: number;
  /** これより遅ければ異常（時間）。null は注意だけ（いつでも取り戻せる）。 */
  stopH: number | null;
  /** いつまで取り戻せるか。 */
  reach: string;
  /** 欠けたときの取り直し。 */
  refill: string;
  /** 障害の手引き（docs/runbook.md）。 */
  runbook: string;
}

export const AIR_FEEDS: AirFeed[] = [
  {
    id: "forecast",
    name: "空気質の予測（CAMS）",
    provider: "Open-Meteo（Copernicus CAMS 全球）",
    publish: "9時・21時の計算。ECMWF の提供は約10時間後、Open-Meteo への取り込みはさらに数時間",
    fetch: "1時間ごと（日付が変われば すぐ）。今日から5日分、値のある時刻・項目だけ書き換え",
    lateH: 3,
    stopH: 24,
    reach: "持たない（予測の履歴は残さない）。次に取れれば戻る",
    refill: "毎時の取得そのもの。今日から4日先までの96時間がそろっているかを毎時確かめる",
    runbook: "R-05",
  },
  {
    id: "cams",
    name: "空気質（CAMS、終わった日）",
    provider: "Open-Meteo（Copernicus CAMS 全球）",
    publish: "過ぎた日の値は日付が変われば出る",
    fetch: "1時間ごと。新しい側の抜けを先に、済んだら 2023-01 まで1か月ずつ古い側へ",
    lateH: 3,
    stopH: null,
    reach: "2023-01 からいつでも",
    refill: "手前14日に24時間そろわない日があれば、その範囲を1日1回まで取り直す",
    runbook: "R-05",
  },
  {
    id: "soramame",
    name: "大気汚染の実測（そらまめくん・介良局）",
    provider: "環境省 大気汚染物質広域監視システム（そらまめくん）",
    publish: "その1時間の終わりから約1時間（直近7日の CSV）。検索の API は前日の夜まで。速報値は後で直ることがある",
    fetch: "1時間ごとに直近7日の CSV。6時間ごとに検索の API で直近2か月の取り直しと古い側へ",
    lateH: 3,
    stopH: 12,
    reach: "直近7日は CSV、今月から1年は検索の API",
    refill: "毎時の CSV が直近7日を取り直す。それより前は6時間ごとの検索の API",
    runbook: "R-05",
  },
];

export const airFeed = (id: AirFeed["id"]) => AIR_FEEDS.find((f) => f.id === id)!;

/** 欠けを確かめる長さ（日）。予報の電文・雨雲の欠けの発見（completeness.ts）と同じ14日。 */
export const AIR_AUDIT_DAYS = 14;
/** 予測で、そろっているはずの時間（今日の0時から4日先の23時まで。5日目は計算の時刻しだいで途中まで）。 */
export const AIR_FORECAST_FULL_HOURS = 96;
