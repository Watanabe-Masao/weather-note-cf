# 研究用の分析データ（DuckDB）

研究に協力すると同意した人の記録を、サーバーから読み取り専用で取り出し、DuckDB と Parquet の表にして分析します（#45）。アプリの動きには関係せず、ここの依存（`@duckdb/node-api`、`vite-node`）はアプリには入りません。

## 守ること

- **データはコミットしない**：`raw/`・`parquet/`・`*.duckdb` は `.gitignore` 済みです。共有するのは、手順・表の定義・コードだけです。
- **取り出せるのは管理者だけ**：サーバーの `/api/admin/research` は管理者のログインでしか答えません。取り出すたびに、誰が・いつ・何件をサーバーに記録します（管理画面の「書き出しの記録」）。
- **研究用の番号だけ**：名前やログインIDは出てきません。人は `research_id` で区別します。人数の少ない集まりでは、時刻と場所から本人が分かるおそれがあるため、外に出す結果は集計にとどめます。
- **撤回はすべての写しに届く**：同意を取り消した人・アカウントを削除した人は、次に取り出したとき、`raw/` にある過去の写しからも消します（`purged` に番号だけ残ります）。

## 使い方

```sh
cd research/data
npm install
WN_URL=https://weather-note-cf.<…>.workers.dev WN_SESSION=<管理者の wn_session> npm run export   # raw/ds-<日時>.json
npm run build        # raw/ → weather-note.duckdb と parquet/
npm run run-models   # 人ごとにモデルを計算 → model_runs・parameter_estimates・evaluation_results
npm run check        # 品質の確認（版の混在、学習から外した理由、確率の合計、重複…）
```

本物のデータなしで試すときは `npm run fixture`（作り物の2人・5件を `raw/ds-fixture.json` に書きます）。

## 表

| 表 | 中身 |
| --- | --- |
| `datasets` | 取り出し1回ぶん。日時・表の版・ファイルのハッシュ・件数・人数・消した人数 |
| `sensation_reports` | 答え（-3〜3）と尺度の版、日当たり・風・空、学習に使えるかと外した理由 |
| `weather_snapshots` | 答えたときの気象の値と、どこから来たか（観測・予報）、遅れ、品質の印、変換の版 |
| `prediction_snapshots` | 答える前に保存した予測（7段の確率、中心と幅、区間、分散の内訳、モデルの版） |
| `model_runs` | 計算1回ぶん。コードのコミット・モデルの版・設定 |
| `parameter_estimates` | 人ごと・モデルごとの推定値と区間、重み |
| `evaluation_results` | 人ごとの成績（RPS・スキル・対数損失・当たり・偏り…） |

表の定義と変換の決まりは [transform.ts](transform.ts) にあり、CI のテスト（`test/data/research-transform.test.ts`）で確かめています。DuckDB そのものは CI では動かしません。

答えた時点の予測（`prediction_snapshots`）は書き換えません。あとで計算し直した結果は `model_runs` の下に別に入れます（数学的正本 D7）。
