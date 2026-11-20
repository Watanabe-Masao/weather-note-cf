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
  /** しおりのリボン。 */
  ribbon: "#8c2f3a",
} as const;
