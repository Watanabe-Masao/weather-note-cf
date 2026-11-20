import { describe, expect, it } from "vitest";
import { skyEventOn, skyEventShown, type SkyEvent } from "../../shared/skyEvents";

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

describe("skyEventsBetween（確認ページの一覧）", () => {
  it("1年の毎日で skyEventOn と同じ。15年の食の日も同じ", async () => {
    const { skyEventOn, skyEventsBetween } = await import("../../shared/skyEvents");
    const { lat, lon } = { lat: 33.567, lon: 133.548 };
    const year = skyEventsBetween("2026-11-20", "2027-11-19", lat, lon);
    const byDay = new Map(year.map((x) => [x.date, x.event]));
    // 探し始めが違うと時刻が数ミリ秒ずれる：1秒以内なら同じ。
    const norm = (e: SkyEvent | null | undefined) => (e ? { ...e, at: Math.round(e.at / 1000), span: null, obscuration: e.obscuration == null ? null : Math.round(e.obscuration * 1e6) } : null);
    const same = (a: SkyEvent | null | undefined, b: SkyEvent | null, d: string) => {
      expect(norm(a), d).toEqual(norm(b));
      if (a?.span && b?.span) expect(Math.abs(a.span.from - b.span.from) + Math.abs(a.span.to - b.span.to), d).toBeLessThan(2000);
    };
    for (let t = Date.parse("2026-11-20T00:00:00Z"); t <= Date.parse("2027-11-19T00:00:00Z"); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      same(byDay.get(d), skyEventOn(d, lat, lon), d);
    }
    for (const { date, event } of skyEventsBetween("2026-11-20", "2041-11-19", lat, lon).filter((x) => x.event.kind !== "full")) same(event, skyEventOn(date, lat, lon), date);
  }, 60_000);
});

describe("見出しに出す期間（11/21 渡辺さん「前日＋当日」）", () => {
  const at = (iso: string) => {
    const r = skyEventShown(Date.parse(iso), KOCHI.lat, KOCHI.lon);
    return r ? `${r.phase}:${r.event.name}` : null;
  };
  it("夜の満月（11/24 23:54）：前日は予告、当日は今夜、翌朝5時でしまう", () => {
    expect(at("2026-11-22T12:00:00+09:00")).toBeNull();
    expect(at("2026-11-23T08:00:00+09:00")).toBe("eve:ビーバームーン");
    expect(at("2026-11-24T00:30:00+09:00")).toBe("eve:ビーバームーン"); // 23日の夜の続き
    expect(at("2026-11-24T12:00:00+09:00")).toBe("tonight:ビーバームーン");
    expect(at("2026-11-25T03:00:00+09:00")).toBe("tonight:ビーバームーン");
    expect(at("2026-11-25T06:00:00+09:00")).toBeNull();
  });
  it("明け方の満月（5/2 2:23）は前の晩（5/1）が当日", () => {
    expect(at("2026-04-30T12:00:00+09:00")).toMatch(/^eve:/);
    expect(at("2026-05-01T20:00:00+09:00")).toMatch(/^tonight:/);
    expect(at("2026-05-02T03:00:00+09:00")).toMatch(/^tonight:/);
    expect(at("2026-05-02T12:00:00+09:00")).toBeNull();
  });
});
