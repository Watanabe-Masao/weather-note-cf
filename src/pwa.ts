// Installable app (PWA): register the service worker and keep the app on the newest version.
//
// The browser looks for a new worker only when a page is opened (and at most daily), but an app
// on the home screen is mostly resumed, not opened, and could stay on an old version for days. So:
//  - Look: on resume (at most every CHECK_GAP) and every CHECK_EVERY while on screen, ask for sw.js.
//  - Take: a new worker caches the new files and takes over at once (sw.js). The page still runs
//    the old code, so it reloads — but only out of sight (when the app goes to the background) and
//    with no sheet open, so nothing in front of the person changes under their hand. The day being
//    looked at survives the reload (state.ts keeps it for the session).

const CHECK_GAP = 5 * 60_000;
const CHECK_EVERY = 30 * 60_000;

export function startPwa(): void {
  if (!("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  // The first install also takes over the page (clients.claim); that is not an update.
  let hadController = !!sw.controller;

  window.addEventListener("load", () => {
    sw.register("/sw.js")
      .then((reg) => {
        let lastCheck = Date.now();
        const check = () => {
          if (Date.now() - lastCheck < CHECK_GAP) return;
          lastCheck = Date.now();
          reg.update().catch(() => {
            // Offline: try again next time.
          });
        };
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
        window.addEventListener("online", check);
        setInterval(() => {
          if (document.visibilityState === "visible") check();
        }, CHECK_EVERY);
      })
      .catch(() => {
        // Without it the app still works as a page.
      });
  });

  let pending = false;
  const reloadIfQuiet = () => {
    if (!pending || document.visibilityState !== "hidden" || document.querySelector(".msheet")) return;
    pending = false;
    location.reload();
  };
  sw.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    pending = true;
    reloadIfQuiet();
  });
  document.addEventListener("visibilitychange", reloadIfQuiet);
}
