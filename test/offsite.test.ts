// 原本の控え（worker/src/offsite.ts、#370）：1日ずつ tar にまとめて Google ドライブに置き、読み戻して確かめる。
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyOffsite, Drive, filesOfDay, offsiteLine, offsiteSummary, pendingDays, tar } from "../worker/src/offsite";
import { ensureAmedasSchema } from "../worker/src/amedasArchive";
import { ensureRadarSchema } from "../worker/src/radarArchive";
import { type Bucket, ensureR2Schema } from "../worker/src/r2Archive";
import { judgeHealth } from "../shared/healthJudge";
import { d1 } from "./d1";

const H = 3_600_000;
const KEYS = { GDRIVE_CLIENT_ID: "cid", GDRIVE_CLIENT_SECRET: "csecret-xyz", GDRIVE_REFRESH_TOKEN: "rtoken-xyz" };
// 2026-11-20 02:00（日本時間）
const NOW = Date.parse("2026-11-19T17:00:00Z");

function bucket(files: Map<string, Uint8Array>): Bucket {
  return {
    async put() {},
    async get(key) {
      const f = files.get(key);
      return f ? { arrayBuffer: async () => f.slice().buffer } : null;
    },
  };
}

async function seeded() {
  const db = d1();
  await ensureAmedasSchema(db);
  await ensureRadarSchema(db);
  await ensureR2Schema(db);
  const files = new Map<string, Uint8Array>();
  const put = (key: string, n: number) => files.set(key, new Uint8Array(n).fill(7));
  const am = db.raw.prepare("INSERT INTO amedas_saved (key, point, block_at, times, bytes, sha256, fetched_at) VALUES (?, '74182', 'b', 18, 1, 's', ?)");
  // 11/17 23:30（日本時間）＝ 14:30Z は 11/17 の分。11/18 0:10 ＝ 11/17 15:10Z は 11/18 の分。
  am.run("amedas/point/74182/2026-11/20261117_18.json.gz", "2026-11-17T14:30:00.000Z");
  am.run("amedas/point/74182/2026-11/20261117_21.json.gz", "2026-11-17T15:10:00.000Z");
  put("amedas/point/74182/2026-11/20261117_18.json.gz", 700);
  put("amedas/point/74182/2026-11/20261117_21.json.gz", 1300);
  const long = "radar/rasrf/2026-11/20261118000000/immed0000/" + "x".repeat(60) + "/8/222/102.png"; // 100文字を超える名前
  db.raw.prepare("INSERT INTO radar_saved (key, valid_at, jma_time, z, x, y, bytes, sha256, fetched_at) VALUES (?, 'v', 'j', 8, 222, 102, 1, 's', '2026-11-18T03:00:00.000Z')").run(long);
  put(long, 40);
  db.raw.prepare("INSERT INTO wxchart_saved (key, kind, valid_at, base_at, url, bytes, sha256, fetched_at) VALUES ('wxchart/quick/2026-11/gone.png', 'quick', 'v', NULL, 'u', 1, 's', '2026-11-18T05:00:00.000Z')").run();
  return { db, files, long };
}

function fakeDrive() {
  const stored = new Map<string, Uint8Array>();
  const calls: string[] = [];
  let n = 0;
  return {
    stored,
    calls,
    corrupt: false,
    async folder() {
      calls.push("folder");
      return "F1";
    },
    async upload(folder: string, name: string, body: Uint8Array) {
      calls.push(`upload ${folder} ${name}`);
      const id = `id${++n}`;
      stored.set(id, body.slice());
      return id;
    },
    async download(id: string) {
      const b = stored.get(id)!.slice();
      if (this.corrupt) b[600] ^= 1;
      return b;
    },
  };
}

describe("ドライブの控え", () => {
  it("鍵が無ければ何もしない", async () => {
    const { db, files } = await seeded();
    const d = fakeDrive();
    expect(await copyOffsite(db, bucket(files), {}, NOW, d)).toMatchObject({ configured: false });
    expect(d.calls).toEqual([]);
    expect(offsiteLine(await offsiteSummary(db, NOW, {}))).toContain("まだ設定されていません");
  });

  it("日本時間の1日ずつ、古い日から。その日が終わって1時間たつまでは置かない", async () => {
    const { db } = await seeded();
    // 11/19 は保存が無くても、その日の分（manifest だけ）を置く（抜けた日が分かるように）。
    expect(await pendingDays(db, NOW)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(await pendingDays(db, Date.parse("2026-11-19T15:30:00Z"))).toEqual(["2026-11-17", "2026-11-18"]); // 11/20 0:30
    expect((await filesOfDay(db, "2026-11-17")).map((f) => f.key)).toEqual(["amedas/point/74182/2026-11/20261117_18.json.gz"]);
  });

  it("tar にまとめて置き、読み戻して確かめた日だけを済みにする。R2 に無いものは manifest に残す", async () => {
    const { db, files, long } = await seeded();
    const d = fakeDrive();
    const r1 = await copyOffsite(db, bucket(files), KEYS, NOW, d);
    expect(r1).toMatchObject({ configured: true, day: "2026-11-17", files: 1, missing: 0, pending: 2 });
    const r2 = await copyOffsite(db, bucket(files), KEYS, NOW + 5 * 60_000, d);
    expect(r2).toMatchObject({ day: "2026-11-18", files: 2, missing: 1, pending: 1 });
    expect(await copyOffsite(db, bucket(files), KEYS, NOW + 10 * 60_000, d)).toMatchObject({ day: "2026-11-19", files: 0, pending: 0 });
    expect(d.calls).toEqual(["folder", "upload F1 2026-11-17.tar", "upload F1 2026-11-18.tar", "upload F1 2026-11-19.tar"]); // フォルダは1回だけ探す
    expect(await copyOffsite(db, bucket(files), KEYS, NOW + 15 * 60_000, d)).toMatchObject({ day: null });
    // 本物の tar として読める（100文字を超える名前も）
    const dir = mkdtempSync(join(tmpdir(), "offsite-"));
    writeFileSync(join(dir, "a.tar"), d.stored.get("id2")!);
    const list = execFileSync("tar", ["-tvf", join(dir, "a.tar")], { encoding: "utf8" });
    expect(list).toContain("manifest.json");
    expect(list).toContain(long);
    expect(list).toContain("1300");
    const manifest = JSON.parse(execFileSync("tar", ["-xOf", join(dir, "a.tar"), "manifest.json"], { encoding: "utf8" }));
    expect(manifest).toMatchObject({ v: 1, day: "2026-11-18", missing: ["wxchart/quick/2026-11/gone.png"] });
    expect(manifest.files.map((f: { table: string }) => f.table).sort()).toEqual(["amedas_saved", "radar_saved"]);
    const s = await offsiteSummary(db, NOW, KEYS);
    expect(s).toMatchObject({ configured: true, days: 3, lastDay: "2026-11-19", pending: 0, lastError: null });
    expect(offsiteLine(s)).toContain("3日分");
  });

  it("ファイルの多い日は分けて置き、全部置き終えた日だけが済み", async () => {
    const { db, files } = await seeded();
    const d = fakeDrive();
    const day = Date.parse("2026-11-18T18:00:00Z"); // 11/19 3:00（11/18 まで）
    expect(await copyOffsite(db, bucket(files), KEYS, day, d, 1)).toMatchObject({ day: "2026-11-17", pending: 1 });
    expect(await copyOffsite(db, bucket(files), KEYS, day, d, 1)).toMatchObject({ day: "2026-11-18", files: 1, pending: 1 });
    expect(await pendingDays(db, day)).toEqual(["2026-11-18"]);
    expect(await copyOffsite(db, bucket(files), KEYS, day, d, 1)).toMatchObject({ day: "2026-11-18", pending: 1 });
    expect(d.calls.slice(1)).toEqual(["upload F1 2026-11-17.tar", "upload F1 2026-11-18_1of3.tar", "upload F1 2026-11-18_2of3.tar"]);
    expect(await copyOffsite(db, bucket(files), KEYS, day, d, 1)).toMatchObject({ day: "2026-11-18", pending: 0 });
    expect(await pendingDays(db, day)).toEqual([]);
    expect((await offsiteSummary(db, day, KEYS)).days).toBe(2);
  });

  it("読み戻した中身がちがえば済みにせず、失敗を残す（次の回に置き直す）", async () => {
    const { db, files } = await seeded();
    const d = fakeDrive();
    d.corrupt = true;
    await expect(copyOffsite(db, bucket(files), KEYS, NOW, d)).rejects.toThrow("読み戻した中身がちがう");
    const s = await offsiteSummary(db, NOW, KEYS);
    expect(s).toMatchObject({ days: 0, pending: 3, lastError: { day: "2026-11-17" } });
    d.corrupt = false;
    await copyOffsite(db, bucket(files), KEYS, NOW + 5 * 60_000, d);
    expect((await offsiteSummary(db, NOW, KEYS)).lastError).toBeNull();
  });

  it("たまったら見張りの注意（3日より多く）", () => {
    const view = (p: number) => ({
      state: { forecastLastOk: new Date(NOW).toISOString(), typhoonLastOk: new Date(NOW).toISOString(), openAlerts: [], accountErrorsLastDay: [], offsitePending: p },
      room: { d1Size: null, d1WritesMonth: { percent: 1 }, r2: { percentOfFree: 1 }, cron: { runsLastDay: 288, stages: [] } },
      waste: { unparsed: 0, parseFailed: 0, fetchFailuresLastDay: 0 },
    });
    expect(judgeHealth(view(3) as never, NOW).notes.map((x) => x.key)).not.toContain("offsiteBehind");
    expect(judgeHealth(view(4) as never, NOW).notes.map((x) => x.key)).toContain("offsiteBehind");
  });
});

describe("Google ドライブとのやり取り", () => {
  function server(opts: { folder?: boolean; tokenStatus?: number } = {}) {
    const seen: { url: string; method: string; auth: string | null; body?: string }[] = [];
    const files = new Map<string, Uint8Array>();
    const get = async (url: string, init: RequestInit = {}) => {
      const h = new Headers(init.headers);
      seen.push({ url, method: init.method ?? "GET", auth: h.get("authorization"), body: typeof init.body === "string" ? init.body : undefined });
      const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
      if (url.startsWith("https://oauth2.googleapis.com/token")) return opts.tokenStatus ? json({ error: "invalid_grant", error_description: "Token has been expired" }, opts.tokenStatus) : json({ access_token: "AT" });
      if (url.includes("/drive/v3/files?q=")) return json({ files: opts.folder ? [{ id: "F0" }] : [] });
      if (url.includes("/drive/v3/files?fields=id")) return json({ id: "F9" });
      if (url.includes("uploadType=resumable")) return json({}, 200, { location: "https://upload.example/session1" });
      if (url === "https://upload.example/session1") {
        files.set("T1", new Uint8Array(init.body as Uint8Array));
        return json({ id: "T1" });
      }
      if (url.includes("/files/T1?alt=media")) return new Response(files.get("T1") as Uint8Array<ArrayBuffer>);
      return json({}, 404);
    };
    return { get, seen };
  }

  it("鍵で access token を取り、フォルダを探して（無ければ作り）、resumable で置いて読み戻す", async () => {
    const s = server();
    const d = new Drive(KEYS, s.get);
    expect(await d.folder()).toBe("F9");
    const id = await d.upload("F9", "2026-11-17.tar", new Uint8Array([1, 2, 3]));
    expect([...(await d.download(id))]).toEqual([1, 2, 3]);
    expect(s.seen.filter((x) => x.url.includes("oauth2")).length).toBe(1); // token は1回
    expect(s.seen.find((x) => x.url.includes("uploadType=resumable"))?.body).toContain('"parents":["F9"]');
    expect(s.seen.filter((x) => x.url.includes("googleapis.com/drive") || x.url.includes("/upload/drive")).every((x) => x.auth === "Bearer AT")).toBe(true);
    expect(await new Drive(KEYS, server({ folder: true }).get).folder()).toBe("F0");
  });

  it("失敗の文言に鍵や応答の中身を入れない", async () => {
    const d = new Drive(KEYS, server({ tokenStatus: 400 }).get);
    const e = await d.folder().catch((x: Error) => x.message);
    expect(e).toBe("ドライブの鍵: HTTP 400 invalid_grant");
    expect(e).not.toMatch(/xyz|expired/i);
  });
});

describe("tar", () => {
  it("512バイトの区切りで、最後に空の2つ", () => {
    const t = tar([{ name: "a.txt", data: new Uint8Array(513) }], 0);
    expect(t.length).toBe(512 + 1024 + 1024);
  });
});
