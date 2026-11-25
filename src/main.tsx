import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./data/queryClient";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { resolveTheme, saveChoice, savedChoice, ThemeContext, type ThemeChoice } from "./design/theme";
import { applyTheme } from "./design/tokens";
import { startPwa } from "./pwa";
import "./styles.css";

// The design tokens (the chosen theme's) become CSS custom properties before anything is drawn.
applyTheme(resolveTheme(savedChoice()));

// A long press on a graph scrubs it: no long-press menu anywhere outside the fields people type into.
document.addEventListener("contextmenu", (e) => {
  if (!(e.target as HTMLElement).closest("input, textarea, select, a")) e.preventDefault();
});

// Installable app (PWA): the service worker only serves the page and its files (never the API);
// a new version is looked for on resume and taken out of sight (pwa.ts).
if (import.meta.env.PROD) startPwa();

/**
 * The theme (#241): a change puts the new colours in use and draws the whole app again (nothing in
 * it is memoised by props), so the SVG charts, which read colour values rather than CSS, take them
 * too — without losing where the person is (an open sheet stays open). System follows the phone.
 */
function Root() {
  const [choice, setChoice] = useState<ThemeChoice>(savedChoice);
  const [dark, setDark] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    if (choice !== "system" || typeof matchMedia !== "function") return;
    const m = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(m.matches);
    on(); // the phone may have changed while another theme was chosen
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [choice]);
  const theme = resolveTheme(choice, dark);
  applyTheme(theme);
  const set = (c: ThemeChoice) => {
    saveChoice(c);
    setChoice(c);
  };
  return (
    <ThemeContext.Provider value={{ choice, set }}>
      <App theme={theme} />
    </ThemeContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
);
