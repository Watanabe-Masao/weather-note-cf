import { describe, expect, it } from "vitest";
import { angleBetween, cloudAmount, cloudAt, moonOutlook, moonVeil, type SceneInput, skyKindOf, skyRgb, type SkyWeather } from "../../shared/skyScene";

// 空の絵（β）：天気の言葉 → 雲の量のイメージ → 方向ごとの色、月の見えやすさの目安。雲は空全体の多さだけで、月の方角の雲を
// 言い当てない（出典の区別：実績・予報・推定・なし）。
const wx = (text: string | null, source: SkyWeather["source"] = "実績", extra: Partial<SkyWeather> = {}): SkyWeather => ({ kind: skyKindOf(text), source, text, hour: 2, ...extra });
const base = (w: SkyWeather, over: Partial<SceneInput> = {}): SceneInput => ({
  sky: { zenith: "#1a2238", horizon: "#3a4258" } as SceneInput["sky"],
  sunAlt: -40,
  sunAz: 0,
  moonAlt: 59,
  moonAz: 247,
  moonLit: 1,
  wx: w,
  seed: 12345,
  ...over,
});
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe("空の絵（β）の計算", () => {
  it("天気の言葉から種類（雪・雨を先に。晴れと曇りが両方なら晴れ間のある曇り）", () => {
    expect(skyKindOf("晴れ")).toBe("clear");
    expect(skyKindOf("晴れ時々曇り")).toBe("partly");
    expect(skyKindOf("曇り")).toBe("cloudy");
    expect(skyKindOf("霧")).toBe("cloudy");
    expect(skyKindOf("雨")).toBe("rain");
    expect(skyKindOf("雷")).toBe("rain");
    expect(skyKindOf("雪")).toBe("snow");
    expect(skyKindOf(null)).toBeNull();
  });
  it("雲の量：全雲量があればそれ（0〜1 に収める）、無ければ天気のイメージ、天気が無ければ描かない", () => {
    expect(cloudAmount(wx("晴れ", "予報", { cover: 0.3 }))).toBe(0.3);
    expect(cloudAmount(wx("晴れ", "予報", { cover: 1.7 }))).toBe(1);
    expect(cloudAmount(wx("晴れ"))).toBeLessThan(cloudAmount(wx("晴れ時々曇り"))!);
    expect(cloudAmount(wx("晴れ時々曇り"))).toBeLessThan(cloudAmount(wx("曇り"))!);
    expect(cloudAmount(wx("雨"))).toBe(1);
    expect(cloudAmount({ kind: null, source: "なし", text: null, hour: null })).toBeNull();
  });
  it("月の見えやすさの目安：地平線の下／天気なし＝分からない／晴れ＝見える／曇り・雨＝見えにくそう。出典と時間を添える", () => {
    expect(moonOutlook(wx("雨"), -3).level).toBe("地平線の下");
    expect(moonOutlook({ kind: null, source: "なし", text: null, hour: null }, 40).level).toBe("分からない");
    expect(moonOutlook(wx("晴れ"), 40).level).toBe("見える");
    expect(moonOutlook(wx("晴れ時々曇り"), 40).level).toBe("切れ間から");
    const r = moonOutlook(wx("雨"), 59);
    expect(r.level).toBe("見えにくそう");
    expect(r.note).toContain("1時台 雨・実績");
    // 月の方角の雲を言い当てる言い方はしない
    expect(r.note).not.toMatch(/隠れ/);
  });
  it("雲の形：同じ種・同じ天気ならいつも同じ。0〜1。曇り・雨は空の大半を覆い、晴れはほとんど覆わない", () => {
    const pts = Array.from({ length: 400 }, (_, i) => [(i * 37) % 360, 5 + ((i * 13) % 80)]);
    const cov = (a: number) => pts.reduce((s, [az, alt]) => s + cloudAt(az, alt, a, 7), 0) / pts.length;
    for (const [az, alt] of pts.slice(0, 50)) {
      const v = cloudAt(az, alt, 0.5, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(cloudAt(az, alt, 0.5, 7)).toBe(v);
    }
    expect(cov(1)).toBeGreaterThan(0.8);
    expect(cov(0.12)).toBeLessThan(0.25);
    expect(cov(0.5)).toBeGreaterThan(cov(0.12));
    expect(cov(0.5)).toBeLessThan(cov(1));
  });
  it("空の色：夜は暗く、昼は明るい。日の入りのころは太陽の側の地平線が反対側より暖かい色", () => {
    const night = skyRgb(base(wx("晴れ")), 180, 40);
    const day = skyRgb(base(wx("晴れ"), { sunAlt: 40, sky: { zenith: "#4a78c8", horizon: "#a9c1e6" } as SceneInput["sky"] }), 180, 40);
    expect(lum(night)).toBeLessThan(lum(day));
    const dusk = base(wx("晴れ"), { sunAlt: -2, sunAz: 245, sky: { zenith: "#4a5a8a", horizon: "#8a8fae" } as SceneInput["sky"] });
    const sunSide = skyRgb(dusk, 245, 3);
    const away = skyRgb(dusk, 65, 3);
    expect(sunSide[0] - sunSide[2]).toBeGreaterThan(away[0] - away[2]);
    for (const c of [night, day, sunSide, away]) for (const v of c) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
  });
  it("月の覆い：雨の夜は月にも雲がかかり、晴れや天気なしではかからない（空の絵と同じ雲の形）", () => {
    expect(moonVeil(base(wx("雨")))).toBeGreaterThan(0.6);
    expect(moonVeil(base({ kind: null, source: "なし", text: null, hour: null }))).toBe(0);
    expect(moonVeil(base(wx("雨"), { moonAlt: -5 }))).toBe(0);
    expect(moonVeil(base(wx("晴れ")))).toBeLessThan(moonVeil(base(wx("雨"))));
  });
  it("二つの方向の角", () => {
    expect(angleBetween(0, 0, 90, 0)).toBeCloseTo(90, 6);
    expect(angleBetween(10, 90, 200, 90)).toBeCloseTo(0, 6);
    expect(angleBetween(0, 0, 180, 0)).toBeCloseTo(180, 6);
  });
});
