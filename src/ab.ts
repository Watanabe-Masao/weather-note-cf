// A/B comparisons while designing: each open question gets a key with variants A (current)
// and B (proposal). The switch is shown on preview builds and locally (or with ?ab on production),
// and the choice is remembered on this device so a reload keeps it.

import { useCallback, useState } from "react";

export type AbKey = "drumLink";
export type Variant = "A" | "B";

export const AB_QUESTIONS: Record<AbKey, { title: string; A: string; B: string }> = {
  drumLink: {
    title: "中央の帯",
    A: "見出しは上のまま、帯が通り抜ける",
    B: "比較日の見出しを下へ（上下対称）",
  },
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

/** Current variants; production without ?ab always runs A (the shipped behaviour). */
export function useAb() {
  const [chosen, setChosen] = useState(load);
  const variant = useCallback((key: AbKey): Variant => (abVisible() ? (chosen[key] ?? "B") : "A"), [chosen]);
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
