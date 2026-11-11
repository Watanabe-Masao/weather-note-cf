import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Writes the list of every built file (/assets/*) and a version made from it into the service
 * worker (`public/sw.js`, placeholders `__ASSETS__` and `__VERSION__`).
 *  - Every file is cached at install, including the ones the page loads later (the β fitting
 *    worker), so the app works offline in full, not only the first screen.
 *  - Each deploy changes the worker's bytes, so the browser installs the new worker, which caches
 *    the new files and then drops the old ones (no cache that only grows).
 */
function serviceWorkerManifest(): Plugin {
  let outDir = "";
  return {
    name: "weather-note-sw-manifest",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    async closeBundle() {
      if (this.environment && this.environment.name !== "client") return;
      const dir = this.environment?.config.build.outDir ?? outDir;
      const sw = join(dir, "sw.js");
      const src = await readFile(sw, "utf8").catch(() => null);
      if (src == null || !src.includes("__ASSETS__")) return;
      const assets = (await readdir(join(dir, "assets"))).sort().map((f) => `/assets/${f}`);
      const version = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 12);
      await writeFile(sw, src.replace('"__ASSETS__"', JSON.stringify(assets)).replace("__VERSION__", version));
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflare(), serviceWorkerManifest()],
});
