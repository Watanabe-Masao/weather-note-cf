// 空の写真の保存と削除（段階 1a）。同意・写真の情報の残り・再送・上限・削除・アカウントの削除・天気の記録との結び。
import { beforeEach, describe, expect, it } from "vitest";
import { COOKIE } from "../worker/src/accounts";
import worker from "../worker/src/index";
import { cleanJpeg, RESEARCH_CAP_BYTES } from "../worker/src/skyPhotos";
import { d1 } from "./d1";

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const ORIGIN = "https://wn.test";
const SETUP_CODE = "setup-code-for-tests";

function bucket() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    put: async (k: string, v: ArrayBuffer | Uint8Array) => void files.set(k, new Uint8Array(v as ArrayBuffer)),
    get: async (k: string) => (files.has(k) ? { arrayBuffer: async () => files.get(k)!.buffer as ArrayBuffer } : null),
    delete: async (k: string | string[]) => void (Array.isArray(k) ? k : [k]).forEach((x) => files.delete(x)),
  };
}

let env: { DB: ReturnType<typeof d1>; SETUP_CODE?: string; RESEARCH: ReturnType<typeof bucket> };
beforeEach(() => {
  env = { DB: d1(), SETUP_CODE, RESEARCH: bucket() };
});

async function call(path: string, init: { body?: unknown; form?: FormData; cookie?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.cookie) headers.Cookie = `${COOKIE}=${init.cookie}`;
  const method = init.body !== undefined || init.form ? "POST" : "GET";
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined) }), env, ctx);
  const type = res.headers.get("Content-Type") ?? "";
  return { status: res.status, type, body: type.includes("json") ? ((await res.json()) as Record<string, any>) : null, cookie: res.headers.get("Set-Cookie")?.match(new RegExp(`${COOKIE}=([^;]*)`))?.[1] ?? null };
}

async function admin() {
  const r = await call("/api/auth/setup", { body: { code: SETUP_CODE, loginId: "masao", name: "渡辺" } });
  return r.cookie!;
}
async function person(adminCookie: string, loginId: string) {
  const p = (await call("/api/admin/users", { body: { loginId }, cookie: adminCookie })).body!;
  return { cookie: (await call("/api/auth/login", { body: { loginId, password: p.password } })).cookie!, password: p.password as string };
}
const consent = (cookie: string, granted: boolean) => call("/api/me/consent", { body: { granted, kind: "sky" }, cookie });

/** JPEG：SOI・量子化表（DQT）・SOS だけ。exif=true なら APP1 の Exif を入れる。 */
function jpeg(exif = false, pad = 0) {
  const parts = [0xff, 0xd8];
  if (exif) parts.push(0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00);
  parts.push(0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02);
  return new Uint8Array([...parts, ...new Array(pad).fill(0), 0xff, 0xd9]);
}
function photo(meta: Record<string, unknown>, image = jpeg(), thumb = jpeg()) {
  const f = new FormData();
  f.set("meta", JSON.stringify({ id: "photo-0001", takenAt: "2026-11-15T16:52:00+09:00", timeSource: "exif", ...meta }));
  f.set("image", new Blob([image], { type: "image/jpeg" }), "p.jpg");
  f.set("thumb", new Blob([thumb], { type: "image/jpeg" }), "t.jpg");
  return f;
}

describe("JPEG の写真の情報の残り", () => {
  it("描き直した JPEG は ok、Exif が残っていれば has-metadata、JPEG でなければ not-jpeg", () => {
    expect(cleanJpeg(jpeg().buffer)).toBe("ok");
    expect(cleanJpeg(jpeg(true).buffer)).toBe("has-metadata");
    expect(cleanJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBe("not-jpeg");
  });
});

describe("空の写真の保存（段階 1a）", () => {
  it("同意した人だけ。同意なしは 403、ログインなしは 401", async () => {
    const a = await admin();
    expect((await call("/api/me/photos", { form: photo({}), cookie: a })).status).toBe(403);
    expect((await call("/api/me/photos", { form: photo({}) })).status).toBe(401);
    await consent(a, true);
    const r = await call("/api/me/photos", { form: photo({}), cookie: a });
    expect(r.status).toBe(200);
    expect(r.body!.photos).toHaveLength(1);
    expect([...env.RESEARCH.files.keys()].sort()).toEqual(["photos/photo-0001.jpg", "photos/photo-0001.thumb.jpg"]);
  });

  it("Exif が残った写真・JPEG でないものは受けない。同じ ID の再送は 1 件", async () => {
    const a = await admin();
    await consent(a, true);
    expect((await call("/api/me/photos", { form: photo({}, jpeg(true)), cookie: a })).status).toBe(400);
    expect((await call("/api/me/photos", { form: photo({}, new Uint8Array([1, 2, 3, 4])), cookie: a })).status).toBe(415);
    expect(env.RESEARCH.files.size).toBe(0);
    await call("/api/me/photos", { form: photo({}), cookie: a });
    const again = await call("/api/me/photos", { form: photo({}), cookie: a });
    expect(again.body).toMatchObject({ again: true });
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sky_photos").get()).toEqual({ n: 1 });
  });

  it("磁北の方位は撮影地点で真北に、場所を約 1 km に丸め、太陽は撮影地点で", async () => {
    const a = await admin();
    await consent(a, true);
    await call("/api/me/photos", { form: photo({ dir: 270, dirRef: "M", dirSource: "exif", lat: 33.56789, lon: 133.54321 }), cookie: a });
    const row = env.DB.raw.prepare("SELECT lat, lon, dir_true, dir_estimated, decl_model, sun_at, sun_alt FROM sky_photos").get() as Record<string, number | string>;
    expect(row.lat).toBe(33.57);
    expect(row.lon).toBe(133.54);
    expect(row.dir_true as number).toBeCloseTo(262.44, 0);
    expect(row.dir_estimated).toBe(0);
    expect(row.decl_model).toBe("gsi2020.0");
    expect(row.sun_at).toBe("photo");
    expect(row.sun_alt as number).toBeLessThan(5); // 11/15 16:52 の高知は日の入り前後
  });

  it("場所が無ければ太陽は観測所で、手で選んだ方角は推定", async () => {
    const a = await admin();
    await consent(a, true);
    await call("/api/me/photos", { form: photo({ dir: 270, dirSource: "manual" }), cookie: a });
    expect(env.DB.raw.prepare("SELECT lat, sun_at, dir_true, dir_estimated FROM sky_photos").get()).toEqual({ lat: null, sun_at: "station", dir_true: 270, dir_estimated: 1 });
  });

  it("天気を選んでいれば天気の記録（正本）に photo: の行を書き、選ばなければ書かない", async () => {
    const a = await admin();
    await consent(a, true);
    await call("/api/me/photos", { form: photo({ sky: "rain", intensity: "para" }), cookie: a });
    await call("/api/me/photos", { form: photo({ id: "photo-0002" }), cookie: a });
    expect(env.DB.raw.prepare("SELECT id, source, ref_id, sky, intensity FROM weather_obs").all()).toEqual([{ id: "photo:photo-0001", source: "photo", ref_id: "photo-0001", sky: "rain", intensity: "para" }]);
  });

  it("保存先が 5 GB の 95% を超えるなら受けない（507）", async () => {
    const a = await admin();
    await consent(a, true);
    const u = env.DB.raw.prepare("SELECT id FROM users").get() as { id: string };
    env.DB.raw.prepare("INSERT INTO sky_photos (user_id, id, bytes, thumb_bytes, created_at) VALUES (?, 'big', ?, 0, 0)").run(u.id, Math.ceil(RESEARCH_CAP_BYTES * 0.95));
    expect((await call("/api/me/photos", { form: photo({}), cookie: a })).status).toBe(507);
  });
});

describe("空の写真を見る・消す", () => {
  it("同意を取り消しても、本人は一覧と削除ができる。写真の数は me に出る", async () => {
    const a = await admin();
    const p = await person(a, "sato");
    await consent(p.cookie, true);
    await call("/api/me/photos", { form: photo({ sky: "sunny" }), cookie: p.cookie });
    await consent(p.cookie, false);
    expect((await call("/api/me/photos", { form: photo({ id: "photo-0003" }), cookie: p.cookie })).status).toBe(403);
    expect((await call("/api/auth/me", { cookie: p.cookie })).body!.user.photoCount).toBe(1);
    expect((await call("/api/me/photos", { cookie: p.cookie })).body!.photos).toHaveLength(1);
    const thumb = await call("/api/me/photos/thumb?id=photo-0001", { cookie: p.cookie });
    expect(thumb.status).toBe(200);
    expect(thumb.type).toBe("image/jpeg");
    const del = await call("/api/me/photos/delete", { body: { id: "photo-0001" }, cookie: p.cookie });
    expect(del.body!.photos).toEqual([]);
    expect(env.RESEARCH.files.size).toBe(0);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM weather_obs").get()).toEqual({ n: 0 });
  });

  it("ほかの人の写真は見られない・消せない。管理者は一覧（研究用の番号で）と削除ができる", async () => {
    const a = await admin();
    const p = await person(a, "sato");
    const q = await person(a, "kato");
    await consent(p.cookie, true);
    await call("/api/me/photos", { form: photo({}), cookie: p.cookie });
    expect((await call("/api/me/photos/thumb?id=photo-0001", { cookie: q.cookie })).status).toBe(404);
    expect((await call("/api/me/photos/delete", { body: { id: "photo-0001" }, cookie: q.cookie })).status).toBe(404);
    expect(env.RESEARCH.files.size).toBe(2);
    const list = await call("/api/admin/photos", { cookie: a });
    expect(list.body!.photos[0]).toHaveProperty("research_id");
    expect(JSON.stringify(list.body)).not.toContain("sato");
    expect((await call("/api/admin/photos", { cookie: p.cookie })).status).toBe(403);
    await call("/api/admin/photos/delete", { body: { id: "photo-0001" }, cookie: a });
    expect(env.RESEARCH.files.size).toBe(0);
  });

  it("アカウントを消すと写真のファイルも行も消える", async () => {
    const a = await admin();
    const p = await person(a, "sato");
    await consent(p.cookie, true);
    await call("/api/me/photos", { form: photo({ sky: "cloudy" }), cookie: p.cookie });
    expect((await call("/api/me/delete", { body: { password: p.password }, cookie: p.cookie })).status).toBe(200);
    expect(env.RESEARCH.files.size).toBe(0);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sky_photos").get()).toEqual({ n: 0 });
  });
});
