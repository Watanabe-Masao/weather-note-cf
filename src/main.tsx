import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTokens } from "./design/tokens";
import { startPwa } from "./pwa";
import "./styles.css";

// The design tokens become CSS custom properties before anything is drawn.
applyTokens();

// A long press on a graph scrubs it: no long-press menu anywhere outside the fields people type into.
document.addEventListener("contextmenu", (e) => {
  if (!(e.target as HTMLElement).closest("input, textarea, select, a")) e.preventDefault();
});

// Installable app (PWA): the service worker only serves the page and its files (never the API);
// a new version is looked for on resume and taken out of sight (pwa.ts).
if (import.meta.env.PROD) startPwa();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
