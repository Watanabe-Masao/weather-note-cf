// 予報の出典（2026-11-23）：今日から先の日ごとの値を、気象庁のいちばん新しい発表から、値ごとに出どころを付けて
// （shared/jmaOfficial.ts、worker/src/forecastHistory.ts forecastOfficial）。保存した電文を D1 の代わりに読む。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HistoryIssue } from "../shared/forecastHistory";
import { type OfficialDay, usableIssues } from "../shared/jmaOfficial";
import { ensureForecastSchema } from "../worker/src/forecastArchive";
import { forecastOfficial } from "../worker/src/forecastHistory";
import { parseForecasts } from "../worker/src/forecastParse";
import { d1 } from "./d1";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), "utf8");

async function kept() {
  const db = d1();
  await ensureForecastSchema(db);
  const keep = (id: string, kind: string, xml: string) =>
    db.raw
      .prepare("INSERT INTO forecast_telegrams (id, kind, office, url, issued_at, fetched_at, hash, xml) VALUES (?, ?, '390000', 'u', ?, '2026-11-17T02:00:00Z', 'h', ?)")
      .run(id, kind, /<ReportDateTime>([^<]+)</.exec(xml)?.[1] ?? null, xml);
  keep("d17", "VPFD51", fixture("vpfd51-390000-1700.xml")); // 11/16 17時
  keep("d05", "VPFD51", fixture("vpfd51-390000-0500.xml")); // 11/17 5時
  keep("d11", "VPFD51", fixture("vpfd51-390000-1100.xml")); // 11/17 11時
  keep("w11", "VPFW50", fixture("vpfw50-390000-1100.xml")); // 11/17 11時
  await parseForecasts(db, 50);
  return db;
}

async function days(now: string): Promise<OfficialDay[]> {
  const r = await forecastOfficial(await kept(), "47893", "2026-11-17", now);
  if (!r.supported) throw new Error("supported");
  return r.days;
}
const at = (ds: OfficialDay[], date: string) => ds.find((d) => d.date === date)!;
const by = (o: { from: { kind: string; issuedAt: string } } | null) => (o ? `${o.from.kind} ${o.from.issuedAt.slice(5, 13)}` : null);

describe("予報の出典：気象庁の日ごとの値", () => {
  it("takes each value from the latest issue that gives it, and says which issue", async () => {
    const ds = await days("2026-11-17T12:00:00+09:00");
    expect(ds.map((d) => d.date)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]);
    // 今日と明日：府県天気予報の 11時。週間の明日分は「値なし」（府県天気予報に任せた印）なので使わない。
    expect(by(at(ds, "2026-11-18").max)).toBe("VPFD51 11-17T11");
    expect(at(ds, "2026-11-18").max!.from).toMatchObject({ place: "74182", placeName: "高知" });
    // 今朝の最低は 5時・11時の発表に無い：それを出している前の日の 17時に戻る。
    expect(by(at(ds, "2026-11-17").min)).toBe("VPFD51 11-16T17");
    // 明後日：天気は府県天気予報、気温は週間（気象庁の幅もそのまま）。
    const d19 = at(ds, "2026-11-19");
    expect([by(d19.weather), by(d19.max)]).toEqual(["VPFD51 11-17T11", "VPFW50 11-17T11"]);
    expect([d19.max!.v, d19.max!.lower, d19.max!.upper]).toEqual([16, 15, 18]);
    // 6時間降水確率は区切りごとに：過ぎた区切りは、それを出していた前の発表の値。
    expect(at(ds, "2026-11-17").pop6.map((p) => p && p.from.issuedAt.slice(5, 13))).toEqual(["11-16T17", "11-17T05", "11-17T11", "11-17T11"]);
    // 7日先は週間の 11時。信頼度も。
    expect([by(at(ds, "2026-11-24").max), at(ds, "2026-11-24").reliability?.v]).toEqual(["VPFW50 11-17T11", "C"]);
  });

  it("leaves a value empty when no issue yet gives it (the screen fills it from Open-Meteo)", async () => {
    // 11時の発表より前：7日先（11/24）を言っている週間はまだ無い。
    const ds = await days("2026-11-17T10:00:00+09:00");
    const d24 = at(ds, "2026-11-24");
    expect([d24.weather, d24.max, d24.min, d24.popDay, d24.reliability]).toEqual([null, null, null, null, null]);
    // 明日は 5時の発表から。
    expect(by(at(ds, "2026-11-18").max)).toBe("VPFD51 11-17T05");
  });

  it("uses only preferred copies, never a cancelled issue, never one later than now", () => {
    const issue = (id: string, kind: string, at: string, more: Partial<HistoryIssue> = {}): HistoryIssue => ({
      issue_id: id, source: "jma-xml", office: "390000", kind, issued_at: at, info_type: "発表", revision_of: null, preferred: 1, parser: 1, entries: 1, problems: null, ...more,
    });
    const list = [
      issue("a", "VPFD51", "2026-11-17T05:00:00+09:00"),
      issue("b", "VPFD51", "2026-11-17T05:00:00+09:00", { source: "shiromatz", preferred: 0 }),
      issue("c", "VPFW50", "2026-11-17T11:00:00+09:00"),
      issue("d", "VPFD51", "2026-11-17T11:00:00+09:00"),
      issue("e", "VPFD51", "2026-11-17T11:00:00+09:00", { info_type: "取消", preferred: 0 }),
      issue("f", "VPFD51", "2026-11-17T17:00:00+09:00"),
    ];
    expect(usableIssues(list, "2026-11-17T12:00:00+09:00").map((i) => i.issue_id)).toEqual(["c", "a"]); // 11時の府県は取り消し、17時はまだ先
    // 取り消しが無ければ、同じ時刻は府県天気予報が先。
    expect(usableIssues(list.filter((i) => i.issue_id !== "e"), "2026-11-17T12:00:00+09:00").map((i) => i.issue_id)).toEqual(["d", "c", "a"]);
  });
});
