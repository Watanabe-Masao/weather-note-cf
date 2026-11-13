// Writes research/sky/colour-chart.html from shared/sky.ts (see colour-chart.ts).
// Run:  research/data/node_modules/.bin/vite-node research/sky/write-colour-chart.ts

import { writeFileSync } from "node:fs";
import { colourChartHtml } from "./colour-chart";

const out = new URL("./colour-chart.html", import.meta.url);
writeFileSync(out, colourChartHtml());
console.log("wrote", out.pathname);
