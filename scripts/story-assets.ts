// 満月の物語の絵の素材を切り出して配る形にする（src/design/story/storyAssets.ts の台帳）。手で走らせ、出来た物は
// リポジトリに置く。
//   node scripts/story-assets.ts            （全部）
//   node scripts/story-assets.ts beaver     （その満月だけ）
// 元：design-src/story/<満月>/sheet.png。枠で切り、key の素材は背景の紺（枠の四隅の色）に近いほど透かす。
// webp は Playwright の Chromium のキャンバスで書く（新しいライブラリは使わない。scripts/event-images.ts と同じ）。
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { STORY_ASSETS } from "../src/design/story/storyAssets.ts";

const only = process.argv[2];
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");
for (const [moon, assets] of Object.entries(STORY_ASSETS)) {
  if (only && moon !== only) continue;
  const sheet = `design-src/story/${moon}/sheet.png`;
  mkdirSync(`public/event/story/${moon}`, { recursive: true });
  for (const [name, a] of Object.entries(assets)) {
    const png = readFileSync(a.file ?? sheet).toString("base64");
    const url: string = await page.evaluate(
      async ({ png, a }: { png: string; a: { rect?: number[]; key?: boolean; width?: number; quality?: number } }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const [x, y, w, h] = a.rect ?? [0, 0, img.naturalWidth, img.naturalHeight];
        const W = Math.min(a.width ?? w, w);
        const H = Math.round((h * W) / w);
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d")!;
        g.imageSmoothingQuality = "high";
        g.drawImage(img, x, y, w, h, 0, 0, W, H);
        if (a.key) {
          // 背景の紺：四隅の平均。そこからの色の距離で透かす（近いほど透明、なめらかに）。
          const d = g.getImageData(0, 0, W, H);
          const p = d.data;
          const at = (i: number) => [p[i], p[i + 1], p[i + 2]];
          const corners = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + W - 1) * 4].map(at);
          const bg = [0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / 4);
          for (let i = 0; i < p.length; i += 4) {
            const dist = Math.hypot(p[i] - bg[0], p[i + 1] - bg[1], p[i + 2] - bg[2]);
            const t = Math.min(1, Math.max(0, (dist - 18) / 50));
            p[i + 3] = Math.round(p[i + 3] * t * t * (3 - 2 * t));
          }
          g.putImageData(d, 0, 0);
        }
        return c.toDataURL("image/webp", a.quality ?? 0.9);
      },
      { png, a },
    );
    const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    writeFileSync(`public/event/story/${moon}/${name}.webp`, bytes);
    console.log(`${moon}/${name}.webp ${Math.round(bytes.length / 100) / 10}KB`);
  }
}
await browser.close();
