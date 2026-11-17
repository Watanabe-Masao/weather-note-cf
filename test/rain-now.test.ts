// 雨の見込み（確認用）(shared/rainNow.ts, worker/src/rainNow.ts)：一覧から地図のこまを組む決まり、中継してよい
// タイル、画素の色から段を読む決まり、中継の口（地点のまわりだけ・読めなかったら置かない・状態で返す）。

import { describe, expect, it } from "vitest";
import { tileOf } from "../shared/radar";
import { buildFrames, isAllowedTile, type JmaListItem, levelOfPixel, pixelOf, RAIN_LEVELS, RAIN_LISTS } from "../shared/rainNow";
import { rainNow, rainTile } from "../worker/src/rainNow";

// UTC の名前：2026-11-18 06:00Z ＝ 15:00 JST を「今」に
const t = (min: number) => {
  const d = new Date(Date.UTC(2026, 10, 18, 6, 0) + min * 60_000);
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
};
const obs: JmaListItem[] = Array.from({ length: 37 }, (_, i) => ({ basetime: t(-180 + i * 5), validtime: t(-180 + i * 5), elements: ["hrpns", "hrpns_nd"] }));
const nowcast: JmaListItem[] = Array.from({ length: 12 }, (_, i) => ({ basetime: t(0), validtime: t(5 + i * 5), elements: ["hrpns"] }));
const rasrf: JmaListItem[] = [
  // 解析（30分ごと、12時間）
  ...Array.from({ length: 25 }, (_, i) => ({ basetime: t(-720 + i * 30), validtime: t(-720 + i * 30), member: "none", elements: ["rasrf"] })),
  // 予報（いちばん新しい発表は今の30分前、15時間先まで1時間ごと）
  ...Array.from({ length: 15 }, (_, i) => ({ basetime: t(-30), validtime: t(30 + i * 60), member: "none", elements: ["rasrf"] })),
  // 古い発表（使わない）
  ...Array.from({ length: 15 }, (_, i) => ({ basetime: t(-60), validtime: t(0 + i * 60), member: "none", elements: ["rasrf"] })),
];

describe("buildFrames", () => {
  it("組む：実況3時間・予測1時間（5分ごと）、その先は毎正時の1時間の量", () => {
    const { now, frames, hours } = buildFrames(obs, nowcast, rasrf);
    expect(now).toBe(t(0));
    const kinds = (k: string) => frames.filter((f) => f.kind === k).map((f) => f.m);
    expect(kinds("obs")).toEqual(Array.from({ length: 37 }, (_, i) => -180 + i * 5));
    expect(kinds("nowcast")).toEqual(Array.from({ length: 12 }, (_, i) => 5 + i * 5));
    // 発表 14:30 から1時間ずつ（:30 で区切る）。予測（16:00 まで）との重なりは30分まで：15:30〜16:30 から
    expect(kinds("hourly")).toEqual(Array.from({ length: 14 }, (_, i) => 90 + i * 60));
    // グラフの1時間の量：解析の毎正時（6時間前〜今）と、今後の雨の全部（予測と重なる 14:30〜15:30 も）
    expect(hours.map((f) => f.m)).toEqual([-360, -300, -240, -180, -120, -60, 0, ...Array.from({ length: 15 }, (_, i) => 30 + i * 60)]);
  });
  it("今後の雨：発表が正時なら正時で区切り、予測の1時間の先から15時間先まで。30分ごとの一覧でも1時間ずつ", () => {
    const hourly: JmaListItem[] = Array.from({ length: 32 }, (_, i) => ({ basetime: t(0), validtime: t(30 + i * 30), member: "none" }));
    const { frames } = buildFrames(obs, nowcast, hourly);
    expect(frames.filter((f) => f.kind === "hourly").map((f) => f.m)).toEqual(Array.from({ length: 14 }, (_, i) => 120 + i * 60));
    expect(frames.every((f, i) => i === 0 || frames[i - 1].m < f.m)).toBe(true);
  });
  it("実況が無ければ何も組まない（今が分からない）", () => {
    expect(buildFrames([], nowcast, rasrf)).toEqual({ now: null, frames: [], hours: [] });
  });
  it("同じ時刻の member は none を先に", () => {
    const xs: JmaListItem[] = [
      { basetime: t(-30), validtime: t(150), member: "immed" },
      { basetime: t(-30), validtime: t(150), member: "none" },
    ];
    expect(buildFrames(obs, nowcast, xs).frames.find((f) => f.kind === "hourly")?.member).toBe("none");
  });
});

describe("中継してよいタイル", () => {
  const c8 = tileOf(33.56, 133.53, 8);
  it("段階8〜10、地点のタイルから3枚以内だけ", () => {
    expect(isAllowedTile(8, c8.x, c8.y)).toBe(true);
    expect(isAllowedTile(8, c8.x + 3, c8.y - 3)).toBe(true);
    expect(isAllowedTile(8, c8.x + 4, c8.y)).toBe(false);
    expect(isAllowedTile(7, 111, 51)).toBe(false);
    expect(isAllowedTile(11, 1782, 820)).toBe(false);
    const c10 = tileOf(33.56, 133.53, 10);
    expect(isAllowedTile(10, c10.x, c10.y)).toBe(true);
  });
  it("地点の画素：高知は段階8 の (222,102) の東の端", () => {
    const p = pixelOf(33.56, 133.53, 8);
    expect([p.x, p.y]).toEqual([222, 102]);
    expect(p.px).toBeGreaterThan(240);
  });
});

describe("画素の色から段", () => {
  it("気象庁の色はその段、透明は雨なし、見込まない色は読めない", () => {
    RAIN_LEVELS.forEach((l, i) => expect(levelOfPixel(l.rgb[0], l.rgb[1], l.rgb[2], 255)).toBe(i));
    expect(levelOfPixel(0, 0, 0, 0)).toBe(-1);
    expect(levelOfPixel(0, 65, 250, 255)).toBe(3); // 少しずれても近い段
    expect(levelOfPixel(0, 200, 0, 255)).toBeNull();
  });
});

const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(80).fill(0)]);
function memCache() {
  const m = new Map<string, Response>();
  const c = {
    async match(k: Request) {
      const r = m.get(k.url);
      return r ? r.clone() : undefined;
    },
    async put(k: Request, r: Response) {
      m.set(k.url, r);
    },
  } as unknown as Cache;
  return { c, m };
}

describe("タイルの中継", () => {
  const c8 = tileOf(33.56, 133.53, 8);
  const path = (x = c8.x) => `/api/rain-tile/hrpns/${t(0)}/none/${t(0)}/8/${x}/${c8.y}.png`;
  it("地点のまわりは気象庁のタイルを返し、端に置く。2回目は気象庁へ行かない", async () => {
    const seen: string[] = [];
    const get = async (u: string) => (seen.push(u), new Response(png(), { status: 200 }));
    const { c, m } = memCache();
    const waits: Promise<unknown>[] = [];
    const r = await rainTile(path(), "https://x.test", (p) => waits.push(p), get, c);
    await Promise.all(waits);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(seen[0]).toBe(`https://www.jma.go.jp/bosai/jmatile/data/nowc/${t(0)}/none/${t(0)}/surf/hrpns/8/${c8.x}/${c8.y}.png`);
    expect(m.size).toBe(1);
    const again = await rainTile(path(), "https://x.test", () => {}, get, c);
    expect(again.status).toBe(200);
    expect(seen).toHaveLength(1);
  });
  it("遠いタイルは中継しない（403）、形の違う指定は 400", async () => {
    const get = async () => new Response(png());
    expect((await rainTile(path(c8.x + 5), "https://x.test", () => {}, get, null)).status).toBe(403);
    expect((await rainTile("/api/rain-tile/hrpns/x/none/y/8/1/1.png", "https://x.test", () => {}, get, null)).status).toBe(400);
  });
  it("気象庁に無い（404）・読めない（502）・画像でない（502）は置かずに状態で返す", async () => {
    const { c, m } = memCache();
    expect((await rainTile(path(), "https://x.test", () => {}, async () => new Response("", { status: 404 }), c)).status).toBe(404);
    expect((await rainTile(path(), "https://x.test", () => {}, async () => new Response("", { status: 500 }), c)).status).toBe(502);
    expect((await rainTile(path(), "https://x.test", () => {}, async () => new Response("<html>"), c)).status).toBe(502);
    expect(
      (
        await rainTile(path(), "https://x.test", () => {}, async () => {
          throw new Error("timeout");
        }, c)
      ).status,
    ).toBe(502);
    expect(m.size).toBe(0);
  });
});

describe("/api/rain-now", () => {
  it("一覧から組み、一覧ごとに読めたか・何こま使ったかを返す", async () => {
    const get = async (u: string) =>
      u === RAIN_LISTS.obs ? Response.json(obs) : u === RAIN_LISTS.nowcast ? Response.json(nowcast) : new Response("", { status: 503 });
    const r = await rainNow("47893", get);
    expect(r.supported).toBe(true);
    expect(r.now).toBe(t(0));
    expect(r.lists.obs).toMatchObject({ ok: true, count: 37 });
    expect(r.lists.nowcast).toMatchObject({ ok: true, count: 12, latest: t(0) });
    expect(r.lists.rasrf).toMatchObject({ ok: false, count: 0, error: "HTTP 503" });
  });
  it("表にない地点は supported: false（推測しない）", async () => {
    const r = await rainNow("00000", async () => Response.json([]));
    expect(r.supported).toBe(false);
  });
});
