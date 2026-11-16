// テーマの選択 (#241): Deep Navy / Mist Green / Warm White, or System (the phone's light or dark:
// Warm White or Deep Navy). Kept on this device (localStorage), put in use before anything is drawn,
// and on a change the app is drawn again (src/main.tsx) so SVG charts take the new colours too.

import { createContext, useContext } from "react";
import { THEME_NAMES, type ThemeName } from "./tokens";

export type ThemeChoice = ThemeName | "system";
const KEY = "weather-note-theme";

export function savedChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "system" || THEME_NAMES.includes(v as ThemeName)
      ? (v as ThemeChoice)
      : "navy";
  } catch {
    return "navy";
  }
}

export function saveChoice(c: ThemeChoice) {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    // Not kept (a private window): it still holds for this visit.
  }
}

const prefersDark = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-color-scheme: dark)").matches;
/** The theme a choice means now. */
export const resolveTheme = (
  c: ThemeChoice,
  dark = prefersDark(),
): ThemeName => (c === "system" ? (dark ? "navy" : "warm") : c);

export const ThemeContext = createContext<{
  choice: ThemeChoice;
  set: (c: ThemeChoice) => void;
}>({ choice: "navy", set: () => {} });
export const useThemeChoice = () => useContext(ThemeContext);
