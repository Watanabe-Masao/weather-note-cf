import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTokens } from "./design/tokens";
import "./styles.css";

// The design tokens become CSS custom properties before anything is drawn.
applyTokens();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
