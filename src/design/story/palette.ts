// 満月の物語の絵本の色（2026-11-20 渡辺さん「物語の魅せ方にこだわって」、見本の「開いた本」）：紺の夜、金の飾り、
// 生成りの紙。物語のページ（src/ui/MoonStory.tsx）は、これを CSS の変数に入れて使う（画面のコードに色を書かない）。
export const BOOK = {
  /** 表紙の革（上・下）。 */
  cover: ["#1d2f63", "#0e1a3d"] as [string, string],
  /** 金の飾り（明るい・濃い）。 */
  gold: ["#f1d38a", "#b98a3a"] as [string, string],
  /** 金の箔の光と影（11/20 20:09 渡辺さん「フォントや金の縁など立体感」）：光の色・箔の奥・押した溝の影。 */
  goldShine: "#fff3cf",
  goldDeep: "#7a5422",
  engrave: "#140c04",
  /** 型押しの光（閉じた本の表のメダル：絵の明るさを高さにして、左上から照らす）。 */
  embossLight: "#ffffff",
  /** 押した溝の薄い影・箔の淡い光・箔の光（重ねる用の透け色）。 */
  engraveSoft: "#140c048c",
  shineFaint: "#fff3cf1f",
  shineSoft: "#fff3cf59",
  /** 紙（明るい・縁）。 */
  paper: ["#f6ecd6", "#e2cfa6"] as [string, string],
  /** 古い紙（11/20 20:43「古文書」）：しみ・焼けた縁・墨のにじみ・朱の印。 */
  stain: "#a8763a38",
  edge: "#7a4a1e",
  inkBleed: "#3a2c1c55",
  seal: "#a3362b",
  /** 紙のページの象徴の言葉の札の地。 */
  tag: "#e6d2a866",
  /** 紙の上の文字。 */
  ink: "#3a2c1c",
  /** 夜の地（物語のページの背景）。 */
  night: ["#0a1430", "#050b1c"] as [string, string],
  /** 空の色が進む（11/21）：表紙のあたりの夕方（上・下）と、締めくくりから先の深夜（上・下）。 */
  dusk: ["#2a2752", "#5b3c5c"] as [string, string],
  deep: ["#04081a", "#01030a"] as [string, string],
  /**
   * コールドムーンの空の流れ（11/23 PR-3、実装計画 v0.2）：昼 → 夕 → 夜 → 夜明け。表紙のあたりは冬の夕方の青、場面を読み終える
   * ころは夜明けの色、あとがきから先は夜明けのまま薄く明ける（第一案）。地の上の文字が読めるよう、どれも暗めに。
   */
  coldStart: ["#1f2d5c", "#4a5a8c"] as [string, string],
  coldDawn: ["#22336a", "#6b5f8e"] as [string, string],
  coldAfter: ["#2a3c74", "#7d6c98"] as [string, string],
  /** 読み終わりのしおり（金の細い帯の地）。 */
  bookmark: "#c99a45",
  /** 浮かぶ月（物語の月から今夜の情報の月へ移る）：明るい・中・縁。 */
  moon: ["#fff6d8", "#f6dc98", "#d9b062"] as [string, string, string],
  /** 型押しの月（本の背の上の丸、明るい・暗い）。 */
  emboss: ["#d4d8e6", "#6e7796"] as [string, string],
  /** 本棚の板（明るい・暗い）。 */
  wood: ["#6b4a2f", "#3e2a1a"] as [string, string],
  /** 本の背の革（本棚に並ぶ満月の物語。月ごとに少しずつ違う色）。 */
  spines: [
    "#1b2a52",
    "#22424a",
    "#5a2a24",
    "#3e2a4e",
    "#2a4430",
    "#5a2226",
    "#1c2a54",
    "#3a2a48",
    "#33452a",
    "#5a3418",
    "#3d2a20",
    "#1e2a50",
    "#1a2c5a",
    "#16244a",
  ] as string[],
  /** しおりのリボン。 */
  ribbon: "#8c2f3a",
} as const;
