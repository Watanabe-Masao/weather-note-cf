// ホーム画面・ブラウザのタブのアイコンを、src/design/brand.ts の絵から書き出す（Midnight だけ）。手で1回走らせ、
// 出来た物はリポジトリに置く（public/icons）。
//
//   node scripts/brand-icons.ts      （Node 22 の型の読み飛ばし。PNG は Playwright の Chromium で描く）

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { brandIconSvg } from "../src/design/brand.ts";

const svg = brandIconSvg("navy", { rx: 0, id: "wn" });
writeFileSync("public/icons/icon.svg", svg);
writeFileSync("public/icons/maskable.svg", svg);

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["maskable-512.png", 512], ["apple-touch-icon.png", 180]] as const) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: `public/icons/${file}`, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log("public/icons を書いた");
