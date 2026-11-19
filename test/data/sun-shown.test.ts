// 画面の日の出・日の入り（2026-11-19、レビュー「天文現象は天文計算から、気象観測・予報は気象データから、研究モデルは検証済みの入力から」）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shownClock, shownDayLength, shownSun, shownSunHours } from "../../src/data/sun";
import { inJapan } from "../../src/ui/useHere";
import { nightAt } from "../../src/beta/engine/observations";

const naoj = JSON.parse(readFileSync(new URL("../../research/sun/naoj-kochi-2026.json", import.meta.url), "utf8")) as {
  lat: number;
  lon: number;
  days: { date: string; rise: string; set: string }[];
};

describe("画面の日の出・日の入り（計算だけ）", () => {
  it("国立天文台の表（高知 2026年3・6・10月）と、分に丸めた表示がほぼ一致し、差は1分まで", () => {
    let same = 0;
    let n = 0;
    for (const d of naoj.days) {
      const s = shownSun(d.date, { lat: naoj.lat, lon: naoj.lon });
      for (const [got, want] of [
        [s.rise, d.rise],
        [s.set, d.set],
      ] as const) {
        const [h, m] = want.split(":").map(Number);
        const diff = Math.abs(Math.round(got!) - (h * 60 + m));
        expect(diff).toBeLessThanOrEqual(1);
        if (diff === 0) same++;
        n++;
      }
    }
    // 丸め方まで含めて（表は分単位に丸め）：184 のうち 9割より多くが同じ分
    expect(same / n).toBeGreaterThan(0.9);
  });
  it("高知・札幌・赤道付近・南半球で、出 < 入り、昼の長さが季節どおり", () => {
    const places = { 高知: "47893", 札幌: "47412", シンガポール: { lat: 1.35, lon: 103.8 }, シドニー: { lat: -33.87, lon: 151.21 } } as const;
    for (const w of Object.values(places)) {
      for (const date of ["2026-06-21", "2026-12-21", "2026-03-20"]) {
        const s = shownSun(date, w);
        expect(s.none).toBeNull();
        expect(s.rise!).toBeLessThan(s.set!);
      }
    }
    const long = (date: string, w: (typeof places)[keyof typeof places]) => shownDayLength(shownSun(date, w));
    expect(long("2026-06-21", "47412")).toBeGreaterThan(long("2026-06-21", "47893")); // 夏至は北ほど長い
    expect(long("2026-12-21", "47412")).toBeLessThan(long("2026-12-21", "47893"));
    expect(long("2026-12-21", places.シドニー)).toBeGreaterThan(long("2026-06-21", places.シドニー)); // 南半球は12月が夏
    expect(Math.abs(long("2026-06-21", places.シンガポール) - long("2026-12-21", places.シンガポール))).toBeLessThan(15);
  });
  it("白夜・極夜は時刻を出さず「なし」（代わりの時刻を出さない）", () => {
    const tromso = { lat: 69.65, lon: 18.96 };
    const summer = shownSun("2026-06-21", tromso);
    const winter = shownSun("2026-12-21", tromso);
    expect([summer.rise, summer.set, summer.none]).toEqual([null, null, "白夜"]);
    expect([winter.rise, winter.set, winter.none]).toEqual([null, null, "極夜"]);
    expect(shownClock(summer.rise)).toBe("なし");
    expect(shownDayLength(summer)).toBe(1440);
    expect(shownDayLength(winter)).toBe(0);
    // 絵の線は1日の区切りの代わりの値で引ける（文字には出さない）
    expect(Number.isFinite(shownSunHours("2026-06-21", tromso).rise)).toBe(true);
  });
  it("昼の長さは、表に出す丸めた時刻どうしの差", () => {
    const s = shownSun("2026-11-19", "47893");
    expect(shownDayLength(s)).toBe(Math.round(s.set!) - Math.round(s.rise!));
  });
  it("画面のコード（src/ui）は Open-Meteo の日の出入り（sunrise・sunset）を読まない", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(new URL("../../src/ui", import.meta.url).pathname);
    const bad = files.filter((f) => /\.sunrise\b|\.sunset\b|useSun\(|cachedSun\(|loadSun\(/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});

describe("β の入力は変わらない（保存した日の出入りを使う）", () => {
  it("報告に残した日の出入りがあればそれで夜を決める（計算の値ではない）", () => {
    // 2026-11-19 の計算の日の出は 6:40 ごろ。報告に 7:30 と残っていれば、7:00 はまだ夜。
    const at = Date.parse("2026-11-19T07:00:00+09:00");
    const stored = nightAt(at, "47893", { sunrise: "07:30", sunset: "17:01", date: "2026-11-19" });
    const calc = nightAt(at, "47893", null);
    expect(stored).toBe(true);
    expect(calc).toBe(false);
  });
});

describe("現在地は日本の中だけ", () => {
  it("高知・札幌・那覇・与那国島は中、台北・ホノルルは外（四角なので釜山・ソウルは中だが、時間帯は日本と同じ）", () => {
    expect(inJapan(33.56, 133.53)).toBe(true);
    expect(inJapan(43.06, 141.35)).toBe(true);
    expect(inJapan(26.21, 127.68)).toBe(true);
    expect(inJapan(24.47, 123.0)).toBe(true);
    expect(inJapan(25.03, 121.56)).toBe(false);
    expect(inJapan(21.31, -157.86)).toBe(false);
  });
});
