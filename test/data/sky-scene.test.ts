import { describe, expect, it } from "vitest";
import { angleBetween, clearLin, cloudAmount, cloudAt, coverText, moonOutlook, moonVeil, type SceneInput, sceneSeed, sceneTrace, skyBasis, skyHours, skyKindOf, skyRgb, skyWeatherFrom, type SkyWeather } from "../../shared/skyScene";
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

describe("空の絵（β）：予報の全雲量（#532 の 1）", () => {
  const row = (n: number, extra: Partial<WeatherRow>): WeatherRow => ({ date: "2026-11-24", n, type: "forecast", ...extra }) as WeatherRow;
  it("時刻の対応：天気はその時刻を含む時間（1時20分→2時の行＝1時台）、全雲量はいちばん近い正時（1時20分→1時、1時40分→2時）", () => {
    expect(skyHours(80)).toEqual({ n: 2, coverAt: 1 });
    expect(skyHours(100)).toEqual({ n: 2, coverAt: 2 });
    expect(skyHours(90)).toEqual({ n: 2, coverAt: 2 });
    expect(skyHours(10)).toEqual({ n: 1, coverAt: 1 }); // 0 時の値はその日の行に無い（前の日の 24 時）
    expect(skyHours(1435)).toEqual({ n: 24, coverAt: 24 });
  });
  it("予報の全雲量があれば、その値で雲を描き、出典・何時の値かを出す", () => {
    const w = skyWeatherFrom([row(1, { weather: "曇り", cover: 30 }), row(2, { weather: "曇り", cover: 62 })], 2, "47893", 1);
    expect(w).toMatchObject({ source: "予報", text: "曇り", cover: 0.3, coverAt: 1, coverSource: "予報" });
    expect(cloudAmount(w)).toBe(0.3);
    expect(coverText(w)).toBe("1時の全雲量 30%（予報）");
    expect(sceneTrace(base(w))[1]).toMatchObject({ used: true });
    expect(sceneTrace(base(w))[1].note).toContain("1時の全雲量 30%（予報）に基づくイメージ");
    expect(moonOutlook(w, 40).note).toContain("（1時の全雲量 30%・予報）");
  });
  it("全雲量 0% は値：雲を描かない（晴天の空と一致）。全雲量が無いときは天気から描き、0% と区別する", () => {
    const zero = skyWeatherFrom([row(2, { weather: "曇り", cover: 0 })], 2, "47893");
    expect(zero.cover).toBe(0);
    expect(cloudAmount(zero)).toBe(0);
    const s = base(zero);
    for (const [az, alt] of DIRS.slice(0, 30)) expect(skyRgb(s, az, alt)).toEqual(clearLin(s, az, alt).map(toSrgb));
    expect(sceneTrace(s)[1]).toMatchObject({ used: false });
    expect(sceneTrace(s)[1].note).toContain("全雲量 0%（予報）なので、雲は描いていない");
    const missing = skyWeatherFrom([row(2, { weather: "曇り" })], 2, "47893");
    expect(missing.cover).toBeUndefined();
    expect(cloudAmount(missing)).toBe(0.9);
    expect(sceneTrace(base(missing))[1].note).toContain("全雲量は無い");
  });
  it("天気が無くても全雲量があれば描く（出典は予報、天気は無いと書く）", () => {
    const w = skyWeatherFrom([row(2, { cover: 80 })], 2, "47893");
    expect(w).toMatchObject({ kind: null, source: "予報", text: null, cover: 0.8, coverAt: 2 });
    expect(cloudAmount(w)).toBe(0.8);
    expect(sceneTrace(base(w))[1].note).toContain("（天気は無い）");
    expect(moonOutlook(w, 40).level).toBe("見えにくそう");
  });
  it("実績の時間には予報の全雲量を混ぜない（その時間の空は実績の天気で描く）", () => {
    const rows = [{ ...row(2, { weather: "晴" }), type: "actual" } as WeatherRow, row(3, { weather: "曇り", cover: 90 })];
    const w = skyWeatherFrom(rows, 2, "47893", 3); // 2時台（実績）を、3時の全雲量（予報）に近い時刻で見る
    expect(w).toMatchObject({ source: "実績", text: "晴" });
    expect(w.cover).toBeUndefined();
  });
});

describe("空の絵（β）の根拠：絵の直下の1か所（11/27 渡辺さん「β の説明に一本化」）", () => {
  const row = (n: number, extra: Partial<WeatherRow>): WeatherRow => ({ date: "2026-11-24", n, type: "forecast", ...extra }) as WeatherRow;
  it("天気・全雲量の予報が無い：何が欠けているかを書き、降水量は事実として添えるだけ（雲の量は補わない）", () => {
    const w = skyWeatherFrom([row(13, { rain: 0 })], 13, "47893", 12);
    expect(skyBasis(w)).toEqual(["この時間の天気・全雲量の予報がないため、雲は描いていません。", "予報の降水量は0.0 mmです。"]);
    expect(cloudAmount(w)).toBeNull();
    expect(skyBasis(skyWeatherFrom([{ ...row(13, { rain: 0 }), type: "actual" } as WeatherRow], 13, "47893"))).toEqual(["この時間の天気・全雲量の記録がないため、雲は描いていません。", "観測の降水量は0.0 mmです。"]);
    expect(skyBasis(skyWeatherFrom([], 13, "47893"))).toEqual(["この時間の天気・全雲量の記録・予報がないため、雲は描いていません。"]);
  });
  it("全雲量 0% で描いていないことと、情報が無くて描いていないことを言い分ける", () => {
    const zero = skyBasis(skyWeatherFrom([row(12, { weather: "快晴", cover: 0 }), row(13, { weather: "快晴" })], 13, "47893", 12));
    expect(zero[0]).toBe("12時の全雲量の予報が 0% のため、雲は描いていません。");
    expect(zero[1]).toBe("12時台の天気は「快晴」（予報）です。");
    expect(zero.join("")).not.toContain("ないため");
  });
  it("全雲量から・天気から・前後の時間から・霧", () => {
    expect(skyBasis(skyWeatherFrom([row(12, { cover: 84 }), row(13, {})], 13, "47893", 12))).toEqual(["12時の全雲量の予報 84% から雲を描いています（雲の形と位置はイメージ）。", "この時間の天気の予報はありません。"]);
    expect(skyBasis(skyWeatherFrom([row(13, { weather: "曇り" })], 13, "47893"))[0]).toBe("12時台の天気「曇り」（予報）から雲を描いています（全雲量がないため、雲の量は天気から決めたイメージ）。");
    expect(skyBasis(skyWeatherFrom([row(13, {}), row(14, { weather: "晴" })], 13, "47893"))[0]).toContain("この時間の天気がないため、近い13時台の天気「晴」から");
    expect(skyBasis(skyWeatherFrom([row(13, { weather: "霧" })], 13, "47893"))[0]).toContain("霧は雲の量にしないので、雲は描いていません");
  });
  it("空の帯の言葉と元は、詳細欄の「空の帯（参考）」にだけ（β には使っていないと書く）", () => {
    const t = sceneTrace(base(NONE, { band: "雲の多い青空・12時台 雨 0.0mm（予報）" }));
    expect(t.at(-1)).toMatchObject({ layer: "空の帯（参考）", used: false });
    expect(t.at(-1)!.note).toContain("β の空の絵には使っていない");
    expect(sceneTrace(base(NONE)).map((x) => x.layer)).not.toContain("空の帯（参考）");
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
    expect(t[1].note).toContain("天気も全雲量も無い");
    expect(sceneTrace(base(wx("雨")))[1].note).toContain("1時台の雨（実績）");
    expect(sceneTrace(base(wx(null, "予報", { cover: 0.62, coverAt: 2, coverSource: "予報" })))[1].note).toContain("2時の全雲量 62%（予報）");
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
