// イベントの日の見出しの絵の台帳（src/design/eventAssets.ts、docs/event-banner.md 6章）：呼び名と一対一、台帳にある絵は
// テーマごとに揃っていて、形（640×160）と重さ（40KB まで）が決まりどおり。元の画像もある。
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_ART, EVENT_ART_MAX_BYTES, EVENT_ART_SIZE, EVENT_ART_THEMES, eventArt, eventArtKey, eventIcon, EVENT_ICON_MAX_BYTES, EVENT_ICON_SIZE, FULL_MOON_ART, type EventArtKey } from "../../src/design/eventAssets";
import { FULL_MOON_NAMES } from "../../shared/fullMoonNames";

/** webp の幅と高さ（VP8・VP8L・VP8X の頭から）。 */
function webpSize(b: Buffer): { width: number; height: number } {
  expect(b.toString("ascii", 0, 4)).toBe("RIFF");
  expect(b.toString("ascii", 8, 12)).toBe("WEBP");
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  throw new Error(`webp の形が読めない: ${chunk}`);
}

describe("event art", () => {
  it("満月の呼び名と絵の種類が一対一（呼び名を足して台帳を足し忘れると落ちる）", () => {
    expect(Object.keys(FULL_MOON_ART).sort()).toEqual(FULL_MOON_NAMES.map((n) => n.name).sort());
    expect(new Set(Object.values(FULL_MOON_ART)).size).toBe(FULL_MOON_NAMES.length);
  });

  it("台帳にある絵は3テーマとも揃っていて、640×160・40KB まで。元の画像もある", () => {
    const present = (Object.keys(EVENT_ART) as EventArtKey[]).filter((k) => EVENT_ART[k]);
    expect(present.length).toBeGreaterThan(0);
    for (const key of present)
      for (const theme of EVENT_ART_THEMES) {
        const file = `public/event/${key}-${theme}.webp`;
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size, file).toBeLessThanOrEqual(EVENT_ART_MAX_BYTES);
        expect(webpSize(readFileSync(file)), file).toEqual(EVENT_ART_SIZE);
        expect(existsSync(`design-src/event/${key}-${theme}.png`), key).toBe(true);
      }
  });

  it("説明の上の四角い絵（台帳の icon）は 256×256・40KB まで、元の画像もある。無い種類は null（帯の絵の左を切り出す）", () => {
    const withIcon = (Object.keys(EVENT_ART) as EventArtKey[]).filter((k) => EVENT_ART[k]?.icon);
    expect(withIcon.length).toBe(13); // 満月12種類とブルームーン（11/20 渡辺さんの絵）
    for (const key of withIcon) {
      const file = `public/event/${key}-icon.webp`;
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size, file).toBeLessThanOrEqual(EVENT_ICON_MAX_BYTES);
      expect(webpSize(readFileSync(file)), file).toEqual({ width: EVENT_ICON_SIZE, height: EVENT_ICON_SIZE });
      expect(existsSync(`design-src/event/${key}-icon.png`), key).toBe(true);
    }
    expect(eventIcon({ kind: "full", name: "ビーバームーン", blue: false })).toBe(`/event/beaver-icon.webp?v=${EVENT_ART.beaver!.icon}`);
    expect(eventIcon({ kind: "full", name: null, blue: true })).toMatch(/^\/event\/blue-icon\.webp/);
    expect(eventIcon({ kind: "lunar-total", name: "ウルフムーン", blue: false })).toBeNull();
  });

  it("イベントから絵：満月は呼び名、ブルームーンは blue、食は食の種類。版つきの URL。呼び名の分からない満月は null（手描きの帯）", () => {
    const beaver = { kind: "full" as const, name: "ビーバームーン", blue: false };
    expect(eventArtKey(beaver)).toBe("beaver");
    expect(eventArt(beaver, "navy")).toEqual({ src: `/event/beaver-navy.webp?v=${EVENT_ART.beaver!.rev}`, text: "baked" });
    expect(eventArtKey({ kind: "full", name: "ブルー", blue: true })).toBe("blue");
    expect(eventArtKey({ kind: "lunar-total", name: "ワームムーン", blue: false })).toBe("lunar-total");
    // コーンムーンと食はコードで描いた文字なしの絵（アプリが文字を重ねる）。
    expect(eventArt({ kind: "full", name: "コーンムーン", blue: false }, "mist")?.text).toBe("overlay");
    expect(eventArt({ kind: "solar-partial", name: null, blue: false }, "warm")?.text).toBe("overlay");
    expect(eventArt({ kind: "full", name: null, blue: false }, "mist")).toBeNull();
  });
});
