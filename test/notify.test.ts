import { describe, expect, it } from "vitest";
import { COOKIE, ensureSchema } from "../worker/src/accounts";
import worker from "../worker/src/index";
import { checkSettings, DEFAULT_TIMES, dueSlots, reportMessage, runSchedule, WINDOW_MS } from "../worker/src/notify";
import { b64u, encryptPayload, hkdf, newVapidKeys, type Subscription, unb64u, vapidAuth } from "../worker/src/webpush";
import { d1 } from "./d1";

const enc = new TextEncoder();
// The test plays the browser with Node's WebCrypto; the Workers type definitions do not describe it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const subtle: any = crypto.subtle;

/** The browser's side: decrypt an aes128gcm push message (RFC 8291). */
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await subtle.exportKey("raw", ua.publicKey));
  const asKey = await subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, sealed));
  expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

/** An EC key pair from RFC 8291's raw values. */
async function pairFrom(pub: string, priv: string, usage: string[]): Promise<CryptoKeyPair> {
  const p = unb64u(pub);
  const jwk = { kty: "EC", crv: "P-256", x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)) };
  return {
    publicKey: await subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []),
    privateKey: await subtle.importKey("jwk", { ...jwk, d: priv }, { name: "ECDH", namedCurve: "P-256" }, true, usage),
  };
}

describe("Web Push encryption", () => {
  it("matches the example in RFC 8291 (Appendix A)", async () => {
    const sender = await pairFrom(
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
      "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
      ["deriveBits"],
    );
    const body = await encryptPayload(
      enc.encode("When I grow up, I want to be a watermelon"),
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      "BTBZMqHH6r4Tts7J_aSIgg",
      { salt: unb64u("DGv6ra1nlYgDCS1FRnbzlw"), sender },
    );
    expect(b64u(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("can be read back by the browser it was made for", async () => {
    const ua = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const p256dh = b64u(await subtle.exportKey("raw", ua.publicKey));
    const body = await encryptPayload(enc.encode('{"title":"今、外はどう感じますか？"}'), p256dh, b64u(auth));
    expect(await decrypt(body, ua, auth)).toBe('{"title":"今、外はどう感じますか？"}');
  });

  it("signs a VAPID token for the push service's origin", async () => {
    const keys = await newVapidKeys();
    const h = await vapidAuth("https://push.example.net/send/abc", keys, "https://wn.test", Date.parse("2026-11-12T00:00:00Z"));
    const [, token, k] = h.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [head, claims, sig] = token.split(".");
    expect(JSON.parse(new TextDecoder().decode(unb64u(claims)))).toMatchObject({ aud: "https://push.example.net", sub: "https://wn.test" });
    const pub = await subtle.importKey("raw", unb64u(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(sig), enc.encode(`${head}.${claims}`))).toBe(true);
  });
});

describe("when to notify (Japan time)", () => {
  const at = (iso: string) => Date.parse(iso);
  const s = { enabled: true, times: ["07:30", "12:30", "23:55"], days: [1, 2, 3, 4, 5] }; // weekdays

  it("sends a slot from its time until the window closes, on the chosen days only", () => {
    expect(dueSlots(s, at("2026-11-12T07:29:00+09:00"))).toEqual([]); // Thursday, before
    expect(dueSlots(s, at("2026-11-12T07:30:00+09:00")).map((d) => d.slot)).toEqual(["2026-11-12 07:30"]);
    expect(dueSlots(s, at("2026-11-12T07:30:00+09:00") + WINDOW_MS - 1)).toHaveLength(1);
    expect(dueSlots(s, at("2026-11-12T07:30:00+09:00") + WINDOW_MS)).toEqual([]);
    expect(dueSlots(s, at("2026-11-15T07:31:00+09:00"))).toEqual([]); // Sunday
    expect(dueSlots({ ...s, enabled: false }, at("2026-11-12T07:31:00+09:00"))).toEqual([]);
  });

  it("still sends a late-evening slot just after midnight", () => {
    expect(dueSlots(s, at("2026-11-13T00:02:00+09:00")).map((d) => d.slot)).toEqual(["2026-11-12 23:55"]);
  });

  it("defaults to the middle of the 肌感 map's 時間帯", () => {
    expect(DEFAULT_TIMES).toEqual(["07:00", "10:00", "13:00", "16:00", "19:00"]);
  });

  it("accepts only real times and days, at most six times", () => {
    expect(checkSettings({ enabled: true, times: ["18:30", "07:05", "07:05", "25:00", "7:5"], days: [6, 0, 9] })).toEqual({ enabled: true, times: ["07:05", "18:30"], days: [0, 6] });
    expect(() => checkSettings({ enabled: true, times: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"], days: [] })).toThrow();
    expect(() => checkSettings({ enabled: "yes", times: [], days: [] })).toThrow();
  });
});

describe("the scheduled run", () => {
  async function setup() {
    const db = d1();
    await ensureSchema(db);
    const add = (id: string, disabled: number | null = null) =>
      db.raw.prepare("INSERT INTO users (id, login_id, pw_hash, pw_salt, pw_iter, research_id, created_at, disabled_at) VALUES (?, ?, 'h', 's', 1, ?, 0, ?)").run(id, id, `r${id}`, disabled);
    add("A");
    add("B");
    add("C", 1);
    const sub = (user: string, endpoint: string) => db.raw.prepare("INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, 'p', 'a', 0)").run(endpoint, user);
    sub("A", "https://push.test/a1");
    sub("A", "https://push.test/a-gone");
    sub("B", "https://push.test/b1");
    sub("C", "https://push.test/c1");
    const settings = (user: string, times: string[], updated = 0) =>
      db.raw.prepare("INSERT INTO notify_settings (user_id, enabled, times, days, updated_at) VALUES (?, 1, ?, '[0,1,2,3,4,5,6]', ?)").run(user, JSON.stringify(times), updated);
    return { db, settings };
  }

  it("sends each due slot once, to every device, and drops subscriptions that are gone", async () => {
    const { db, settings } = await setup();
    settings("A", ["07:30"]);
    settings("B", ["12:00"]);
    settings("C", ["07:30"]); // stopped account: never
    const sent: { endpoint: string; url: string }[] = [];
    const send = async (s: Subscription, m: unknown) => {
      sent.push({ endpoint: s.endpoint, url: (m as { url: string }).url });
      return s.endpoint.endsWith("gone") ? 410 : 201;
    };
    const now = Date.parse("2026-11-12T07:33:00+09:00");
    expect(await runSchedule(db, now, send)).toBe(1);
    expect(sent.map((s) => s.endpoint).sort()).toEqual(["https://push.test/a-gone", "https://push.test/a1"]);
    expect(sent[0].url).toBe(`/?report=1&n=${Date.parse("2026-11-12T07:30:00+09:00")}`);
    expect(reportMessage(Date.parse("2026-11-12T07:30:00+09:00")).title).toBe("朝の感じ方は？");
    expect(reportMessage(Date.parse("2026-11-12T13:00:00+09:00")).title).toBe("昼の感じ方は？");
    expect(reportMessage(Date.parse("2026-11-12T22:00:00+09:00")).title).toBe("今、外はどう感じますか？");
    expect(db.raw.prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = 'A'").all()).toEqual([{ endpoint: "https://push.test/a1" }]);
    // The next run (5 minutes later) does not send the same slot again.
    expect(await runSchedule(db, now + 5 * 60_000, send)).toBe(0);
    expect(db.raw.prepare("SELECT user_id, slot, devices FROM notify_log").all()).toEqual([{ user_id: "A", slot: "2026-11-12 07:30", devices: 1 }]);
  });

  it("does not send a time that had already passed when it was set", async () => {
    const { db, settings } = await setup();
    settings("A", ["07:30"], Date.parse("2026-11-12T07:31:00+09:00"));
    const send = async () => 201;
    expect(await runSchedule(db, Date.parse("2026-11-12T07:33:00+09:00"), send)).toBe(0);
    expect(await runSchedule(db, Date.parse("2026-11-13T07:33:00+09:00"), send)).toBe(2); // the next day: both devices
  });
});

describe("notification settings over the API", () => {
  it("are each person's own, with the server's public key and a test push", async () => {
    const env = { DB: d1(), SETUP_CODE: "code" };
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const call = async (path: string, body?: unknown, cookie?: string) => {
      const res = await worker.fetch(
        new Request("https://wn.test" + path, {
          method: body === undefined ? "GET" : "POST",
          headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: `${COOKIE}=${cookie}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
        ctx,
      );
      return { status: res.status, body: (await res.json()) as Record<string, any>, cookie: res.headers.get("Set-Cookie")?.match(/wn_session=([^;]*)/)?.[1] };
    };
    const me = (await call("/api/auth/setup", { code: "code", loginId: "masao" })).cookie!;
    expect((await call("/api/me/notify")).status).toBe(401);
    const first = await call("/api/me/notify", undefined, me);
    // The default: the middle of each of the 肌感 map's five 時間帯.
    expect(first.body).toEqual({ settings: { enabled: false, times: ["07:00", "10:00", "13:00", "16:00", "19:00"], days: [0, 1, 2, 3, 4, 5, 6] }, devices: 0 });
    const saved = await call("/api/me/notify", { enabled: true, times: ["08:00"], days: [1, 2, 3, 4, 5] }, me);
    expect(saved.body.settings).toEqual({ enabled: true, times: ["08:00"], days: [1, 2, 3, 4, 5] });
    expect((await call("/api/me/notify", { enabled: true, times: "08:00", days: [] }, me)).status).toBe(400);

    const key = (await call("/api/push/key", undefined, me)).body.publicKey as string;
    expect(unb64u(key)).toHaveLength(65);
    expect((await call("/api/push/key", undefined, me)).body.publicKey).toBe(key); // made once, kept

    expect((await call("/api/push/test", {}, me)).status).toBe(409); // no device yet
    expect((await call("/api/push/subscribe", { endpoint: "http://insecure", keys: { p256dh: "x", auth: "y" } }, me)).status).toBe(400);
    await call("/api/push/subscribe", { endpoint: "https://push.test/x", keys: { p256dh: "p", auth: "a" } }, me);
    expect((await call("/api/me/notify", undefined, me)).body.devices).toBe(1);
    await call("/api/push/unsubscribe", { endpoint: "https://push.test/x" }, me);
    expect((await call("/api/me/notify", undefined, me)).body.devices).toBe(0);
  });
});
