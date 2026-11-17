// 予報の履歴 (#250): the scheduled collector (worker/src/forecastArchive.ts) on a D1 stand-in with a
// made-up regular feed: it keeps the forecast telegrams of the offices in use, as issued, once each,
// catches a long backlog up over runs, and logs a failed run as a gap.

import { describe, expect, it } from "vitest";
import { collectForecasts, officeOf } from "../worker/src/forecastArchive";
import { d1 } from "./d1";

const BASE = "https://www.data.jma.go.jp/developer/xml/data";
const entry = (name: string, title: string, updated: string) =>
  `<entry><title>${title}</title><updated>${updated}</updated><link type="application/xml" href="${BASE}/${name}.xml"/></entry>`;
const feed = (entries: string[]) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.join("")}</feed>`;
const xml = (issued: string) => `<Report><Head><ReportDateTime>${issued}</ReportDateTime></Head></Report>`;

function server(entries: string[], pages: Record<string, string> = {}) {
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    if (url.endsWith("regular.xml") || url.endsWith("regular_l.xml")) return { ok: true, status: 200, text: async () => feed(entries) };
    const page = Object.entries(pages).find(([n]) => url.endsWith(`${n}.xml`))?.[1];
    if (page !== undefined) return { ok: true, status: 200, text: async () => page };
    const name = /data\/(\d{14})_/.exec(url)?.[1] ?? "";
    const iso = `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T${name.slice(8, 10)}:${name.slice(10, 12)}:00+09:00`;
    return { ok: true, status: 200, text: async () => xml(iso) };
  };
  return { get, asked };
}

describe("予報の履歴：集める", () => {
  it("keeps 高知's 府県天気予報・週間天気予報・天気概況 as issued, once each; not other offices or kinds", async () => {
    const db = d1();
    const s = server([
      entry("20261117050000_0_VPFD51_390000", "府県天気予報（Ｒ１）", "2026-11-16T20:00:00Z"),
      entry("20261116170000_0_VPFW50_390000", "府県週間天気予報", "2026-11-16T08:00:00Z"),
      entry("20261117050100_0_VPFG50_390000", "府県天気概況", "2026-11-16T20:01:00Z"),
      entry("20261117050000_0_VPFD51_130000", "府県天気予報（Ｒ１）", "2026-11-16T20:00:00Z"),
      entry("20261117055500_0_VPWP50_390000", "気象警報・注意報時系列情報（Ｒ０６）", "2026-11-16T20:55:00Z"),
    ]);
    const r = await collectForecasts(db, Date.parse("2026-11-17T06:00:00+09:00"), s.get);
    expect(r).toMatchObject({ added: 3, ok: true, leftOver: 0 });
    expect(r.feed).toMatch(/regular_l\.xml$/); // the first run reads the 7 days
    const kept = db.raw.prepare("SELECT kind, office, issued_at FROM forecast_telegrams ORDER BY kind").all();
    expect(kept).toEqual([
      { kind: "VPFD51", office: "390000", issued_at: "2026-11-17T05:00:00+09:00" },
      { kind: "VPFG50", office: "390000", issued_at: "2026-11-17T05:01:00+09:00" },
      { kind: "VPFW50", office: "390000", issued_at: "2026-11-16T17:00:00+09:00" },
    ]);
    const again = await collectForecasts(db, Date.parse("2026-11-17T06:05:00+09:00"), s.get);
    expect(again).toMatchObject({ added: 0, ok: true });
    expect(again.feed).toMatch(/regular\.xml$/);
  });

  it("catches a long backlog up over runs, the newest first", async () => {
    const db = d1();
    const many = Array.from({ length: 40 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 10, 10, 0, 0) + i * 3_600_000 * 4).toISOString();
      const stamp = d.slice(0, 19).replace(/[-:T]/g, "");
      return entry(`${stamp}_0_VPFD51_390000`, "府県天気予報（Ｒ１）", d);
    });
    const s = server(many);
    const first = await collectForecasts(db, Date.parse("2026-11-17T06:00:00+09:00"), s.get);
    expect(first).toMatchObject({ added: 25, leftOver: 15 });
    const second = await collectForecasts(db, Date.parse("2026-11-17T06:05:00+09:00"), s.get);
    expect(second.feed).toMatch(/regular_l\.xml$/); // still owed: the long feed again
    expect(second).toMatchObject({ added: 15, leftOver: 0 });
  });

  it("does not keep a page that is not a telegram (an error page answered 200): a failure, taken next run", async () => {
    const db = d1();
    const name = "20261117050000_0_VPFD51_390000";
    const entries = [entry(name, "府県天気予報（Ｒ１）", "2026-11-16T20:00:00Z")];
    const r = await collectForecasts(db, Date.parse("2026-11-17T06:00:00+09:00"), server(entries, { [name]: "<html>maintenance</html>" }).get);
    expect(r).toMatchObject({ ok: false, added: 0 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM forecast_telegrams").get()).toEqual({ n: 0 });
    expect(db.raw.prepare("SELECT ok, error FROM forecast_fetch_log").all()).toEqual([{ ok: 0, error: `Error: ${name}: not a telegram` }]);
    const next = await collectForecasts(db, Date.parse("2026-11-17T06:05:00+09:00"), server(entries).get);
    expect(next).toMatchObject({ ok: true, added: 1 });
  });

  it("logs a run that could not read the feed as a gap", async () => {
    const db = d1();
    const r = await collectForecasts(db, Date.parse("2026-11-17T06:00:00+09:00"), async () => ({ ok: false, status: 503, text: async () => "" }));
    expect(r.ok).toBe(false);
    expect(db.raw.prepare("SELECT ok, error FROM forecast_fetch_log").all()).toEqual([{ ok: 0, error: "Error: feed HTTP 503" }]);
  });

  it("knows each station's forecast office, where a prefecture has more than one", () => {
    expect(officeOf("47893")).toBe("390000"); // 高知
    expect(officeOf("47412")).toBe("016000"); // 札幌：石狩・空知・後志
    expect(officeOf("47936")).toBe("471000"); // 那覇：沖縄本島
    expect(officeOf("47909")).toBe("460040"); // 名瀬：奄美
  });
});
