// Edge caching follows the same two kinds as the app (spec 2.1):
// fixed data is cached for a year, anything that can still change is never cached.
// If the Cache API is unavailable (local tests, some hostnames), everything still works uncached.

export const FIXED_CACHE = "public, max-age=31536000, immutable";
export const NO_CACHE = "no-store";

export interface Produced<T> {
  body: T;
  fixed: boolean;
}

function edgeCache(): Cache | null {
  const c = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return c?.default ?? null;
}

const json = (body: unknown, fixed: boolean, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": fixed ? FIXED_CACHE : NO_CACHE,
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
  const { body, fixed } = await produce();
  const response = json(body, fixed);
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

export function storeValue(origin: string, key: string, value: unknown, waitUntil: (p: Promise<unknown>) => void) {
  const cache = edgeCache();
  if (!cache) return;
  waitUntil(cache.put(new Request(`${origin}/__cache/${key}`), json(value, true)));
}
