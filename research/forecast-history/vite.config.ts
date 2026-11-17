// 予報の履歴 R6 の見本を1つのページに組む（アプリの build とは別。Cloudflare の plugin は使わない）。
//   npx vite build --config research/forecast-history/vite.config.ts
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./sample", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL("./dist", import.meta.url)), emptyOutDir: true },
});
