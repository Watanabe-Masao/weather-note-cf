// Edge caching follows the same kinds as the app (spec 2.1): fixed data is cached for a year, or for
// a day while it is still in its re-check period (shared/fixed.ts); anything that can still change is
// never cached (the forecast is the one exception: cachedFor, 30 minutes).
// If the Cache API is unavailable (local tests, some hostnames), everything still works uncached.

export const FIXED_CACHE = "public, max-age=31536000, immutable";
export const NO_CACHE = "no-store";

export interface Produced<T> {
  body: T;
  fixed: boolean;
  /** Edge lifetime in seconds for fixed data still being re-checked (default: a year). */
  ttl?: number;
}

/** Fixed data in its re-check period stays at the edge for a day, so a correction shows up soon. */
export const RECHECK_TTL = 24 * 60 * 60;

function edgeCache(): Cache | null {
  const c = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return c?.default ?? null;
}

const json = (body: unknown, fixed: boolean, status = 200, ttl?: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": !fixed ? NO_CACHE : ttl ? `public, max-age=${ttl}` : FIXED_CACHE,
    },
  });

export function jsonResponse(body: unknown, status = 200): Response {
  return json(body, false, status);
}

/** Look up `key` in the edge cache; otherwise produce it and keep it only when fixed. */
export async function cachedJson<T>(
  origin: string,
  key: string,
  waitUntil: (p: Promise<unknown>) => void,
  produce: () => Promise<Produced<T>>,
): Promise<Response> {
  const cache = edgeCache();
  const cacheKey = new Request(`${origin}/__cache/${key}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const { body, fixed, ttl } = await produce();
  const response = json(body, fixed, 200, ttl);
  if (cache && fixed) waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

/** Read a fixed value from the edge cache without producing it. */
export async function cachedValue<T>(origin: string, key: string): Promise<T | null> {
  const cache = edgeCache();
  if (!cache) return null;
  const hit = await cache.match(new Request(`${origin}/__cache/${key}`));
  return hit ? ((await hit.json()) as T) : null;
}

export function storeValue(origin: string, key: string, value: unknown, waitUntil: (p: Promise<unknown>) => void, ttl?: number) {
  const cache = edgeCache();
  if (!cache) return;
  waitUntil(cache.put(new Request(`${origin}/__cache/${key}`), json(value, true, 200, ttl)));
}

/**
 * Data that changes slowly (the forecast): keep it at the edge for `ttl` seconds. The key carries
 * the time slot, so an entry is never served past its slot even if the cache keeps it longer.
 * The browser always gets no-store, so the app's own refresh rules stay in charge.
 */
export async function cachedFor<T>(
  origin: string,
  key: string,
  ttl: number,
  waitUntil: (p: Promise<unknown>) => void,
  produce: () => Promise<T>,
  now: number = Date.now(),
): Promise<Response> {
  const cache = edgeCache();
  const slot = Math.floor(now / (ttl * 1000));
  const cacheKey = new Request(`${origin}/__cache/${key}/${slot}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(hit.body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": NO_CACHE } });
  }
  const body = await produce();
  if (cache) {
    const stored = new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${ttl}` },
    });
    waitUntil(cache.put(cacheKey, stored));
  }
  return jsonResponse(body);
}
