// TanStack Query の見本（2026-11-25 渡辺さん「状態管理が複雑になってきているのであればライブラリの検討も」「両方お願いします」）。
// 取ってきたデータの取り置き・古さ・取り直し・失敗時に前の値を残すことを、1つの仕組みにまとめる。まずは予報の移り変わりだけ。
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // アプリに戻ったとき・つながり直したときに、古くなっていれば取り直す（今までの visibilitychange と同じ）。
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
      // 見ていない日の取り置きは30分で手放す（今までは開いている間ずっと持っていた）。
      gcTime: 30 * 60_000,
    },
  },
});
