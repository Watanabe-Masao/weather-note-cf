# 空色エンジン β2：最初の比較（#537）

アプリの外の試作です。アプリの動き・既定の表示は変えません。

ねらい（11/27 渡辺さん）：太陽と視線の位置関係・大気の状態から、方角ごとの空の色と明るさを求める計算エンジンを、
今の空の絵（β1）・PC の OpenGL 参照・iPhone の WebGL 2 で同じ条件にそろえて比べる。最初は高知の晴天空で、
太陽側・横・反対側を、太陽 +5°（11/23 16:30 の画面に相当）・−1.9°（日没直後、#543）・−6.8°（薄明、#543）で並べる。

## 計算エンジンの受け渡し

| | 中身 |
|---|---|
| 入力 | 日時・地点・観測者の標高（太陽の位置は `shared/sunTimes.ts`）、視線（方位・高さ。画面の点ごとの視線は `shared/skyLook.ts`）、大気（空気分子・エアロゾル・オゾン。まず標準大気） |
| 出力 | 視線方向から届く光（輝度 cd/m²、線形 sRGB。または 680・550・440 nm の放射輝度）と、その方向の大気の透過率 |
| 描画 | 共通の露出と色変換：`1 − exp(−E·L)` → sRGB の符号化（比較では 3 事例で同じ E） |

- 大気の計算は Bruneton の precomputed atmospheric scattering（BSD-3、コミット 34f14e7）。事前計算の表を作れば、視線ごとの値は表を引くだけで、
  端末の向きを変えるたびに大気全体を計算し直さない
- 大気の条件はその実装のデモの既定：Rayleigh（尺度高 8 km）、Mie（Ångström β 5.328e-3・α 0、尺度高 1.2 km、単散乱アルベド 0.9、g 0.8）、
  オゾン 300 DU、地面のアルベド 0.1、太陽スペクトルは実測。観測者は地表から 10 m
- 2 通りで計算する：**luminance**（15 波長で事前計算し CIE の等色関数で積分した輝度。色の比較に使う）と **radiance**（3 波長の放射輝度。透過率はこちらで読む）。
  luminance の表の透過率は最後の 3 波長分で、色の意味を持たない
- 表は半精度（float16）。WebGL 2 でも RGBA16F のまま線形補間できる（iPhone で拡張が要らない）
- 太陽の円盤は描かない（空の散乱光だけ）

## 作り方

```sh
# 1) 固定事例
npx tsx research/sky-beta2/cases.ts > research/sky-beta2/cases.json
python3 research/sky-beta2/tools/cases_txt.py research/sky-beta2/cases.json > /tmp/cases.txt
# 2) OpenGL 参照（libegl-dev・libgl-dev。画面なしで Mesa の llvmpipe）
sh research/sky-beta2/opengl/build.sh /tmp/b2          # → /tmp/b2/kochi_ref
/tmp/b2/kochi_ref /tmp/cases.txt /tmp/b2/lum luminance  # 事前計算は llvmpipe で数分
/tmp/b2/kochi_ref /tmp/cases.txt /tmp/b2/rad radiance
# 3) 比較ページのデータと JS
python3 research/sky-beta2/tools/pack.py /tmp/b2/lum /tmp/b2/rad research/sky-beta2/cases.json research/sky-beta2/webgl/data
npx esbuild research/sky-beta2/webgl/compare.ts --bundle --format=iife --target=es2020 --outfile=research/sky-beta2/webgl/compare.js
# 4) Chromium で確かめる（WebGL 2 は SwiftShader）
python3 research/sky-beta2/tools/check_web.py research/sky-beta2/webgl /tmp/b2/shots
```

`webgl/data/`（表 約 17 MB）と `compare.js` はリポジトリに入れない。iPhone では、同じものを置いた非公開のページで開く。

## エアロゾルの高度分布（CAMS aerext532）

- `opengl/kochi_ref` の 6 番目の引数：尺度高（km、例 `1.2`）か、2 層の形 `W,S1,S2`（km。高さ W で最大、下は exp((h−W)/S1)、上は exp(−(h−W)/S2)）。
  5 番目までは `AOD550 α`。例：`kochi_ref cases.txt out luminance 0.17 1.3 2,0.7,1.0`（`0,1,1.2` は尺度高 1.2 km と同じ結果になることを確かめた）
- `tools/cams_aer_profile.py`：ADS（Copernicus Atmosphere Data Store）から 11/13 の aerext532（137 層）・気温・比湿・地上気圧を取り（`fetch`、ADS のアカウントと鍵が要るので手元の PC で）、
  高知の格子の列の高さごとの消散係数から、532 nm の光学的厚さ、地表〜1 km・1〜3 km・3 km より上の寄与、2 層の形の W・S1・S2 を出す（`profile`）

## 結果

[results.md](results.md)
