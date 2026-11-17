# 予報の履歴 R6 の見本（#250）

要件定義書「予報の履歴」R6（画面）を、作る前に触って確かめるための見本。**アプリ本体には組み込まない。**

- 1日モード③「この日の予報の移り変わり」（R6-1・R6-2）：案A 折れ線／案B 発表ごとの行（2段）／案C 変わり目だけ／組み合わせ（上に案A の小さなグラフ、下に案B、案C は「変わった発表だけ」の絞り込み）
- 発表×対象日の表（R6-4）：案1 1マスに1項目／案2 まとめて／組み合わせ（案2 を基本に、項目を選んだら案1）。行を押すと、その発表が予報しているすべての対象日（R6-3、表に出ている列に限らない）

画面の部品・色・文字はアプリと同じもの（`src/styles.css`・`src/design/tokens.ts`・`src/ui/kit.tsx`・`WeatherIcon`）を使い、3テーマと幅 390／360 を切り替えられる。

## データ

見本のデータは、本物の処理に通して作る（`build-data.ts`）。D1 の代わりは `test/d1.ts`（Node の SQLite）。

| 見本 | 中身 |
| --- | --- |
| 10月 記録 | shiromatz の 2026-10（高知 390000）を `importShiromatzMonth` に通したもの（実データ） |
| 11月 電文 | `test/fixtures/forecast` の高知の電文4通を `parseForecasts` に通したもの（実データ）。それより前の回は手元にないので「記録なし」と出る |
| 合成の状態 | 11月の電文に、訂正（11/17 11時、中部 11/18 12〜18時の降水確率 30→50）・取り消し（11/16 17時）・取得失敗（11/15 夕方の取得の記録）を足したもの |

表示する1本は `choosePreferred` が選んだもの（`preferred = 1`）。

作ったデータ（`sample/public/sample-data.json`）と組んだページ（`dist/`）はリポジトリに入れない。shiromatz の値（CC BY-SA 4.0）の扱いは要件の未決 1 のため。

```sh
# zip は別のディレクトリに置く（コミットを固定した URL から）
C=$(git ls-remote https://github.com/shiromatz/Japan-Meteorological-Agency-Weather-Forecast refs/heads/main | cut -f1)
curl -o /tmp/fh/forecast_202610.zip https://raw.githubusercontent.com/shiromatz/Japan-Meteorological-Agency-Weather-Forecast/$C/forecast/forecast_202610.zip
npx rolldown research/forecast-history/build-data.ts --platform node --format esm -o /tmp/fh-build.mjs
node /tmp/fh-build.mjs /tmp/fh/forecast_202610.zip $C          # リポジトリの一番上から
npx vite build --config research/forecast-history/vite.config.ts  # → research/forecast-history/dist
```

## 見本だけの仮の決まり（`sample/model.ts`）

本体に入れるときは要件と照らして `shared/` に移す。

- 対象日を予報しうる定時の回：週間（VPFW50）は 7日前〜前日の 11・17時、府県天気予報（VPFD51）は 2日前の 11・17時、前日と当日の 5・11・17時。定時でない回（臨時など）は、その日を予報していれば入れる。
- 発表がない回の状態：2026-11-10 より前は「記録なし」（R2-10）。以後は取得の記録（発表時刻の30分前〜60分後）に失敗があれば「取れなかった」、成功しかなければ「届いていない」（気象庁から出ていない、R5-3 の「届かない」と同じ扱い）、記録がなければ「記録なし」。取消の電文があれば「取り消し」。
- 範囲は7日前〜当日（R6-1）。当日の発表は途中からの値なので、前の発表とは比べない。
- 変わったか：同じ種類の1つ前の「発表あり」と比べる。区切りの違う値（当日の「11時から」の天気、日中の最高と1日の最高など）は比べない。値なしは「変わった」としない。
- 天気の名前：テロップ番号から `shared/weatherCode.ts` の `weatherCodeLabel`（気象庁の表）で。表にない番号は「番号 N」と出す（推測で埋めない）。
- 「値なし」と「項目なし」はどちらも「—」。押すと画面の下に理由が出る（title 属性には頼らない、docs/design-system.md 4.2）。空欄（対象期間外）・状態の札・信頼度も同じ。
- 案A：線にするのは数値（降水確率・気温）だけ。天気は絵だけで線で結ばない。発表がない回で線を切る。府県の6時間降水確率は区切りを1つ選んで1本の線（週間の1日の降水確率とは別の段）。
- 押せる範囲は 44px 以上。案A は、グラフを押すと一番近い発表、‹ › で1つずつ選ぶ。
- 変わらなかった発表は、まとめた行を押すと開いて1つずつ見られる。当日の発表は比べないので「変わらなかった」に入れない。
- 取得時刻は保存が UTC、画面では日本時間に直して出す。
- 出典：気象庁（防災情報XML）。気象庁の予報（shiromatz/Japan-Meteorological-Agency-Weather-Forecast の記録、CC BY-SA 4.0）。
