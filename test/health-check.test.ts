// 監視 (scripts/health-check.mjs) of the record's import (#250): whether the record has the month to
// take next is asked with HEAD (true / false / null — not asked is never 「まだ無い」), and the
// "import-ready" issue is opened, left open or closed by it; when the record could not be asked,
// nothing is opened or closed.

import { describe, expect, it } from "vitest";

interface Ready {
  lastTaken: string | null;
  next: string | null;
  available: boolean | null;
  reason?: string;
}
type Action = { act: "open"; month: string; title: string; body: string } | { act: "close"; number: number; comment: string };
interface HealthCheck {
  recordZipUrl(month: string): string;
  importTitle(month: string): string;
  checkImport(position: { lastTaken: string | null; next: string | null } | undefined, get: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>): Promise<Ready>;
  importIssueActions(imp: Ready | null, open: { number: number; title: string }[]): Action[];
}

// A script of plain JavaScript (Node, no packages): read at run time, so its main part does not run.
const script = new URL("../scripts/health-check.mjs", import.meta.url).href;
const load = () => import(/* @vite-ignore */ script) as Promise<HealthCheck>;
const answer = (status: number) => async () => ({ ok: status >= 200 && status < 300, status });

describe("監視：取り込める月", () => {
  it("asks the record's main with HEAD: 200 → true, 404 → false, else null with the reason", async () => {
    const m = await load();
    const asked: (string | undefined)[] = [];
    const pos = { lastTaken: "2026-10", next: "2026-11" };
    const r = await m.checkImport(pos, async (url, init) => (asked.push(url, init?.method), { ok: true, status: 200 }));
    expect(r).toEqual({ lastTaken: "2026-10", next: "2026-11", available: true });
    expect(asked).toEqual(["https://raw.githubusercontent.com/shiromatz/Japan-Meteorological-Agency-Weather-Forecast/refs/heads/main/forecast/forecast_202611.zip", "HEAD"]);
    expect(await m.checkImport(pos, answer(404))).toEqual({ ...pos, available: false });
    expect(await m.checkImport(pos, answer(502))).toEqual({ ...pos, available: null, reason: "HTTP 502" });
    const thrown = await m.checkImport(pos, async () => {
      throw new Error("fetch failed");
    });
    expect(thrown).toEqual({ ...pos, available: null, reason: "fetch failed" });
    // All months taken: nothing to ask.
    let n = 0;
    expect(await m.checkImport({ lastTaken: "2026-11", next: null }, async () => (n++, { ok: true, status: 200 }))).toEqual({ lastTaken: "2026-11", next: null, available: null });
    expect(n).toBe(0);
  });

  it("opens the issue when the next month is in the record and none is open for it", async () => {
    const m = await load();
    const a = m.importIssueActions({ lastTaken: "2026-10", next: "2026-11", available: true }, []);
    expect(a).toEqual([{ act: "open", month: "2026-11", title: "取り込める月があります：2026-11", body: expect.stringContaining("forecast/forecast_202611.zip") }]);
    // Nothing of the app's address or of a person in it.
    expect((a[0] as { body: string }).body).not.toMatch(/https?:|@/);
  });

  it("leaves it open while that month is still the next", async () => {
    const m = await load();
    expect(m.importIssueActions({ lastTaken: "2026-10", next: "2026-11", available: true }, [{ number: 7, title: m.importTitle("2026-11") }])).toEqual([]);
  });

  it("closes it once the month is taken (next moves on, or none is left), and opens the next if it is there", async () => {
    const m = await load();
    const open = [{ number: 7, title: m.importTitle("2026-10") }];
    expect(m.importIssueActions({ lastTaken: "2026-10", next: "2026-11", available: false }, open)).toEqual([{ act: "close", number: 7, comment: "2026-10 の取り込みが済みました（次は 2026-11）。" }]);
    expect(m.importIssueActions({ lastTaken: "2026-11", next: null, available: null }, [{ number: 8, title: m.importTitle("2026-11") }])).toEqual([
      { act: "close", number: 8, comment: "2026-11 の取り込みが済みました（次は なし）。" },
    ]);
    expect(m.importIssueActions({ lastTaken: "2026-10", next: "2026-11", available: true }, open).map((x) => x.act)).toEqual(["close", "open"]);
  });

  it("does not open while the record does not have it yet", async () => {
    const m = await load();
    expect(m.importIssueActions({ lastTaken: "2026-10", next: "2026-11", available: false }, [])).toEqual([]);
  });

  it("opens and closes nothing when the record could not be asked, or /api/health was not read", async () => {
    const m = await load();
    const open = [{ number: 7, title: m.importTitle("2026-10") }];
    expect(m.importIssueActions({ lastTaken: "2026-10", next: "2026-11", available: null, reason: "HTTP 502" }, open)).toEqual([]);
    expect(m.importIssueActions({ lastTaken: "2026-10", next: "2026-11", available: null, reason: "HTTP 502" }, [])).toEqual([]);
    expect(m.importIssueActions(null, open)).toEqual([]);
  });
});
