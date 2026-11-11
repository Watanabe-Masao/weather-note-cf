// Weather Note service worker: makes the app installable and lets it open without a connection.
//
// - The page (navigations): network first, so a new version shows up on the next open (the same
//   promise as the no-cache header). The last good copy is used when offline, when the server
//   answers with an error, or when the network has not answered within NAV_TIMEOUT (a weak signal
//   should not keep the app blank); the network's answer still refreshes the copy when it comes.
// - Built files (/assets/*): their names carry a hash and never change, so cache first. The build
//   writes the full list into ASSETS, so every file — also the ones loaded later, such as the β
//   fitting worker — is cached at install, and the app works offline in full.
// - Icons and the manifest: the cached copy at once, refreshed in the background.
// - The API (/api/*) is never touched here: the app keeps its own weather data (IndexedDB) and its
//   own rules for what is fresh (正本管理). A cached API answer would bypass them.
//
// Versions: the build writes VERSION from the file list, so every deploy changes this file and the
// browser installs the new worker. It caches the new files, takes over at once, and deletes older
// caches — but keeps the one just before it, so a page still open from the previous version can
// load its own files (the server no longer has them after a deploy).

const VERSION = "__VERSION__";
const ASSETS = "__ASSETS__";
const CACHE = `weather-note-${VERSION}`;
const PREFIX = "weather-note-";
const NAV_TIMEOUT = 4000;
const STATIC = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"];

/** The page, the icons and every built file. */
async function precache() {
  const c = await caches.open(CACHE);
  const page = await fetch("/", { cache: "no-cache" });
  if (page.ok) await c.put("/", page);
  // Unbuilt (placeholder still in place): fall back to the files the page names.
  const files = Array.isArray(ASSETS) ? ASSETS : [...((await (await caches.match("/"))?.text()) ?? "").matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await c.addAll([...STATIC, ...files]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // Oldest first: keep this version and the one just before it.
        const ours = keys.filter((k) => k.startsWith(PREFIX)); // also the first worker's "weather-note-shell-v1"
        const previous = ours.filter((k) => k !== CACHE).slice(-1);
        return Promise.all(keys.filter((k) => k !== CACHE && !previous.includes(k)).map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim()),
  );
});

const save = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

function page(event) {
  const network = fetch(event.request).then((res) => {
    if (res.ok) save("/", res);
    return res;
  });
  event.waitUntil(network.catch(() => {}));
  const cached = () => caches.match("/");
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT));
  return Promise.race([network.catch(() => null), timeout]).then(async (res) => {
    if (res && res.ok) return res;
    const hit = await cached();
    if (hit) return hit;
    // No copy yet: wait for the network after all (an error page is better than nothing).
    return res ?? network.catch(() => Response.error());
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(page(event));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => save(req, res))));
    return;
  }

  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(req).then((hit) => {
        const fresh = fetch(req)
          .then((res) => save(req, res))
          .catch(() => hit);
        if (hit) event.waitUntil(fresh.catch(() => {}));
        return hit || fresh;
      }),
    );
  }
});

// ---- report notifications (worker/src/notify.ts) ------------------------------------------------

self.addEventListener("push", (event) => {
  let m = {};
  try {
    m = event.data ? event.data.json() : {};
  } catch {
    m = {};
  }
  event.waitUntil(
    self.registration.showNotification(m.title || "Weather Note", {
      body: m.body || "",
      tag: m.tag || "weather-note",
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: m.url || "/" },
    }),
  );
});

// Tapping it opens the record: in the app already open (a message), or a new window (a URL).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  const n = Number(url.searchParams.get("n")) || undefined;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (open && url.searchParams.get("report") === "1") {
        open.postMessage({ type: "report", n });
        return open.focus();
      }
      return self.clients.openWindow(url.href);
    }),
  );
});
