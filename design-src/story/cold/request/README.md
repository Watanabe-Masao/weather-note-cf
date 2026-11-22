# コールドムーン　素材の依頼

版：v0.3（2026-11-22）
v0.3 の変更（11/22 独立レビューへの判断、渡辺さん承認）：納品の決まり（解像度・基準の姿勢・置く位置の目印・透明の縁・拡大の上限）と、12/10 の判定を足した。
v0.2 の変更（11/22）：A-10（閉じた本の表の型押し）を足した。検収に主人公の大きさを足した。鳴き声の表記は決まった（下）。
締め切り：**12/10 ごろ**（承認B 済みの範囲 A-01〜A-09 に、11/22 に A-10 を足した。画像は基本12枚：A-06 が2枚、A-08 が3枚、A-07 は条件付きで数えない）
関連：Project の `claude/満月の物語/コールドムーン_絵コンテと本文.md`（素材の一覧）・`コールドムーン_実装計画.md`（PR-2）。この依頼書の正本は Project の `claude/満月の物語/コールドムーン_素材の依頼.md`（リポジトリのこの写しは、見本と一緒に渡すためのもの）。

## 見本（このフォルダの samples/）

依頼先には、この依頼書と一緒に samples/ の画像を渡す。どれもビーバームーンの素材（`design-src/story/beaver/`）を長い辺 640px に縮めた見本で、絵柄・塗り・透明の切り抜き・型押しの作りをそろえるためのもの（コールドムーンの絵として使うものではない）。

| ファイル | 見本にすること | 元の絵 |
|---|---|---|
| `samples/overview.png` | 4枚を並べた一覧（格子は透明の部分） | ― |
| `samples/s1-hero-look.png` | 主人公の絵柄：やわらかい塗り、毛のこまかい質感、丸みのある形、目の描き方 → A-01〜A-03・A-06・A-07 | `beaver/pack/hero-look.png` |
| `samples/s2-tree.png` | 背景の木の描き込みの細かさと、透明の切り抜き → A-05・A-08・A-09 | `beaver/pack/tree.png` |
| `samples/s3-a03-snow-lodge.png` | 雪の描き方（雪の白さ・やわらかい影） → A-05・A-08・A-09 | `beaver/pack2/a03-snow-lodge.png` |
| `samples/s4-b08-emboss-medal.png` | 閉じた本の表の型押しの作り（金・紺の革・浮き彫り） → A-10 | `beaver/pack3/b08-emboss-medal.png` |

元の大きさの絵が要るときは、`design-src/story/beaver/` の元の絵を渡す。

## 共通の要件（全部の画像）

- **絵柄はビーバームーンの素材と同じ**：やわらかい塗りの児童書のイラスト。毛や羽のこまかい質感、丸みのあるかわいい形、影はやわらかく、線は目立たせない。見本は samples/（上の表）。
- **背景は透明の PNG**（できなければ、無地の濃い紺の背景。四隅の色を手がかりにアプリの側で透かす）。
- **文字を入れない**。
- 一枚に一つ（シートにまとめない）。大きさは長い辺 1500px 前後。
- 季節は初冬の北米。**日本の冬の物（柚子・こたつ・門松など）とクリスマスの飾りを入れない**。
- 月は描かない（アプリが描く）。光の当たり方は昼のやわらかい光で描き、夜や朝の色はアプリの側で重ねる。

## 優先度と一覧

| 優先 | ID | 枚 | 内容 | 依頼文（そのまま使える案） |
|---|---|---|---|---|
| 最優先 | A-01 | 1 | コガラ：枝にとまる（右向き・横から） | A tiny black-capped chickadee perched on a thin bare branch, facing right, side view. Black cap and black bib, bright white cheeks, soft grey back and wings, pale buff-orange flanks, round fluffy body, clear dark eye. Soft painterly children's picture-book style, gentle shading, no outlines, no text, transparent background. |
| 最優先 | A-03 | 1 | コガラ：種をくわえて縦の幹にとまる | The same black-capped chickadee clinging sideways to a vertical birch trunk, holding one small striped sunflower seed in its beak, about to tuck it into a crack in the bark. Same style and colors as before, no text, transparent background. |
| 最優先 | A-05 | 1 | 穴のあるシラカバの幹（縦長） | A tall section of a white birch trunk with black markings and peeling bark, a small round woodpecker hole in the middle with a dark interior large enough for a small bird, fresh snow resting on one side of the trunk. Soft painterly picture-book style, no text, transparent background. |
| 最優先 | A-06 | 2 | コガラ：穴の中で丸くふくらむ（目を閉じた版・開いた版） | The black-capped chickadee seen from the front, feathers fluffed up into a round ball for a cold night, (1) eyes closed, sleeping peacefully / (2) eyes softly open, looking up. Only the bird, so it can be placed inside a tree hole. Same style, no text, transparent background. |
| 最優先 | A-08 | 3 | 雪の森の背景：遠景・中景・近景 | (far) Low snowy hills and a distant line of bare deciduous trees, pale winter sky band at the bottom only. (middle) A mixed winter woodland of white birches and bare deciduous trees with a few small evergreens, snow on the ground, open snowy meadow in front. (near) Snow-covered ground with small mounds and dry grass tips. Each layer as a separate wide image (about 3:1), North American early winter, soft painterly picture-book style, no animals, no moon, no text, transparent above the scenery. |
| 次 | A-02 | 1 | コガラ：跳ねる瞬間 | The same chickadee in mid-hop just above a branch, feet lifted, wings slightly open. Same style, no text, transparent background. |
| 次 | A-04 | 1 | 種（ひまわりの種のような一粒） | One small black-and-white striped sunflower seed. Same style, no text, transparent background. |
| 次 | A-09 | 1 | 雪をかぶった前景の枝 | A bare birch branch heavy with soft snow, entering from the left edge, to frame the corner of a picture. Same style, no text, transparent background. |
| 次 | A-10 | 1 | 閉じた本の表の型押し（ビーバームーンの B-08 と同じ作り） | A round embossed medallion for a book cover: the silhouette of a small chickadee on a branch (or a single snowflake), raised relief with soft highlights and shadows, gold-leaf look on dark navy leather. Same size and look as the beaver medallion (b08-emboss-medal). No text, transparent background. |
| 条件付き | A-07 | （0〜1） | 朝の光のコガラ | アプリで A-01 に朝の色を重ねて不自然なときだけ。先に A-01 で試してから頼む。 |

## 納品の決まり（11/22）

| 項目 | 決まり |
|---|---|
| 解像度 | 元の絵は長い辺 1500〜2000px の PNG（透明）。アプリに入れる webp は長い辺 360〜600px（ビーバームーンと同じ。`node scripts/story-assets.ts cold` で作る） |
| 表示の大きさ | 画面で表示する最大の大きさ（CSS px）の **3倍以上** の画素が webp にあること（端末の画素密度 3 で拡大しない）。コガラ1羽は画面で最大 約 120px → webp で 360px 以上 |
| 拡大の上限 | アプリで素材を拡大するのは webp の画素の 1.0 倍まで（3倍密度の画面で）。足りないときは webp を作り直す（拡大でぼかさない） |
| 基準の姿勢 | コガラは A-01 を基準（右向き・横から、体の傾き 0°）。ほかの姿は A-01 と同じ大きさの比で描く（頭の幅を同じに） |
| 置く位置の目印 | 鳥は足が枝に触れる点、幹は根元の中心、穴は穴の口の中心を、画像ごとに画素の座標で記録する（受け取ったときにこちらで測って `storyAssets.ts` に書く） |
| 透明の縁 | 縁は 1〜2px のやわらかい境目。白や紺の縁取り（ハロー）を残さない。絵の外に、長い辺の 2% 以上の透明の余白 |
| 色 | sRGB。夜や朝の色はアプリで重ねるので、素材は昼のやわらかい光のまま |
| 名前 | `c01-perch.png` のように ID と短い英語（ビーバームーンの `b08-emboss-medal.png` と同じ形） |

## 12/10 の判定（使う素材を決める日）

12/10 の時点で、次の3つで決める（実装計画「12/10 の判定」と同じ）。
1. **最優先の素材（A-01・A-03・A-05・A-06・A-08）がそろい、検収に通っている** → PR-2（場面）へ進む。
2. 最優先の一部が欠ける・検収に通らない → 欠けたページは今の場面なしの形（PR-1 の形）でよいかを判断。全体の流れが崩れるなら、場面なしで 12/22 に出し、場面は後から入れる。
3. 次・条件付きの素材（A-02・A-04・A-07・A-09・A-10）が欠けても PR-2 は進める（代わりの絵・共通の型押しで出す）。

## 届いたら確かめること（検収）

- コガラの羽の色が実際の鳥と合うか（黒い頭と喉、白い頬、灰色の背、淡い黄褐色の脇）。A-01・A-02・A-03・A-06 で同じ一羽に見えるか。
- A-06 を A-05 の穴に重ねたとき、穴の大きさと合うか。月明かりの青い色を重ねても読めるか。
- 背景はシラカバのまじる林で、針葉樹だけの森になっていないか（事実シート C-12）。
- **9ページを通したカメラ構図で**：主役が小さすぎないか、前景の枝が後半のページまで残らないか（docs/moon-story.md「素材」）。とくに9ページの遠景で、幅 360 でも黒い帽子と白い頬が見分けられるか。
- A-10 を閉じた本の表に置いたとき、ビーバームーンの型押しと並べて同じ作りに見えるか。

## 素材の前に確かめること

- 済み（11/21 21:15）：9ページの鳴き声は、夜明けの一羽のさえずり「フィーチー、フィーチー。」（「チカディー」は警戒・連絡の声なので使わない。事実シート F-38、#423）。
