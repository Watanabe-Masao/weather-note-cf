// Web Push without a library: VAPID (RFC 8292) to say who sends, and aes128gcm (RFC 8291) to
// encrypt the message so that only the subscribed browser can read it. WebCrypto only.

const enc = new TextEncoder();
/** Byte arrays as WebCrypto wants them (the runtime types are stricter than the bytes need). */
const bs = (u: Uint8Array) => u as unknown as ArrayBuffer;

export const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function unb64u(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

/** HKDF-SHA-256 (extract and expand) to `bytes` bytes. */
export async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", bs(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(info) }, key, bytes * 8));
}

/** The server's VAPID key pair, as JWKs (made once and kept in the database). */
export interface VapidKeys {
  publicKey: string; // uncompressed P-256 point, base64url (what browsers call applicationServerKey)
  privateJwk: JsonWebKey;
}

export async function newVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
  return { publicKey: b64u(raw), privateJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey };
}

/** `Authorization: vapid t=…, k=…` for one push service (the endpoint's origin). */
export async function vapidAuth(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

/**
 * The message encrypted for one browser (aes128gcm, one record). `p256dh` and `auth` are the
 * subscription's keys. `salt` and the sender's key pair are random each time unless given (tests).
 */
export async function encryptPayload(
  payload: Uint8Array,
  p256dh: string,
  auth: string,
  fixed?: { salt: Uint8Array; sender: CryptoKeyPair },
): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const sender = fixed?.sender ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", sender.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", bs(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  // `public` is the standard name; the Workers types call it `$public`.
  const ecdhParams = { name: "ECDH", public: uaKey, $public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, sender.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", bs(cek), "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(nonce) }, aes, bs(concat(payload, new Uint8Array([2])))));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one message. Returns the push service's status (201 sent; 404/410 the subscription is gone). */
export async function sendPush(sub: Subscription, message: unknown, keys: VapidKeys, subject: string, ttl = 3 * 3600): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuth(sub.endpoint, keys, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "normal",
    },
    body: bs(body),
  });
  return res.status;
}
