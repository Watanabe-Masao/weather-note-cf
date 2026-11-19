// イベントの日の見出しの絵を、元の画像（design-src/event/<種類>-<テーマ>.png）から配る形（public/event/<種類>-<テーマ>.webp、
// 640×160・40KB まで）に整える（docs/event-banner.md の E-01）。手で走らせ、出来た物はリポジトリに置く。
//
//   node scripts/event-images.ts            （全部）
//   node scripts/event-images.ts beaver     （その種類だけ）
//
// 元の画像は縦横の比が少し違ってもよい：高さを合わせ、横は真ん中で切る（左の絵と右の文字が残る）。webp は Playwright の
// Chromium のキャンバスで書く（新しいライブラリは使わない。scripts/brand-icons.ts と同じ）。重さが上限を超えたら質を下げて
// 書き直し、それでも超えたら止まる。

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { EVENT_ART, EVENT_ART_MAX_BYTES, EVENT_ART_SIZE, EVENT_ART_THEMES, type EventArtKey } from "../src/design/eventAssets.ts";

const only = process.argv[2];
const keys = (Object.keys(EVENT_ART) as EventArtKey[]).filter((k) => EVENT_ART[k] && (!only || k === only));
mkdirSync("public/event", { recursive: true });

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");
const { width: W, height: H } = EVENT_ART_SIZE;
let wrote = 0;
for (const key of keys) {
  for (const theme of EVENT_ART_THEMES) {
    const src = `design-src/event/${key}-${theme}.png`;
    if (!existsSync(src)) throw new Error(`${src} がありません`);
    const png = readFileSync(src).toString("base64");
    let bytes: Buffer | null = null;
    for (const q of [0.86, 0.8, 0.72, 0.64]) {
      const url: string = await page.evaluate(
        async ({ png, W, H, q }: { png: string; W: number; H: number; q: number }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${png}`;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = W;
          c.height = H;
          const g = c.getContext("2d")!;
          g.imageSmoothingQuality = "high";
          const s = H / img.naturalHeight;
          const w = img.naturalWidth * s;
          g.drawImage(img, (W - w) / 2, 0, w, H);
          return c.toDataURL("image/webp", q);
        },
        { png, W, H, q },
      );
      bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
      if (bytes.length <= EVENT_ART_MAX_BYTES) break;
    }
    if (!bytes || bytes.length > EVENT_ART_MAX_BYTES) throw new Error(`${key}-${theme} が ${EVENT_ART_MAX_BYTES} バイトに収まりません`);
    writeFileSync(`public/event/${key}-${theme}.webp`, bytes);
    wrote++;
    console.log(`${key}-${theme}.webp ${Math.round(bytes.length / 100) / 10}KB`);
  }
}
await browser.close();
console.log(`public/event に ${wrote} 枚を書いた`);
