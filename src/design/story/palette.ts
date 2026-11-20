// 満月の物語の絵本の色（2026-11-20 渡辺さん「物語の魅せ方にこだわって」、見本の「開いた本」）：紺の夜、金の飾り、
// 生成りの紙。物語のページ（src/ui/MoonStory.tsx）は、これを CSS の変数に入れて使う（画面のコードに色を書かない）。
export const BOOK = {
  /** 表紙の革（上・下）。 */
  cover: ["#1d2f63", "#0e1a3d"] as [string, string],
  /** 金の飾り（明るい・濃い）。 */
  gold: ["#f1d38a", "#b98a3a"] as [string, string],
  /** 紙（明るい・縁）。 */
  paper: ["#f6ecd6", "#e2cfa6"] as [string, string],
  /** 紙の上の文字。 */
  ink: "#3a2c1c",
  /** 夜の地（物語のページの背景）。 */
  night: ["#0a1430", "#050b1c"] as [string, string],
  /** 浮かぶ月（物語の月から今夜の情報の月へ移る）：明るい・中・縁。 */
  moon: ["#fff6d8", "#f6dc98", "#d9b062"] as [string, string, string],
  /** 本棚の板（明るい・暗い）。 */
  wood: ["#6b4a2f", "#3e2a1a"] as [string, string],
  /** 本の背の革（本棚に並ぶ満月の物語。月ごとに少しずつ違う色）。 */
  spines: ["#1d2f63", "#2a4a3f", "#5a2733", "#3b3060", "#1f4458", "#4a3a22", "#283a6e", "#3d2a48", "#2e4a2a", "#5b3a1e", "#4a2a2a", "#22385a", "#33304a", "#1a3a52"] as string[],
  /** しおりのリボン。 */
  ribbon: "#8c2f3a",
} as const;
