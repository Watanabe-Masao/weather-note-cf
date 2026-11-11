import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTokens } from "./design/tokens";
import "./styles.css";

// The design tokens become CSS custom properties before anything is drawn.
applyTokens();

// A long press on a graph scrubs it: no long-press menu anywhere outside the fields people type into.
document.addEventListener("contextmenu", (e) => {
  if (!(e.target as HTMLElement).closest("input, textarea, select, a")) e.preventDefault();
});

// Installable app (PWA): the service worker only serves the page and its files (never the API).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Without it the app still works as a page.
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
