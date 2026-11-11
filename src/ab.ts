// A/B comparisons while designing: each open question has variants A (as now) and B (a proposal).
// The switch shows on preview builds and locally (or with ?ab on production); the choice is
// remembered on this device so a reload keeps it. Production without ?ab always runs A.

import { createContext, useCallback, useContext, useState } from "react";

export type AbKey = "feelSwipe" | "diffRow" | "focusDays" | "pinLine";
export type Variant = "A" | "B";

export const AB_QUESTIONS: Record<AbKey, { title: string; A: string; B: string }> = {
  feelSwipe: { title: "肌感マップ", A: "日の切り替えは表で", B: "マップを横スワイプで日を切り替え" },
  diffRow: { title: "比較差の行", A: "なし", B: "比較の表の下に「差」の行" },
  focusDays: { title: "表に集中", A: "7日", B: "9日（文字を少し小さく）" },
  pinLine: { title: "固定の1行", A: "上に重ねる", B: "場所を空けて重ねない" },
};

const PRODUCTION = "weather-note-cf.watanabe-masao0804.workers.dev";
const KEY = "weather-note:ab";

export const abVisible = () => {
  try {
    return location.hostname !== PRODUCTION || new URLSearchParams(location.search).has("ab");
  } catch {
    return false;
  }
};

function load(): Partial<Record<AbKey, Variant>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export interface Ab {
  variant: (key: AbKey) => Variant;
  choose: (key: AbKey, v: Variant) => void;
}

export function useAbState(): Ab {
  const [chosen, setChosen] = useState(load);
  const variant = useCallback((key: AbKey): Variant => (abVisible() ? (chosen[key] ?? "A") : "A"), [chosen]);
  const choose = useCallback((key: AbKey, v: Variant) => {
    setChosen((c) => {
      const next = { ...c, [key]: v };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Not remembering is harmless.
      }
      return next;
    });
  }, []);
  return { variant, choose };
}

export const AbContext = createContext<Ab>({ variant: () => "A", choose: () => {} });
/** True when variant B of `key` is on. */
export const useB = (key: AbKey) => useContext(AbContext).variant(key) === "B";
