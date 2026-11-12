// #86 追加レビュー（2026-11-12）の再現テスト。修正前に書き、どれが本当に起きるかを確かめる。
import { describe, expect, it } from "vitest";
import { inputQuality } from "../../src/beta/quality";
import { type Report, snapshotOf } from "../../src/beta/reports";
import type { WeatherRow } from "../../shared/types";
import { makeReport } from "../../research/data/fixture";
import { analyse, compareSettings, sharedCells, sharedCsv } from "../../src/research/analysis";

const obs = (n: number, temp: number, date = "2026-11-12"): WeatherRow => ({ date, n, type: "actual", provider: "JMA-amedas", temp, humidity: 60, wind: 2, raw: {}, quality: {} }) as WeatherRow;
const fc = (n: number, temp: number, date = "2026-11-12"): WeatherRow => ({ date, n, type: "forecast", provider: "Open-Meteo", temp, humidity: 60, wind: 2, solar: 1.2, raw: {}, quality: {} }) as WeatherRow;
const ten = (hhmm: string, temp: number, date = "2026-11-12"): WeatherRow => ({ ...obs(Number(hhmm.slice(0, 2)), temp, date), observedAt: hhmm }) as WeatherRow;
const at = (iso: string) => Date.parse(iso);
const feel = { sun: true } as never;
const quality = (now: number, s: NonNullable<Report["snapshot"]>) => inputQuality({ at: new Date(now).toISOString(), snapshot: s, history: [0], baseline: null } as unknown as Report);

describe("P1 観測の時刻", () => {
  it("壊れた・未来・古すぎる10分値は使わない", () => {
    const rows = [obs(11, 18), obs(12, 19)];
    const now = at("2026-11-12T12:30:00+09:00");
    for (const bad of ["", "abc", "25:70", "12:61"]) expect(snapshotOf(rows, 12, feel, null, undefined, { latest: ten(bad || "x", 30), now })!.temp, bad).toBe(19);
    expect(snapshotOf(rows, 12, feel, null, undefined, { latest: ten("12:40", 30), now })!.temp).toBe(19); // 答えより後
  });

  it("使った値の時刻・出どころ・遅れがそろう（前の時刻の観測から次の時刻へ移る場合も）", () => {
    const now = at("2026-11-12T12:15:00+09:00");
    const s = snapshotOf([obs(11, 18), fc(12, 25)], 12, feel, null, undefined, { latest: ten("12:10", 19.1), now })!;
    expect([s.hour, s.minute, s.temp, s.from.temp]).toEqual([12, 10, 19.1, "amedas"]);
    expect(quality(now, s).lagMin).toBe(5);
  });

  it("1:05 で1時の観測がまだない日：前日24時台の10分値（0:50）を使う（予報にしない）", () => {
    const now = at("2026-11-12T01:05:00+09:00");
    const s = snapshotOf([fc(1, 25), fc(2, 25)], 1, feel, null, undefined, { latest: ten("00:50", 11.2), now })!;
    expect(s.from.temp).toBe("amedas");
    expect(s.temp).toBe(11.2);
    expect(quality(now, s).lagMin).toBe(15);
    expect(quality(now, s).trainable).toBe(true);
  });
});

describe("P1 共有の秘匿", () => {
  const rowsFor = (people: number, tweak?: (p: number, r: Report) => Report) =>
    Array.from({ length: people }, (_, p) => [8, 12, 15].map((h, i) => ({ researchId: `p${p}`, report: tweak ? tweak(p, makeReport(`p${p}-${i}`, h, 10 + h, i - 1)) : makeReport(`p${p}-${i}`, h, 10 + h, i - 1) }))).flat();

  it("共有するセルは5人以上で、外した人も0か5人以上；節で隠した分も5人以上", () => {
    const rows = rowsFor(12, (p, r) => (p === 0 ? { ...r, scaleVersion: 2 } : p === 1 ? { ...r, exposure: "shade" } : r));
    const a = analyse(rows);
    const ok = sharedCells(a);
    for (const c of ok) {
      expect(c.people, c.item).toBeGreaterThanOrEqual(5);
      const rest = a.people - c.people;
      expect(rest === 0 || rest >= 5, `${c.section} ${c.item}`).toBe(true);
    }
    for (const section of new Set(a.cells.map((c) => c.section))) {
      const cells = a.cells.filter((c) => c.section === section);
      const hidden = cells.filter((c) => !ok.has(c));
      if (hidden.length && hidden.length < cells.length) expect(new Set(hidden.flatMap((c) => [...(c.who ?? [])])).size, section).toBeGreaterThanOrEqual(5);
    }
    expect(sharedCsv(a, new Date(0))).not.toContain("版2");
  });
});

describe("P1 共有の秘匿：節をまたいだ反例", () => {
  it("1人だけ予報の気温：気温の状態を隠しても、観測の遅れの件数と総数の差で戻せてはいけない", () => {
    const rows = Array.from({ length: 7 }, (_, p) =>
      [8, 12, 15].map((h, i) => {
        const r = makeReport(`p${p}-${i}`, h, 10 + h, i - 1);
        return { researchId: `p${p}`, report: p === 0 ? { ...r, snapshot: { ...r.snapshot!, from: { ...r.snapshot!.from, temp: "forecast" as const } } } : r };
      }),
    ).flat();
    const csv = sharedCsv(analyse(rows), new Date(0))!;
    const total = Number(/・(\d+)件/.exec(csv)![1]);
    const lag = csv.split("\r\n").find((l) => l.startsWith("観測の遅れ（分）,中央値"));
    // Before the fix the lag line was shared with 6 of 7 people: total − its reports = the 1 person's.
    expect(lag, "6/7人のセルは共有しない").toBeUndefined();
    expect(total).toBe(21);
  });
});

describe("P2 比較の母集団", () => {
  it("学習に使えない記録は、予測される側に入らない", () => {
    const list = Array.from({ length: 6 }, (_, i) => {
      const r = makeReport(`c${i}`, 12, 12 + i * 3, i - 2);
      const date = `2026-10-${String(1 + i).padStart(2, "0")}`;
      return { ...r, at: new Date(Date.parse(`${date}T12:10:00+09:00`)).toISOString(), snapshot: { ...r.snapshot!, date } };
    });
    // The latest one's temperature is a forecast: not trainable.
    list[5] = { ...list[5], snapshot: { ...list[5].snapshot!, from: { ...list[5].snapshot!.from, temp: "forecast" } } };
    expect(compareSettings(list, 2).n).toBe(1);
  });
});

describe("P2 0時またぎ", () => {
  it("記録の日と時刻は、開いた日ではなく保存した時刻から決まる", async () => {
    const { reportMoment } = await import("../../src/beta/reports");
    expect(reportMoment(Date.parse("2026-11-12T23:50:00+09:00"))).toEqual({ day: "2026-11-12", hour: 23, before: "2026-11-11" });
    // Opened at 23:50 and saved at 0:05: 24時 of the 12th, whatever day the sheet was opened on.
    expect(reportMoment(Date.parse("2026-11-13T00:05:00+09:00"))).toEqual({ day: "2026-11-12", hour: 24, before: "2026-11-11" });
    expect(reportMoment(Date.parse("2026-11-13T01:05:00+09:00"))).toEqual({ day: "2026-11-13", hour: 1, before: "2026-11-12" });
  });
});
