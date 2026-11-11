# Weather Note（Cloudflare版）

高知などの観測地点で、天気の実績と予報を「対象日」と「比較日」で比べるスマホ向けWebアプリです。
[weather-note](https://github.com/Watanabe-Masao/weather-note) を参考に、Cloudflare Workers で作り直しています。

## 構成

| 場所 | 内容 |
| --- | --- |
| `src/` | 画面（React + TypeScript、Vite でビルド） |
| `worker/src/` | API（Cloudflare Worker）。気象庁・Open-Meteo からの取得と変換 |
| `shared/` | 画面とAPIで共有する型、日付処理、確定判定 |
| `test/` | 単体テスト（気象庁・Open-Meteo の実データを fixtures に保存） |

画面と API は1つの Worker で配信します。`/api/*` だけが Worker のコードを通り、それ以外は静的ファイルです。

## データの考え方

データは2種類だけです（仕様書 2章）。

- **変わらないデータ**：3日前以前で、天気概況まで揃った実績。API は1年キャッシュ、アプリは永久保存
- **変わりうるデータ**：それ以外（未確定の実績、一昨日〜今日、予報）。API はキャッシュしない

判定は `shared/fixed.ts` の1か所にあり、API とアプリの両方が使います。

アプリ側のデータ層は `src/data/` にあります。

| ファイル | 役割 |
| --- | --- |
| `store.ts` | 4つのルールを実装した本体。表示は `getDay` / `getHours` で読み、変化は `subscribe` で受け取る |
| `plan.ts` | どの日をどの順で取るか（表示中の7日 → 進行方向の1か月 → 逆方向の7日） |
| `queue.ts` | 通信の待ち行列（同じ要求の相乗り、気象庁へは同時2本まで） |
| `db.ts` | IndexedDB への保存。使えない環境ではメモリだけで動く |

テスト `test/data/store.test.ts` は仕様書 2.7 の合格基準をそのまま確かめています。

## API

| パス | 内容 |
| --- | --- |
| `GET /api/stations` | 観測地点の一覧 |
| `GET /api/daily?station=47893&month=2025-11` | 気象庁の日別実績（1か月分） |
| `GET /api/hourly?station=47893&from=2025-11-01&to=2025-11-07` | 気象庁の時間別実績（最大14日、今日より前） |
| `GET /api/recent?station=47893&date=2026-11-09` | 一昨日・昨日の速報（AMeDAS） |
| `GET /api/current?station=47893` | 今日の観測（AMeDAS） |
| `GET /api/forecast?station=47893` | 16日間の予報（今日＋15日、Open-Meteo） |
| `GET /api/sun?station=47893&date=2026-11-10` | 日の出・日の入り（Open-Meteo） |

## 開発

Node.js 22 を使います。

```sh
npm ci
npm run dev       # 画面とAPIをローカルで起動（Vite + Cloudflare プラグイン）
npm run check     # 型チェック、テスト、ビルド
```

## Cloudflare への公開

1. Cloudflare のダッシュボードで「Workers & Pages」→「作成」→ リポジトリをインポートし、このリポジトリを選ぶ
2. ビルドコマンド `npm run build`、デプロイコマンド `npx wrangler deploy` を指定する
3. 以後は main へのプッシュで自動的に公開される
4. 自分だけが開けるようにする場合は、Cloudflare Access でこのサイトを保護する

## 進め方

1. 骨組みと API（完了）
2. データ層（端末保存、2区分、4つのルール）（完了）
3. 比較画面（ドラム、テーブル、グラフシート）← この段階
4. 寒暖差、時間帯グラフ、似た日検索

## 出典

- 実績：[気象庁ホームページ](https://www.jma.go.jp/)（過去の気象データ、アメダス）のデータを加工して表示しています
- 予報・日の出日の入り：[Open-Meteo](https://open-meteo.com/)（CC BY 4.0）
