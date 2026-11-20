# 満月の物語の見直し用の記録（docs/moon-story.md「見直しの仕方」）。`vite build` のあとに：
#   python3 scripts/story-capture.py <満月の日（UTC の日時）> <出力フォルダ> [コマ数=240] [幅=390]
#   例：python3 scripts/story-capture.py 2026-11-24T03:00:00Z /tmp/beaver
# その日に時計を合わせ、見出しの絵 → 説明 → 物語を開き、本の表紙から今夜の情報まで少しずつスクロールして撮る。
# 出力：f000.png…（1コマずつ）、strip.png（16枚を並べた一覧）、story.mp4（ffmpeg があれば）。
# 撮る環境の書体は iPhone と違う（明朝・欧文は似た書体になる）。動画はレビュー用で、アプリでは使わない。
import functools, http.server, os, shutil, subprocess, sys, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.environ.get("WN_DIST") or os.path.join(HERE, "..", "dist", "client")
PORT = int(os.environ.get("WN_PORT", "8831"))
AT, OUT = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 240
W = int(sys.argv[4]) if len(sys.argv) > 4 else 390
os.makedirs(OUT, exist_ok=True)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith("/api/"):
            self.send_response(503); self.end_headers(); return
        if not os.path.exists(os.path.join(DIST, self.path.split("?")[0].lstrip("/"))):
            self.path = "/index.html"
        return super().do_GET()

srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(H, directory=DIST))
threading.Thread(target=srv.serve_forever, daemon=True).start()
CLOCK = """{const T=Date.parse('%s');const RD=Date;const off=T-RD.now();
  class D extends RD{constructor(...a){super(...(a.length?a:[RD.now()+off]))} static now(){return RD.now()+off}}
  globalThis.Date=D;}""" % AT

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": W, "height": 844}, is_mobile=True, has_touch=True, locale="ja-JP", timezone_id="Asia/Tokyo", service_workers="block")
    ctx.add_init_script(CLOCK)
    pg = ctx.new_page()
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_timeout(1500)
    pg.locator(".brand-art").click(); pg.wait_for_timeout(700)
    pg.locator(".event-sheet .fm-open-btn").click(); pg.wait_for_timeout(2000)
    end = pg.evaluate("(() => { const i = document.querySelector('.ms-info'); return i.offsetTop + i.offsetHeight - innerHeight })()")
    for i in range(N + 1):
        pg.evaluate(f"document.querySelector('.moon-story').scrollTo(0, {end * i / N})"); pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(OUT, f"f{i:03d}.png"))
    b.close()

from PIL import Image
idx = [round(k * N / 15) for k in range(16)]
ims = [Image.open(os.path.join(OUT, f"f{i:03d}.png")).resize((W // 2, 422)) for i in idx]
strip = Image.new("RGB", (W // 2 * 8, 422 * 2))
for k, im in enumerate(ims): strip.paste(im, ((k % 8) * (W // 2), (k // 8) * 422))
strip.save(os.path.join(OUT, "strip.png"))
if shutil.which("ffmpeg"):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "20", "-i", os.path.join(OUT, "f%03d.png"), "-vf", f"scale={W}:-2,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", os.path.join(OUT, "story.mp4")], check=True)
print(f"{OUT}/strip.png" + (f" {OUT}/story.mp4" if shutil.which("ffmpeg") else ""))
