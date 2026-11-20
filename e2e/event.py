# イベントの日の見出し（docs/event-banner.md 6章）。`vite build` のあとに：python3 e2e/event.py 390|360
# 時計を満月の日（2026-11-24 ビーバームーン）に合わせ、3テーマで：絵の帯がアイコンと文字の場所に1枚、見出しの高さは
# ふだんの日と同じ、「比較｜1日」と重ならない、押すと説明が開き閉じると消える。絵が読めないと手描きの帯（アイコンつき）。
# ふだんの日は絵を読まず、前日は翌日の絵を読んでおく。
import functools, http.server, threading, os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.environ.get("WN_DIST") or os.path.join(HERE, "..", "dist", "client")
PORT = int(os.environ.get("WN_PORT", "8812"))
SHOTS = os.environ.get("WN_SHOTS")
W = int(sys.argv[1]) if len(sys.argv) > 1 else 390

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
ok = True
def check(name, cond, detail=""):
    global ok
    ok &= bool(cond)
    print(("  OK " if cond else "  NG ") + name, detail if not cond else "")

def clock(iso):
    return """{const T=Date.parse('%s');const RD=Date;const off=T-RD.now();
      class D extends RD{constructor(...a){super(...(a.length?a:[RD.now()+off]))} static now(){return RD.now()+off}}
      globalThis.Date=D;}""" % iso

HEAD = """() => { const h = document.querySelector('.app-head'); const art = document.querySelector('.brand-art');
  const own = document.querySelector('.brand');
  const others = [...h.querySelectorAll('button, [role=tab], a')].filter(e => !own.contains(e)).map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
  const a = art && art.getBoundingClientRect();
  return { head: Math.round(h.getBoundingClientRect().height), art: a && { w: Math.round(a.width), h: Math.round(a.height), right: a.right },
    left: others.length ? Math.min(...others.filter(r => !a || r.left >= a.left).map(r => r.left)) : null,
    img: (document.querySelector('.brand-art img') || {}).naturalWidth || 0,
    icon: document.querySelectorAll('.brand-icon').length, hand: document.querySelectorAll('.brand-event').length } }"""

def page(b, iso, theme, block=False):
    ctx = b.new_context(viewport={"width": W, "height": 844}, device_scale_factor=2 if SHOTS else 1, is_mobile=True, has_touch=True, locale="ja-JP", timezone_id="Asia/Tokyo", service_workers="block")
    ctx.add_init_script(clock(iso))
    ctx.add_init_script(f"try {{ localStorage.setItem('weather-note-theme', '{theme}') }} catch {{}}")
    asked = []
    ctx.on("request", lambda r: "/event/" in r.url and asked.append(r.url))
    if block: ctx.route("**/event/**", lambda r: r.fulfill(status=404, body="none"))
    pg = ctx.new_page()
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_timeout(1500)
    return ctx, pg, asked

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    print(f"イベントの日の見出し {W}px")
    for theme in ("navy", "warm", "mist"):
        ctx, pg, asked = page(b, "2026-11-10T03:00:00Z", theme)
        base = pg.evaluate(HEAD); pg.wait_for_timeout(3600)
        check(f"[{theme}] ふだんの日：アイコンと文字、絵は読まない", base["icon"] == 1 and base["art"] is None and base["hand"] == 0 and not asked, (base, asked))
        ctx.close()
        ctx, pg, asked = page(b, "2026-11-23T03:00:00Z", theme)
        pg.wait_for_timeout(3600)
        check(f"[{theme}] 前日：翌日の絵を読んでおく", any(f"/event/beaver-{theme}.webp?v=" in u for u in asked), asked)
        ctx.close()
        ctx, pg, asked = page(b, "2026-11-24T03:00:00Z", theme)
        pg.wait_for_function("(document.querySelector('.brand-art img') || {}).naturalWidth > 0", timeout=5000)
        ev = pg.evaluate(HEAD)
        if SHOTS: pg.locator(".app-head").screenshot(path=f"{SHOTS}-event-{theme}-{W}.png")
        check(f"[{theme}] 満月の日：絵の帯が1枚（アイコンなし）、横4：縦1、見出しの高さはふだんと同じ、右の操作と重ならない",
              ev["img"] > 0 and ev["icon"] == 0 and ev["hand"] == 0 and abs(ev["art"]["w"] / ev["art"]["h"] - 4) < 0.15 and ev["head"] == base["head"] and (ev["left"] is None or ev["art"]["right"] <= ev["left"]), (ev, base["head"]))
        pg.locator(".brand-art").click(); pg.wait_for_timeout(700)
        sheet = pg.locator(".event-sheet").inner_text() if pg.locator(".event-sheet").count() else ""
        pg.locator(".event-sheet .icon-btn.close").click(); pg.wait_for_timeout(700)
        check(f"[{theme}] 押すと説明（ビーバームーン）、閉じると消える", "ビーバームーン" in sheet and pg.locator(".event-sheet").count() == 0, sheet[:40])
        ctx.close()
        ctx, pg, asked = page(b, "2026-11-24T03:00:00Z", theme, block=True)
        pg.wait_for_timeout(800)
        fb = pg.evaluate(HEAD)
        check(f"[{theme}] 絵が読めないと手描きの帯（アイコンつき）、見出しの高さは同じ", fb["art"] is None and fb["hand"] == 1 and fb["icon"] == 1 and fb["head"] == base["head"], fb)
        ctx.close()
    b.close()
srv.shutdown()
print("ALL OK" if ok else "SOME NG")
sys.exit(0 if ok else 1)
