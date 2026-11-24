// 予報の移り変わりで選んだ発表の回（2026-11-23）：1つの日に1つ。「この日の予報の移り変わり」で回を押すと
// ここに入り、時間帯のグラフ（気象庁の3時間ごとの気温）も同じ回を出す。選ぶ場所は1か所なので、2つの画面で
// 違う回が出ることはない。開いている間だけ覚える（保存しない）。何も選んでいない日は、それぞれの初めの見え方
// （移り変わりはいちばん新しい回、時間帯のグラフは朝5時の府県天気予報）。

import { useSyncExternalStore } from "react";

const picks = new Map<string, string>();
const listeners = new Set<() => void>();
const keyOf = (station: string, date: string) => `${station}/${date}`;

export function pickedIssue(station: string, date: string): string | null {
  return picks.get(keyOf(station, date)) ?? null;
}

export function pickIssue(station: string, date: string, slotKey: string | null): void {
  const k = keyOf(station, date);
  if ((picks.get(k) ?? null) === slotKey) return;
  if (slotKey) picks.set(k, slotKey);
  else picks.delete(k);
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function usePickedIssue(station: string, date: string): string | null {
  return useSyncExternalStore(subscribe, () => pickedIssue(station, date));
}
