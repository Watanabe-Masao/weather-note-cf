import { describe, expect, it } from "vitest";
import { angleBetween, clearLin, cloudAmount, cloudAt, moonOutlook, moonVeil, type SceneInput, sceneSeed, sceneTrace, skyKindOf, skyRgb, skyWeatherFrom, type SkyWeather } from "../../shared/skyScene";
import type { WeatherRow } from "../../shared/types";

// 空の絵（β）：空色エンジン バージョンアップ計画書（11/27）段階 2 の受け入れ条件。晴天大気と雲を分けて線形の光量で合成する。
// 雲量 0 で晴天の空と一致、一面の不透明な雲で背景が透けない、同じ時刻に戻すと雲の配置が同じ、雲量の欠測の根拠を追える、
// 月の案内（見えやすさの目安）は生成した雲によらない、視程のかすみは初期状態で使わない。
const wx = (text: string | null, source: SkyWeather["source"] = "実績", extra: Partial<SkyWeather> = {}): SkyWeather => ({ kind: skyKindOf(text), source, text, hour: 2, ...extra });
const NONE: SkyWeather = { kind: null, source: "なし", text: null, hour: null };
const base = (w: SkyWeather, over: Partial<SceneInput> = {}): SceneInput => ({
  clear: { zenith: "#1a2238", horizon: "#3a4258" } as SceneInput["clear"],
  sunAlt: -40,
  sunAz: 0,
  moonAlt: 59,
  moonAz: 247,
  moonLit: 1,
  wx: w,
  seed: sceneSeed("47893", "2026-11-24", 2, cloudAmount(w)),
  ...over,
});
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const toSrgb = (v: number) => Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
const DIRS = Array.from({ length: 120 }, (_, i) => [(i * 37) % 360, 2 + ((i * 13) % 85)] as const);

describe("空の絵（β）：天気の言葉と雲の量", () => {
  it("天気の言葉から種類：初めの言葉が主、後ろは一部の時間（晴一時雨は雨一色にしない）。霧は曇りに換算しない", () => {
    expect(skyKindOf("晴れ")).toBe("clear");
    expect(skyKindOf("快晴")).toBe("clear");
    expect(skyKindOf("晴れ時々曇り")).toBe("partly");
    expect(skyKindOf("晴時々曇")).toBe("partly");
    expect(skyKindOf("曇時々晴")).toBe("partly");
    expect(skyKindOf("晴一時雨")).toBe("showers");
    expect(skyKindOf("晴時々雨")).toBe("showers");
    expect(skyKindOf("曇り")).toBe("cloudy");
    expect(skyKindOf("くもり")).toBe("cloudy");
    expect(skyKindOf("曇時々雨")).toBe("cloudy");
    expect(skyKindOf("霧")).toBe("fog");
    expect(skyKindOf("雨")).toBe("rain");
    expect(skyKindOf("雨のち晴")).toBe("rain");
    expect(skyKindOf("雷")).toBe("rain");
    expect(skyKindOf("雪")).toBe("snow");
    expect(skyKindOf(null)).toBeNull();
  });
  it("晴一時雨は空一面にしない（晴れ間が残る）。霧は雲の量にしない（描かない）が、月は見えにくそう", () => {
    expect(cloudAmount(wx("晴一時雨"))).toBeLessThan(0.95);
    const s = base(wx("晴一時雨"));
    expect(DIRS.some(([az, alt]) => cloudAt(az, alt, cloudAmount(s.wx)!, s.seed).cover < 0.5)).toBe(true);
    expect(cloudAmount(wx("霧"))).toBeNull();
    expect(moonOutlook(wx("霧"), 40).level).toBe("見えにくそう");
    expect(sceneTrace(base(wx("霧")))[1].note).toContain("霧");
  });
  it("雲の量：全雲量があればそれ（0〜1 に収める）、無ければ天気のイメージ、天気が無ければ描かない", () => {
    expect(cloudAmount(wx("晴れ", "予報", { cover: 0.3 }))).toBe(0.3);
    expect(cloudAmount(wx("晴れ", "予報", { cover: 1.7 }))).toBe(1);
    expect(cloudAmount(wx("晴れ"))).toBeLessThan(cloudAmount(wx("晴れ時々曇り"))!);
    expect(cloudAmount(wx("晴れ時々曇り"))).toBeLessThan(cloudAmount(wx("曇り"))!);
    expect(cloudAmount(wx("雨"))).toBe(1);
    expect(cloudAmount(NONE)).toBeNull();
  });
});

describe("空の絵（β）の元の天気と出典", () => {
  const row = (n: number, extra: Partial<WeatherRow>): WeatherRow => ({ date: "2026-11-24", n, type: "actual", ...extra }) as WeatherRow;
  it("気象庁の天気の記録＝実績、降水量・日照からの推定＝観測から推定（実績と言わない）、予報、前後の時間、なし", () => {
    expect(skyWeatherFrom([row(2, { weather: "雨" })], 2, "47893")).toMatchObject({ source: "実績", text: "雨", hour: 2, kind: "rain" });
    expect(skyWeatherFrom([row(2, { rain: 1.5 })], 2, "47893")).toMatchObject({ source: "観測から推定", text: "雨" });
    expect(skyWeatherFrom([row(2, { type: "forecast", weather: "曇" })], 2, "47893")).toMatchObject({ source: "予報", kind: "cloudy" });
    expect(skyWeatherFrom([row(2, {}), row(3, { weather: "晴" })], 2, "47893")).toMatchObject({ source: "前後の時間", hour: 3 });
    expect(skyWeatherFrom([row(2, {})], 2, "47893")).toMatchObject({ source: "なし", kind: null });
    expect(skyWeatherFrom([row(2, { weather: "晴", visibility: 12 })], 2, "47893").visibilityKm).toBe(12);
  });
});

describe("空色エンジン 段階 2 の受け入れ条件", () => {
  it("雲量 0（と天気なし）では、晴天の空と一致する", () => {
    for (const w of [wx("晴れ", "予報", { cover: 0 }), NONE]) {
      const s = base(w);
      for (const [az, alt] of DIRS) expect(skyRgb(s, az, alt)).toEqual(clearLin(s, az, alt).map(toSrgb));
    }
  });
  it("一面の不透明な雲（雨・曇りの全雲量 100%）では、背景（晴天の空・月のまわりの明るさ）が透けない", () => {
    for (const w of [wx("雨"), wx(null, "予報", { cover: 1 })]) {
      const a = base(w);
      const b = base(w, { clear: { zenith: "#ffffff", horizon: "#ff0000" } as SceneInput["clear"], moonLit: 0.01 });
      for (const [az, alt] of DIRS.filter(([, alt]) => alt > 0)) expect(skyRgb(b, az, alt)).toEqual(skyRgb({ ...a, moonLit: b.moonLit }, az, alt));
      expect(moonVeil(a)).toBe(1);
    }
  });
  it("雲の配置：同じ地点・時刻・入力・版なら同じ。時刻（時間）や地点が変われば変わる", () => {
    expect(sceneSeed("47893", "2026-11-24", 2, 0.5)).toBe(sceneSeed("47893", "2026-11-24", 2, 0.5));
    expect(sceneSeed("47893", "2026-11-24", 3, 0.5)).not.toBe(sceneSeed("47893", "2026-11-24", 2, 0.5));
    expect(sceneSeed("44132", "2026-11-24", 2, 0.5)).not.toBe(sceneSeed("47893", "2026-11-24", 2, 0.5));
    const s = base(wx("晴れ時々曇り"));
    const once = DIRS.map(([az, alt]) => skyRgb(s, az, alt));
    expect(DIRS.map(([az, alt]) => skyRgb({ ...s }, az, alt))).toEqual(once);
  });
  it("雲の被覆は 0〜1。曇り・雨は空を覆い、晴れはほとんど覆わない", () => {
    const cov = (a: number) => DIRS.reduce((sum, [az, alt]) => sum + cloudAt(az, alt, a, 7).cover, 0) / DIRS.length;
    for (const [az, alt] of DIRS.slice(0, 40)) {
      const v = cloudAt(az, alt, 0.5, 7).cover;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(cov(1)).toBe(1);
    expect(cov(0.12)).toBeLessThan(0.25);
    expect(cov(0.5)).toBeGreaterThan(cov(0.12));
  });
  it("月の案内（見えやすさの目安）は、生成した雲によらない（空全体の雲の量と出典だけ）", () => {
    expect(moonOutlook(wx("雨"), -3).level).toBe("地平線の下");
    expect(moonOutlook(NONE, 40).level).toBe("分からない");
    expect(moonOutlook(wx("晴れ"), 40).level).toBe("見える");
    expect(moonOutlook(wx("晴れ時々曇り"), 40).level).toBe("切れ間から");
    const r = moonOutlook(wx("雨"), 59);
    expect(r.level).toBe("見えにくそう");
    expect(r.note).toContain("1時台 雨・実績");
    expect(r.note).not.toMatch(/隠れ/);
    // moonOutlook は種（配置）を受け取らない：同じ天気なら、雲の配置が違っても同じ案内
    expect(moonOutlook.length).toBe(2);
  });
  it("視程のかすみは初期状態で使わない（useVisibility のときだけ）", () => {
    const s = base(wx("晴れ", "実績", { visibilityKm: 2 }));
    for (const [az, alt] of DIRS.slice(0, 20)) expect(skyRgb(s, az, alt)).toEqual(skyRgb(base(wx("晴れ")), az, alt));
    expect(skyRgb({ ...s, useVisibility: true }, 0, 3)).not.toEqual(skyRgb(s, 0, 3));
  });
  it("どの入力で描いたか：晴天の空・雲・かすみのレイヤーごとに、使ったか・入力・出典。雲量の欠測の根拠", () => {
    const t = sceneTrace(base(NONE));
    expect(t.map((x) => x.layer)).toEqual(["晴天の空", "雲", "かすみ"]);
    expect(t[1].used).toBe(false);
    expect(t[1].note).toContain("天気が無い");
    expect(sceneTrace(base(wx("雨")))[1].note).toContain("1時台の雨（実績）");
    expect(sceneTrace(base(wx(null, "予報", { cover: 0.62 })))[1].note).toContain("全雲量 62%（予報）");
    expect(t[2].used).toBe(false);
  });
});

describe("空の絵（β）：色", () => {
  it("夜は暗く、昼は明るい。日の入りのころは太陽の側の地平線が反対側より暖かい色。どれも 0〜1", () => {
    const night = skyRgb(base(wx("晴れ")), 180, 40);
    const day = skyRgb(base(wx("晴れ"), { sunAlt: 40, clear: { zenith: "#4a78c8", horizon: "#a9c1e6" } as SceneInput["clear"] }), 180, 40);
    expect(lum(night)).toBeLessThan(lum(day));
    const dusk = base(wx("晴れ"), { sunAlt: -2, sunAz: 245, clear: { zenith: "#4a5a8a", horizon: "#8a8fae" } as SceneInput["clear"] });
    const sunSide = skyRgb(dusk, 245, 3);
    const away = skyRgb(dusk, 65, 3);
    expect(sunSide[0] - sunSide[2]).toBeGreaterThan(away[0] - away[2]);
    for (const c of [night, day, sunSide, away]) for (const v of c) expect(v >= 0 && v <= 1).toBe(true);
  });
  it("二つの方向の角", () => {
    expect(angleBetween(0, 0, 90, 0)).toBeCloseTo(90, 6);
    expect(angleBetween(10, 90, 200, 90)).toBeCloseTo(0, 6);
    expect(angleBetween(0, 0, 180, 0)).toBeCloseTo(180, 6);
  });
});
