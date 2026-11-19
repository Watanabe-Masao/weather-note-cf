import { describe, expect, it } from "vitest";
import { skyEventOn } from "../../shared/skyEvents";

const KOCHI = { lat: 33.567, lon: 133.548 };
const on = (d: string) => skyEventOn(d, KOCHI.lat, KOCHI.lon);

describe("空のイベント（11/20、見出しのロゴ）", () => {
  it("満月の日は満月と呼び名、前後の日は無し", () => {
    expect(on("2026-11-24")).toMatchObject({ kind: "full", name: "ビーバームーン" });
    expect(on("2026-11-23")).toBeNull();
    expect(on("2026-11-25")).toBeNull();
    expect(on("2026-05-31")).toMatchObject({ kind: "full", blue: true });
  });
  it("高知から見える月食は月食（2026-03-03 皆既）、見えない月食（2026-08-28 昼）はふつうの満月", () => {
    expect(on("2026-03-03")).toMatchObject({ kind: "lunar-total", name: "ワームムーン" });
    expect(on("2026-08-28")).toMatchObject({ kind: "full", name: "スタージョンムーン" });
  });
  it("高知から見える日食は日食（2030-06-01 は高知で部分日食）", () => {
    const e = on("2030-06-01");
    expect(e?.kind).toMatch(/^solar-/);
    expect(e!.obscuration).toBeGreaterThan(0);
  });
});

import { eventBannerSvg } from "../../src/design/eventLogo";
describe("空のイベントの帯（11/20）", () => {
  it("3テーマ・全種類で1枚の SVG、満月は呼び名ごとの絵、文字はロゴと同じ線", () => {
    const names = ["ウルフムーン", "スノームーン", "ワームムーン", "ピンクムーン", "フラワームーン", "ストロベリームーン", "バックムーン", "スタージョンムーン", "コーンムーン", "ハーベストムーン", "ハンターズムーン", "ビーバームーン", "コールドムーン"];
    for (const t of ["navy", "mist", "warm"] as const) {
      const sizes = new Set(names.map((n) => eventBannerSvg(t, "full", n, false).length));
      expect(sizes.size).toBe(names.length); // 絵が呼び名ごとに違う
      for (const k of ["lunar-total", "lunar-partial", "lunar-penumbral", "solar-total", "solar-annular", "solar-partial"] as const) {
        const svg = eventBannerSvg(t, k, null, false);
        expect(svg.startsWith("<svg") && svg.endsWith("</svg>")).toBe(true);
      }
    }
  });
});
