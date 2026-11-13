# Run after `vite build`: python3 e2e/swupdate.py
# Simulates a deploy: load the built app, change sw.js (as a new build would), let the app look
# for it, then send the app to the background and see that it reloads onto the new worker, keeping the day.
import functools, http.server, shutil, tempfile, threading, os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "dist", "client")
DIST = os.path.join(tempfile.mkdtemp(), "dist")
shutil.rmtree(DIST, ignore_errors=True)
shutil.copytree(SRC, DIST)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def do_GET(self):
        if self.path.startswith("/api/"):
            self.send_response(503); self.end_headers(); return
        if not os.path.exists(os.path.join(DIST, self.path.split("?")[0].lstrip("/"))):
            self.path = "/index.html"
        return super().do_GET()

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8811), functools.partial(H, directory=DIST))
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True
def check(name, cond, detail=""):
    global ok
    ok &= bool(cond)
    print(("OK  " if cond else "NG  ") + name, detail)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto("http://127.0.0.1:8811/")
    pg.wait_for_function("navigator.serviceWorker.controller !== null", timeout=20000)
    pg.reload(); pg.wait_for_timeout(1500)
    pg.evaluate("window.__marker = 1")
    pg.locator(".side .arrow").nth(1).click(); pg.wait_for_timeout(400)
    day = pg.locator(".side .date-button").first.inner_text()
    v1 = pg.evaluate("navigator.serviceWorker.controller.scriptURL")

    pg.evaluate("navigator.serviceWorker.addEventListener('controllerchange', () => window.__swChanged = true)")
    # A new build: sw.js changes.
    with open(f"{DIST}/sw.js", "a") as f: f.write("\n// new build\n")
    # Pretend the app was resumed more than 5 minutes later: move the clock and fire visibilitychange.
    pg.evaluate("""() => { const real = Date.now; Date.now = () => real() + 6 * 60_000;
      document.dispatchEvent(new Event('visibilitychange')); }""")
    pg.wait_for_function("window.__swChanged === true", timeout=20000)
    check("新しい版を自動で取りに行き、入れ替わる", True)
    pg.wait_for_timeout(500)
    check("画面に出ている間は再読み込みしない", pg.evaluate("window.__marker") == 1)

    # Go to the background.
    with pg.expect_navigation(timeout=10000):
        pg.evaluate("""() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
          document.dispatchEvent(new Event('visibilitychange')); }""")
    pg.wait_for_timeout(2000)
    check("裏に回ったら再読み込みして新しい版に", pg.evaluate("window.__marker") is None)
    check("見ていた日はそのまま", pg.locator(".side .date-button").first.inner_text() == day, day)
    b.close()
srv.shutdown()
print("ALL OK" if ok else "FAILED")
sys.exit(0 if ok else 1)
