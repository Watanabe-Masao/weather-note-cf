// 「この日として見出しを表示」（2026-11-20、docs/event-banner.md 5章）：見出しだけを、選んだ日のイベントにする。
// 天気のデータやほかの画面は替えない。端末に保存せず、アプリを開き直すと元に戻る（このページの間だけの値）。
import { useSyncExternalStore } from "react";

let previewDate: string | null = null;
const listeners = new Set<() => void>();

export function setPreviewDate(date: string | null): void {
  previewDate = date;
  for (const f of listeners) f();
}

export function usePreviewDate(): string | null {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => previewDate,
  );
}
