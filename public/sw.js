// Weather Note service worker: makes the app installable and lets it open without a connection.
//
// - The page (navigations): network first, so a new version shows up on the next open (the same
//   promise as the no-cache header); the last good copy is used only when offline.
// - Built assets (/assets/*): their names carry a hash and never change, so cache first.
// - Icons and the manifest: the cached copy at once, refreshed in the background.
// - The API (/api/*) is never touched here: the app keeps its own weather data (IndexedDB) and its
//   own rules for what is fresh (正本管理).

const CACHE = "weather-note-shell-v1";

/** The page and the built files it names (the first visit loads them before this worker runs). */
async function precache() {
  const c = await caches.open(CACHE);
  const page = await fetch("/", { cache: "no-cache" });
  const html = await page.clone().text();
  const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await c.put("/", page);
  await c.addAll(["/manifest.webmanifest", "/icons/icon-192.png", ...files]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(req).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      }),
    );
  }
});
