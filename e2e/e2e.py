# The app end to end in a real browser (Playwright, Python): every screen and the main flows,
# against the built app (dist/client) with the weather API answered by made-up data.
#
# Run:  npx vite build && python3 e2e/e2e.py [width]
#       WN_CHROME=/path/to/chrome to use a given browser; exits 1 when a check fails (CI).
import json, re, sys, datetime, random, threading, http.server, functools, os
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
# The same wide face everywhere (DejaVu Sans is on CI and here, and is wider than the phones' faces),
# so the layout checks see what CI sees, and what fits here fits on a phone.
WIDE_FONT = ":root{--font-numeric:'DejaVu Sans',sans-serif!important;--font-family:'DejaVu Sans',sans-serif!important}"
DIST = os.environ.get("WN_DIST", os.path.join(HERE, "..", "dist", "client"))
OUT = os.environ.get("WN_SHOTS", os.path.join(HERE, "shots"))
TODAY = datetime.date(2026, 11, 10)
SKY = ["晴", "曇時々晴", "晴後一時曇", "曇一時雨", "雨後曇", "快晴", "曇"]

def row(d, kind="actual"):
    r = random.Random(d.toordinal())
    mx = round(19 + 6 * r.random() - (d.month in (12, 1, 2)) * 9, 1)
    mn = round(mx - 6 - 4 * r.random(), 1)
    rain = round(max(0, r.random() * 30 - 18), 1)
    return {"date": d.isoformat(), "n": d.day, "type": kind, "provider": "JMA", "max": mx, "min": mn, "rain": rain,
            "humidity": round(55 + 30 * r.random()), "wind": round(1 + 4 * r.random(), 1),
            "dayWeather": SKY[d.toordinal() % len(SKY)], "snow": (2.0 if (d.year, d.day) == (2025, 8) else 0), "pressure": round(1012 + 8 * r.random(), 1), "gust": round(6 + 6 * r.random(), 1), "humidityMin": round(30 + 20 * r.random()), "sun": round(9 * r.random(), 1), "temp": round(mx - 4, 1), "raw": {"max": str(mx)}, "quality": {}, "unpublished": []}

ME = {"id": "u1", "loginId": "masao", "name": "渡辺", "role": "admin", "research": {"granted": False, "version": None, "at": None}, "consentVersion": 1}
LOGGED_IN = os.environ.get("WN_LOGGED_OUT") != "1"
def api(path, q):
    if path == "/api/auth/me":
        return {"user": ME if LOGGED_IN else None, "setup": False}
    if path == "/api/me/notify":
        return {"settings": {"enabled": True, "times": ["07:30", "12:30", "18:30"], "days": [1, 2, 3, 4, 5]}, "devices": 1}
    if path == "/api/push/key":
        return {"publicKey": "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"}
    if path == "/api/reports/sync":
        return {"taken": 0, "total": 0, "reports": [], "seq": 0, "more": False}
    if path == "/api/admin/users":
        return {"users": [{"id": "u1", "login_id": "masao", "name": "渡辺", "role": "admin", "created_at": 1762800000000, "last_login": 1762800000000, "disabled_at": None, "reports": 0, "research": None}, {"id": "u2", "login_id": "tanaka", "name": None, "role": "user", "created_at": 1762800000000, "last_login": None, "disabled_at": None, "reports": 3, "research": 1}]}
    if path == "/api/stations":
        return [{"precNo": 74, "blockNo": "47893", "name": "高知", "prefecture": "高知県", "lat": [33, 33.8], "lon": [133, 33.1]}]
    if path == "/api/daily":
        y, m = map(int, q["month"].split("-"))
        d = datetime.date(y, m, 1); rows = []
        while d.month == m:
            if d < TODAY: rows.append(row(d))
            d += datetime.timedelta(days=1)
        return {"station": "47893", "month": q["month"], "rows": rows, "fixed": True, "source": None, "fetchedAt": ""}
    if path == "/api/forecast":
        rows = [dict(row(TODAY + datetime.timedelta(days=i), "forecast"), probability=[10, 30, 70, 50, 20, 0, 40, 60][i % 8], radiation=round(6 + i * 0.7, 1), confidence=("A" if i < 3 else "B" if i < 8 else "C") if i < 15 else None) for i in range(16)]
        import math
        hourly = []
        for i in range(4):
            d = TODAY + datetime.timedelta(days=i); base = row(d)
            for n in range(1, 25):
                t = round(base["min"] + (base["max"] - base["min"]) * math.sin(math.pi * max(0, min(1, (n - 5) / 14))), 1)
                hourly.append({"date": d.isoformat(), "n": n, "type": "forecast", "provider": "Open-Meteo", "temp": t, "humidity": 70, "wind": 2.0,
                               "pressure": 1015.0, "rain": 0, "probability": 20, "solar": round(max(0, 600 * math.sin(math.pi * (n - 6) / 12)), 0) if 6 < n < 18 else 0,
                               "raw": {}, "quality": {}})
        return {"rows": rows, "hourlyRows": hourly}
    if path == "/api/hourly":
        import math
        start = datetime.date.fromisoformat(q["from"]); end = datetime.date.fromisoformat(q["to"])
        days = []
        d = start
        while d <= end:
            if d.year < 2020:
                days.append({"date": d.isoformat(), "rows": [], "fixed": False, "error": "テスト用に取得失敗"})
            else:
                base = row(d)
                rows = []
                for n in range(1, 25):
                    f = (1 - math.cos((n - 5) / 24 * 2 * math.pi)) / 2 if 5 <= n <= 29 else 0
                    t = round(base["min"] + (base["max"] - base["min"]) * (math.sin(math.pi * max(0, min(1, (n - 5) / 14)))), 1)
                    rows.append({"date": d.isoformat(), "n": n, "type": ("forecast" if (d > TODAY or (d == TODAY and n > 12)) else "actual"), "provider": "JMA", "temp": t,
                                 "humidity": 80 - (t - base["min"]) * 2, "pressure": round(base["pressure"] + 3 * math.sin(n / 4), 1), "wind": 1.5 + (n % 5) * 0.4,
                                 "sun": round(max(0, min(1, 1.1 * math.sin(math.pi * (n - 6) / 12))), 1) if 6 < n < 18 else 0, "rain": 1.5 if n in (20, 21) else 0, "radiation": round(max(0, 2.2 * math.sin(math.pi * (n - 6) / 12)), 2) if 6 < n < 18 else None,
                                 "raw": {}, "quality": {}, "unpublished": []})
                days.append({"date": d.isoformat(), "rows": rows, "fixed": True})
            d += datetime.timedelta(days=1)
        return {"station": "47893", "days": days, "fetchedAt": ""}
    if path == "/api/sun":
        return {"date": q["date"], "sunrise": q["date"] + "T06:31", "sunset": q["date"] + "T17:12"}
    if path == "/api/current":
        return {"rows": [], "latest": None}
    if path == "/api/recent":
        return {"daily": row(datetime.date.fromisoformat(q["date"])), "rows": []}
    return {"error": "nope"}

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if not self.path.startswith("/api/") and not os.path.exists(DIST + self.path.split("?")[0]):
            self.path = "/index.html"
        return super().do_GET()

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8799), functools.partial(H, directory=DIST))
threading.Thread(target=srv.serve_forever, daemon=True).start()


results = []
def check(name, cond, detail=""):
    results.append((bool(cond), name, detail))

ONLY = [x for x in os.environ.get("WN_ONLY", "").split(",") if x]

def step(name, fn):
    # WN_ONLY=A,T runs only those steps (and the first view), for looking into one failure.
    if ONLY and name not in ONLY and name != "A":
        return
    try:
        fn()
    except Exception as e:
        results.append((False, name, "EXCEPTION " + str(e).splitlines()[0][:160]))

errors = []
W = int(sys.argv[1]) if len(sys.argv) > 1 else 390
with sync_playwright() as p:
    # A given browser (WN_CHROME), else Playwright's own Chromium (CI installs it).
    chrome = os.environ.get("WN_CHROME")
    b = p.chromium.launch(**({"executable_path": chrome} if chrome else {}), args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": W, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True, locale="ja-JP", timezone_id="Asia/Tokyo")
    ctx.add_init_script("""{const T=Date.parse('2026-11-10T03:00:00Z');const RD=Date;const off=T-RD.now();
      class D extends RD{constructor(...a){super(...(a.length?a:[RD.now()+off]))} static now(){return RD.now()+off}}
      globalThis.Date=D;}""")
    FAIL = set()  # parts of a URL that answer 500 (a step makes a request fail on purpose)
    FAILED_ON_PURPOSE = []
    def handle(route):
        from urllib.parse import urlparse, parse_qs
        if any(f in route.request.url for f in FAIL):
            FAILED_ON_PURPOSE.append(route.request.url)
            return route.fulfill(status=500, content_type="application/json", body=json.dumps({"error": "テスト用の失敗"}))
        u = urlparse(route.request.url)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(api(u.path, q)))
    ctx.route("**/api/**", handle)
    pg = ctx.new_page()
    pg.on("console", lambda m: m.type in ("error", "warning") and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    pg.goto("http://127.0.0.1:8799/")
    pg.wait_for_timeout(1500)
    pg.add_script_tag(path=os.path.join(HERE, "flick.js")); pg.add_script_tag(path=os.path.join(HERE, "layout.js")); pg.add_style_tag(content=WIDE_FONT)
    cdp = ctx.new_cdp_session(pg)
    wait = pg.wait_for_timeout
    txt = lambda sel: pg.locator(sel).first.inner_text()
    title = lambda: txt(".sheet-head-title")
    no_overflow = lambda: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    # Text that runs out of its box, lies on other text, or is cut short (e2e/layout.js, #151).
    def layout_ok(code, where):
        r = pg.evaluate("__layoutIssues()")
        bad = r["overflow"] + r["overlap"] + r["clipped"]
        check(f"{code} 文字のはみ出し・重なり・切れがない（{where}）", not bad, str(bad))

    # The centre frames' lines must not run through a control (#151: 真ん中の帯が［連動］に被る).
    frame_hits = lambda: pg.evaluate("""(() => { const fr = [...document.querySelectorAll('.center-band')].map(e => e.getBoundingClientRect());
          return [...document.querySelectorAll('.board button, .board select')].filter(c => { const r = c.getBoundingClientRect(); if (!r.width) return false;
            return fr.some(f => { const inside = r.left >= f.left - 1 && r.right <= f.right + 1 && r.top >= f.top - 1 && r.bottom <= f.bottom + 1;
              const cross = r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top; return cross && !inside; }); })
            .map(c => (c.getAttribute('aria-label') || c.textContent).trim().slice(0, 12)); })()""")
    # 操作の体系 (#151): the primary buttons that can be seen (not under a sheet), and buttons too
    # small to press (the small ones are pressable 44 high through ::after).
    primaries = lambda: pg.evaluate("""[...document.querySelectorAll('.btn.primary, .actions > button.primary')].filter(e => {
        const r = e.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) return false;
        const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t && (e === t || e.contains(t));
      }).length""")
    def buttons_ok(code, where, primary):
        n = primaries()
        check(f"{code} 主のボタンは{primary}つ（{where}）", n == primary, str(n))
        small = pg.evaluate("""[...document.querySelectorAll('.btn')].filter(e => { const r = e.getBoundingClientRect(); if (!r.width) return false;
          const hit = Math.max(r.height, parseFloat(getComputedStyle(e, '::after').height) || 0); return hit < 32; }).map(e => e.textContent.trim())""")
        check(f"{code} 押せる高さが32以上（{where}）", not small, str(small))

    # Text on screen smaller than the type scale's xs (11px, iOS Caption 2): none (docs/design-system.md, #151).
    small_text = lambda: pg.evaluate("""[...document.querySelectorAll('body *')].filter(e => {
        const r = e.getBoundingClientRect();
        if (!r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
        if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return false;
        return parseFloat(getComputedStyle(e).fontSize) < 11;
      }).map(e => (e.getAttribute('class') || e.tagName) + ' ' + getComputedStyle(e).fontSize + ' ' + e.textContent.trim().slice(0, 8)).slice(0, 5)""")
    def touch(kind, x, y):
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if kind == "touchEnd" else [{"x": x, "y": y}]})
    def sheet_h():
        return pg.evaluate("document.querySelector('.sheet').getBoundingClientRect().height")
    def esc():
        pg.keyboard.press("Escape"); wait(500)

    # A. first view
    def a():
        check("A1 表が対象・比較の2つ", pg.locator(".side").count() == 2)
        check("A2 対象日の見出し", "2026/11/10" in txt(".side .date-button"), txt(".side .date-button"))
        check("A3 中央の枠は表ごとに1つ（2つ）", pg.locator(".center-band").count() == 2)
        hits = frame_hits()
        check("A3b 中央の枠の線が操作に被らない", not hits, str(hits))
        check("A4 横にはみ出さない", no_overflow())
        check("A5 シートの見出し", title() == "気温の日別", title())
        st = small_text(); check("A6 11px より小さい文字がない（表）", not st, str(st))
        layout_ok("A7", "表")
        buttons_ok("A8", "表", 0)
    step("A", a)

    # B. every item chip
    def bb():
        for i, label in enumerate(["気温", "降水", "日差し", "日照", "湿度", "風速", "気圧"]):
            pg.click(f".metrics .chip:nth-child({i+1})"); wait(500)
            check(f"B{i+1} {label}: チップがオン", "on" in pg.locator(f".metrics .chip:nth-child({i+1})").get_attribute("class"))
            check(f"B{i+1} {label}: シート見出し", title().startswith(label), title())
            check(f"B{i+1} {label}: 読み取りカード", pg.locator(".sheet .readout-card").count() == 1)
            check(f"B{i+1} {label}: 凡例がグラフの下", pg.locator(".sheet .line-legend").count() >= 1)
            layout_ok(f"B{i+1}b", f"{label}の日別")
        pg.click(".metrics .chip:nth-child(1)"); wait(400)
    step("B", bb)

    # C. sheet heights
    def c():
        h0 = sheet_h()
        pg.evaluate("__flick('.sheet-handle',-600,120)"); wait(800)
        h1 = sheet_h()
        top = pg.evaluate("document.querySelector('.sheet').getBoundingClientRect().top")
        chips = pg.evaluate("document.querySelector('.metrics').getBoundingClientRect().bottom")
        check("C1 上へ弾くと高くなる", h1 > h0 + 50, f"{h0:.0f}→{h1:.0f}")
        check("C2 最大はチップの下で止まる", top >= chips - 1, f"top {top:.0f} chips {chips:.0f}")
        layout_ok("C2b", "シート最大")
        pg.evaluate("__flick('.sheet-handle',600,120)"); wait(800)
        h2 = sheet_h()
        check("C3 下へ弾くと低くなる", h2 < h1 - 50, f"{h1:.0f}→{h2:.0f}")
        pg.evaluate("__flick('.sheet-handle',-600,120)"); wait(800)
    step("C", c)

    # D. daily -> hours -> back, every item
    def d():
        pg.locator(".chart-hit").nth(7).click(force=True); wait(700)
        check("D1 日をタップで時間帯", title().endswith("の時間帯"), title())
        check("D2 戻るボタン", pg.locator(".back-btn").count() == 1)
        for i, label in enumerate(["気温", "降水", "日差し", "日照と明るさ", "湿度", "風速", "気圧"]):
            pg.click(f".metrics .chip:nth-child({i+1})"); wait(500)
            check(f"D3 時間帯 {label}", title() == f"{label}の時間帯" and pg.locator(".day-chart > svg").count() == 1, title())
        pg.click(".metrics .chip:nth-child(1)"); wait(300)
        pg.click(".back-btn"); wait(600)
        check("D4 ‹日別で戻る", title() == "気温の日別", title())
    step("D", d)

    # U. 日照の時間帯 › 空の色（模式）: なぞると1時間を拡大、テキスト選択・拡大鏡は出ない
    def uu():
        pg.locator(".chart-hit").nth(7).click(force=True); wait(700)
        pg.click(".metrics .chip:nth-child(4)"); wait(600)
        check("U1 明るさと空：1本の帯（切り替えなし）、マスに空の色と段の線", pg.locator(".light-strip .seg").count() == 0 and pg.locator(".light-cells.sky i b").count() >= 48 and pg.locator(".light-cells.sky i u").count() >= 24 and no_overflow(), str(pg.locator(".light-cells.sky i b").count()))
        check("U2 読み取りに空の行", "空（" in txt(".readout-card"), txt(".readout-card"))
        st = small_text(); check("U2b 11px より小さい文字がない（時間帯）", not st, str(st))
        layout_ok("U2c", "時間帯")
        buttons_ok("U2d", "時間帯", 0)
        lines = pg.evaluate("""[...document.querySelectorAll('.cs-head')].map(h => { const l = h.querySelector('.cs-head-line').getBoundingClientRect(), b = h.querySelector('.cs-head-state').getBoundingClientRect();
          return b.top >= l.bottom - 1; })""")
        check("U2e 見出しはどちらの日も2行（日付の下に実績・予報）", len(lines) == 2 and all(lines), str(lines))
        pg.locator(".light-strip").scroll_into_view_if_needed(); wait(300)
        b = pg.locator(".light-trace.on").bounding_box()
        y = b["y"] + b["height"] / 2
        pg.mouse.move(b["x"] + b["width"] * 0.5, y); pg.mouse.down(); pg.mouse.move(b["x"] + b["width"] * 0.55, y, steps=4)
        check("U3 なぞると拡大カード（空と明るさ）", pg.locator(".sky-zoom").count() == 1 and pg.locator(".sky-zoom-steps span").count() == 6 * pg.locator(".light-row").count() and "lx" in txt(".sky-zoom-light"), txt(".sky-zoom-light"))
        check("U3b 比較日があれば拡大カードにも比較の空と読み取り", pg.locator(".light-row").count() < 2 or (pg.locator(".sky-zoom-day").count() == 2 and "比較" in pg.locator(".sky-zoom-day .sky-zoom-now").nth(1).inner_text()), str(pg.locator(".sky-zoom-day").count()))
        sel = pg.evaluate("String(getSelection())")
        check("U4 テキストが選択されない", sel == "", repr(sel))
        check("U5 帯は選択・長押しメニューなし", pg.evaluate("getComputedStyle(document.querySelector('.light-trace.on')).userSelect") == "none")
        pg.mouse.up(); wait(300)
        check("U6 離すとカードは消える", pg.locator(".sky-zoom").count() == 0)
        pg.mouse.click(b["x"] + b["width"] * 0.3, y); wait(300)
        check("U7 軽く押すとカードが残り×で閉じる", pg.locator(".sky-zoom-close").count() == 1)
        pg.click(".sky-zoom-close"); wait(200)
        check("U8 ×で閉じる", pg.locator(".sky-zoom").count() == 0)
        pg.click(".metrics .chip:nth-child(1)"); wait(400)
        pg.click(".back-btn"); wait(500)
    step("U", uu)

    # E. forecast hatch in hours (tomorrow)
    def e():
        pg.locator(".chart-hit").nth(8).click(force=True); wait(800)
        check("E1 予報の時間に網かけ", pg.locator(".day-chart .chart-forecast").count() >= 20, str(pg.locator(".day-chart .chart-forecast").count()))
        check("E2 予報の線は実線のまま", pg.evaluate("[...document.querySelectorAll('.day-chart line[stroke-dasharray=\"2 4\"]')].length") == 0)
        pg.locator(".day-chart > svg").scroll_into_view_if_needed(); wait(300)
        b = pg.locator(".day-chart > svg").bounding_box()
        pg.mouse.move(b["x"] + b["width"] * 0.6, b["y"] + 100); pg.mouse.down(); pg.mouse.move(b["x"] + b["width"] * 0.7, b["y"] + 100)
        check("E3 触ると補助線と軸のタグ", pg.locator(".day-chart .guide-tag").count() >= 1)
        check("E4 触っている間カードが光る", pg.locator(".readout-card.live").count() == 1)
        pg.mouse.up(); wait(200)
        check("E5 離すとカードは戻る", pg.locator(".readout-card.live").count() == 0)
        pg.click(".back-btn"); wait(600)
    step("E", e)

    # F. long press on the daily graph (touch) scrubs, no day opens; a swipe moves days
    def f():
        b = pg.locator(".chart svg").first.bounding_box()
        x, y = b["x"] + b["width"] * 0.3, b["y"] + b["height"] * 0.4
        touch("touchStart", x, y); wait(450)
        touch("touchMove", x + 40, y); wait(200)
        check("F1 長押しでカードが光る", pg.locator(".readout-card.live").count() == 1)
        check("F2 長押しで補助線", pg.locator(".chart .guide").count() == 1)
        touch("touchEnd", x + 40, y); wait(700)
        check("F3 長押しの後に時間帯へ飛ばない", title().endswith("の日別"), title())
        before = txt(".side .date-button")
        sx = b["x"] + b["width"] * 0.7
        touch("touchStart", sx, y)
        for k in range(1, 9):
            touch("touchMove", sx - k * 22, y); wait(16)
        touch("touchEnd", sx - 176, y); wait(900)
        after = txt(".side .date-button")
        check("F4 横スワイプで日が動く", before != after, f"{before}→{after}")
        pg.click(".today-chip") if pg.locator(".today-chip").count() else None; wait(600)
    step("F", f)

    # G. compare presets and link
    def g():
        sel = pg.locator(".side-compare select.mode")
        opts = [o for o in sel.locator("option").evaluate_all("os => os.map(o => o.value)") if o != "__conditions"]
        seen = set()
        for o in opts:
            sel.select_option(o); wait(500)
            seen.add(txt(".side-compare .date-button"))
        check("G1 比較のプリセットで比較日が変わる", len(seen) >= len(opts) - 1, f"{len(opts)} 種類 → {len(seen)} 通り")
        hits = frame_hits(); check("G1b どの比較のしかたでも、中央の枠の線が操作に被らない", not hits, str(hits))
        sel.select_option(opts[0]); wait(400)
        pg.click(".link-toggle"); wait(400)
        check("G2 個別にすると帯が2つ", pg.locator(".center-band.apart").count() == 2)
        pg.click(".link-toggle"); wait(400)
        check("G3 連動に戻すと枠は実線の2つ", pg.locator(".center-band").count() == 2 and pg.locator(".center-band.apart").count() == 0)
    step("G", g)

    # H. date arrows and 今日
    def h():
        before = txt(".side .date-button")
        pg.locator(".side .arrow").nth(1).click(); wait(500)
        check("H1 ▶で次の日", txt(".side .date-button") != before)
        check("H2 今日へ戻るボタンが出る", pg.locator(".today-chip").count() == 1)
        moved = txt(".side .date-button")
        pg.reload(); wait(2500); pg.add_script_tag(path=os.path.join(HERE, "flick.js")); pg.add_script_tag(path=os.path.join(HERE, "layout.js")); pg.add_style_tag(content=WIDE_FONT)
        check("H2b 再読み込み（新しい版への切り替え）でも見ていた日のまま", txt(".side .date-button") == moved, txt(".side .date-button"))
        pg.click(".today-chip"); wait(500)
        check("H3 今日へ戻る", txt(".side .date-button") == before)
    step("H", h)

    # G2. a tap that lowers the sheet must not also tap the page behind (iOS sends the click afterwards)
    def ghost():
        n0 = pg.locator(".msheet").count()
        pg.evaluate("""() => { const h = document.querySelector('.sheet-handle');
          h.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, clientY: 300, pointerId: 9}));
          h.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, clientY: 300, pointerId: 9}));
          window.__ghost = 0; const t = document.querySelector('.chart-hit, .date-button');
          t.addEventListener('click', () => window.__ghost++, {once: true});
          t.click(); }""")
        wait(200)
        check("G2a 下げたタップのクリックは背面に届かない", pg.evaluate("window.__ghost") == 0 and pg.locator(".msheet").count() == n0)
        wait(800)
        pg.evaluate("""() => { window.__ghost = 0; const t = document.querySelector('.chart-hit, .date-button');
          t.addEventListener('click', () => window.__ghost++, {once: true}); }""")
        pg.locator(".side .arrow").nth(1).click(); wait(400)
        pg.locator(".today-chip").click(); wait(400)
        check("G2b 少し後のタップは普通に届く", pg.locator(".today-chip").count() == 0)
        pg.evaluate("""() => { const h = document.querySelector('.sheet-handle');
          h.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, clientY: 300, pointerId: 9}));
          h.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, clientY: 300, pointerId: 9})); }""")
        wait(800)
    step("G2", ghost)

    # FS. 取得できなかったもの: the status bar's message opens what failed, when and for what
    def fs():
        FAIL.add("/api/hourly")
        # A week back: the table asks for those days' hours (and their comparison days'), which now fail.
        for _ in range(9):
            pg.locator(".side .arrow").nth(0).click(); wait(250)
        for _ in range(20):
            if pg.locator(".status-bar.error").count(): break
            wait(500)
        check("FS1 失敗がステータスに出る", pg.locator(".status-bar.error").count() == 1)
        pg.locator(".status-detail").click(); wait(700)
        items = pg.locator(".failure-item").count()
        body = txt(".failure-sheet") if pg.locator(".failure-sheet").count() else ""
        check("FS2 押すと何が取れなかったかのシート", items >= 1, str(items))
        check("FS3 理由・取り先・使う所・時刻が出る", all(w in body for w in ["テスト用の失敗", "時間別の表", "使う所", "失敗"]), body[:120])
        pg.locator(".failure-all").scroll_into_view_if_needed(); wait(300)
        buttons_ok("FS3b", "取得できなかったもの", 1)
        FAIL.clear()
        pg.locator(".failure-all").click(); wait(3000)
        check("FS4 すべて再試行で消える", pg.locator(".failure-item").count() == 0 and pg.locator(".status-bar.error").count() == 0, str(pg.locator(".failure-item").count()))
        pg.click(".msheet .icon-btn.close"); wait(600)
        pg.click(".today-chip"); wait(600)
    step("FS", fs)
    # AV. 手前の平均 on the hour chart: rows in the readout, a legend that sets lines aside, the span
    def av():
        pg.locator(".chart-hit").nth(7).click(force=True); wait(2500)
        check("AV1 読み取りに手前の平均と手前1週との差", pg.locator(".readout-card .ro-label", has_text="手前1週の平均").count() == 1 and pg.locator(".readout-card .ro-label", has_text="手前1週との差").count() == 1)
        # The readout is set on a grid: each column's decimal points on one line, every row 24px high (#151).
        g = pg.evaluate("""() => {
          const grid = [...document.querySelectorAll('.ro-grid')].pop(); const cols = {}; const hs = [];
          for (const el of grid.querySelectorAll('.ro-v')) {
            hs.push(Math.round(el.getBoundingClientRect().height));
            const n = [...el.childNodes].find((c) => c.nodeType === 3 && c.textContent.includes('.')); if (!n) continue;
            const i = n.textContent.indexOf('.'); const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
            const b = r.getBoundingClientRect(); const k = [...el.parentNode.children].indexOf(el) % 4;
            (cols[k] ||= []).push(b.left + b.width / 2);
          }
          return { spread: Object.values(cols).map((xs) => Math.max(...xs) - Math.min(...xs)), heights: [...new Set(hs)] };
        }""")
        check("AV1b 読み取りの小数点が列ごとにそろう", len(g["spread"]) >= 2 and max(g["spread"]) < 0.6, str(g))
        check("AV1c 読み取りの行の高さが 24px でそろう", g["heights"] == [24], str(g))
        # TR. Text roles (tokens TEXT_ROLES): each role draws the same on the readout and the table.
        roles = pg.evaluate("""() => {
          const R = { 見出し: ['.ro-title'], 指標名: ['.ro-label', '.labels .label-value:not(.label-diff)'],
            主要数値: ['.ro-v:not(.ro-b):not(.ro-diff):not(.ro-text):not(.ro-icon)', '.cell-value:not(.minor):not(.cell-diff):not(.long)', '.cs-row:not(.cs-sun) .cs-val'],
            比較数値: ['.ro-diff', '.cell-diff:not(.long)'], 補足: ['.ro-unit', '.ro-col', '.cell-kind', '.label-unit'] };
          const out = {};
          for (const [role, sels] of Object.entries(R)) {
            const seen = new Set();
            for (const s of sels) for (const e of document.querySelectorAll(s)) {
              if (!e.getBoundingClientRect().width || !e.textContent.trim() || e.textContent.trim() === '—') continue;
              const c = getComputedStyle(e); seen.add(`${c.fontSize} ${c.fontWeight}`);
            }
            out[role] = [...seen];
          }
          return out;
        }""")
        # The chosen day's column is set in bold (its emphasis), the rest regular; the heading is bold.
        want = {"見出し": ["13px 600"], "指標名": ["12px 400"], "主要数値": ["15px 400", "15px 600"], "比較数値": ["13px 400", "13px 600"], "補足": ["11px 400"]}
        check("TR 文字の役割がどこでも同じ大きさ・太さ", all(set(roles[k]) <= set(v) and roles[k] for k, v in want.items()), str(roles))
        n = pg.locator(".legend-line").count()
        check("AV2 凡例の線は4つ（対象・比較・それぞれの手前）", n == 4, str(n))
        pg.locator(".legend-line").nth(1).click(); wait(300)
        check("AV3 タップで薄く（押されていない状態に）", pg.locator(".legend-line").nth(1).get_attribute("aria-pressed") == "false")
        pg.locator(".legend-line").nth(1).click(); wait(300)
        check("AV4 もう一度で戻る", pg.locator(".legend-line").nth(1).get_attribute("aria-pressed") == "true")
        ticks = lambda: pg.locator(".hour-compare .chart-tick").all_inner_texts()
        wait(1500)
        before_ticks = ticks()
        pg.locator(".avg-window").click(); wait(1500)
        check("AV5 平均の期間が 2週 に", pg.locator(".readout-card .ro-label", has_text="手前2週の平均").count() == 1)
        check("AV5c 差の行の名前も 2週 に", pg.locator(".readout-card .ro-label", has_text="手前2週との差").count() == 1)
        check("AV5b 期間を変えても縦軸は同じ", ticks() == before_ticks, f"{before_ticks} → {ticks()}")
        pg.locator(".avg-window").click(); wait(1200)
        pg.locator(".ro-grid").last.scroll_into_view_if_needed(); wait(300)
        check("AV5d 1か月 でも名前が列に収まる", pg.locator(".readout-card .ro-label", has_text="手前1か月との差").count() == 1)
        layout_ok("AV5e", "手前1か月の読み取り")
        pg.locator(".avg-window").click(); wait(300)
        check("AV6 1か月 を経て 1週 に戻る", pg.locator(".readout-card .ro-label", has_text="手前1週の平均").count() == 1)
        pg.locator(".back-btn").first.click(); wait(600)
    step("AV", av)

    # I. close rules on the calendar: Esc, backdrop, ×, drag; pick closes
    def i_():
        for how in ["Esc", "背景", "×", "つまみ"]:
            pg.locator(".side .date-button").first.click(); wait(600)
            ok_open = pg.locator(".msheet.calendar").count() == 1
            if how == "Esc": pg.keyboard.press("Escape")
            elif how == "背景": pg.mouse.click(200, 30)
            elif how == "×": pg.click(".msheet .icon-btn.close")
            else:
                hb = pg.locator(".msheet .sheet-handle").bounding_box()
                pg.mouse.move(hb["x"] + hb["width"]/2, hb["y"] + 8); pg.mouse.down(); pg.mouse.move(hb["x"] + hb["width"]/2, hb["y"] + 300, steps=6); pg.mouse.up()
            wait(700)
            check(f"I 閉じ方（{how}）", ok_open and pg.locator(".msheet").count() == 0)
        pg.locator(".side .date-button").first.click(); wait(600)
        check("I カレンダーは中身の高さ", "fit" in pg.locator(".msheet").get_attribute("class"))
        layout_ok("I0", "カレンダー")
        buttons_ok("I0b", "カレンダー", 1)
        check("I0c 日を選ぶまで［決定］は押せない", pg.locator(".calendar-foot .btn.primary").is_disabled())
        pg.locator(".cal-day:not(:disabled)").nth(3).click(); wait(400)
        check("I 1回目のタップは仮（閉じない、上の組み合わせが変わる）", pg.locator(".msheet").count() == 1 and pg.locator(".cal-pair.changed").count() == 1)
        pg.locator(".cal-day:not(:disabled)").nth(3).click(); wait(700)
        check("I 同じ日をもう一度で決まって閉じる", pg.locator(".msheet").count() == 0 and txt(".side .date-button") != "2026/11/10", txt(".side .date-button"))
        had = pg.locator(".today-chip").count()
        pg.click(".today-chip") if had else None; wait(600)
        check("I 今日ボタンで今日に戻る", had and txt(".side .date-button") == "2026/11/10", f"chip {had} → {txt('.side .date-button')}")
    step("I", i_)

    # J. settings
    def j():
        pg.click(".app-head .icon-btn"); wait(600)
        check("J1 設定が開く", pg.locator(".msheet.settings").count() == 1)
        st = small_text(); check("J1b 11px より小さい文字がない（設定）", not st, str(st))
        layout_ok("J1c", "設定")
        buttons_ok("J1d", "設定", 0)
        check("J2 設定は下に閉じるボタンなし", pg.locator(".msheet .actions button:has-text('閉じる')").count() == 0)
        esc()
    step("J", j)

    # R. 記録: the save button stays in view and names what is missing (#151 操作の体系)
    def rr():
        pg.click(".head-report"); wait(900)
        check("R1 記録が開く", pg.locator(".msheet.report-sheet").count() == 1)
        vis = lambda: pg.evaluate("(() => { const r = document.querySelector('.report-save').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; })()")
        check("R2 開いた時から［記録する］が見える（下に固定）", vis())
        t = txt(".report-save")
        check("R3 押せない間は足りないものを出す", "あと" in t and "感じ方" in t and "今の天気" in t, t)
        pg.locator(".msheet button", has_text="涼しい").first.click(); wait(300)
        t = txt(".report-save")
        check("R4 答えると足りないものが減る", "感じ方" not in t and "あと" in t, t)
        pg.locator(".msheet").last.evaluate("e => e.scrollTop = e.scrollHeight / 2"); wait(300)
        check("R5 途中までスクロールしても見える", vis())
        st = small_text(); check("R6 10px より小さい文字がない（記録）", not st, str(st))
        layout_ok("R7", "記録")
        buttons_ok("R8", "記録", 1)
        esc()
    step("R", rr)

    # K. feel map
    def k():
        pg.evaluate("__flick('.sheet-handle',600,120)"); wait(800)
        pg.locator(".side-target .strip-col.is-center .cell-feel.tappable-feel").first.click(); wait(800)
        head = pg.evaluate("document.querySelector('.side-target .date-button').innerText")
        md = txt(".band-map-date.center").split()[0]
        check("K0 中央の日のマップ", head.endswith("/" + md.split("/")[0] + "/" + md.split("/")[1]), f"マップ {md} / 表 {head}")
        check("K1 肌感マップが開く", pg.locator(".msheet.feel-sheet").count() == 1)
        st = small_text(); check("K1b 10px より小さい文字がない（肌感マップ）", not st, str(st))
        layout_ok("K1c", "肌感マップ")
        mh = pg.evaluate("document.querySelector('.msheet').getBoundingClientRect().height")
        sm = pg.evaluate("parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-max'))")
        check("K2 グラフシート最大と同じ高さ", abs(mh - sm) <= 2, f"{mh:.0f} vs {sm:.0f}")
        seen = pg.evaluate("""(() => { const d = document.querySelector('.bm-drum').getBoundingClientRect();
          return [...document.querySelectorAll('.band-cell')].filter(c => { const r = c.getBoundingClientRect(); return r.left >= d.left + 30 && r.right <= d.right + 1; }).length; })()""")
        check("K3 1枚の比較マップ（見えるのは7日×5区分）", seen == 35, str(seen))
        check("K4 予報のマスに網かけ", pg.locator(".bm-a.forecast").count() >= 1)
        check("K5 凡例がマップの下", pg.evaluate("document.querySelector('.map-legend').getBoundingClientRect().top > document.querySelector('.band-map').getBoundingClientRect().bottom"))
        pg.locator(".band-cell.center").nth(2).click(); wait(400)
        check("K6 マスで両日の詳細", pg.locator(".band-detail table").count() == 2)
        pg.locator(".seg button", has_text="推移").click(); wait(500)
        bx = pg.locator("svg.scrub").bounding_box()
        pg.mouse.move(bx["x"] + bx["width"] * 0.3, bx["y"] + 80); wait(200)
        check("K7 推移で補助線とタグ", pg.locator("svg.scrub .guide-tag").count() >= 1)
        pg.mouse.move(5, 5); wait(200)
        # 推移 is a drum too: a sideways drag moves the target day.
        before = txt(".band-trend .readout-card .ro-title")
        pg.locator(".band-trend .drum-pane svg").first.scroll_into_view_if_needed(); wait(300)
        bx = pg.locator(".band-trend .drum-pane svg").first.bounding_box(); y = bx["y"] + min(80, bx["height"] / 2); x = bx["x"] + bx["width"] * 0.75
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); wait(900)
        after = txt(".band-trend .readout-card .ro-title")
        check("K7b 推移も横に動かすと日が進む（ドラム）", after != before, f"{before}→{after}")
        layout_ok("K7c", "肌感の推移（動かした後）")
        check("K8 時間区分の線にデータ色を使わない", pg.evaluate("![...document.querySelectorAll('svg.scrub line[stroke]')].some(l => ['#86b8ff','#f5c865','#c9a6f7','#f39a86','#8fd8c4'].includes(l.getAttribute('stroke')))"))
        check("K9 横にはみ出さない", no_overflow())
        pg.click(".msheet .icon-btn.close"); wait(600)
        check("K10 ×で閉じる", pg.locator(".msheet").count() == 0)
        # K7b moved the target day; back to today so the later steps start where they expect.
        pg.click(".today-chip") if pg.locator(".today-chip").count() else None; wait(600)
    step("K", k)

    # L. 条件から選ぶ
    def l():
        before = txt(".side-compare .date-button")
        pg.locator(".side-compare select.mode").select_option("__conditions"); wait(1500)
        check("L1 条件から選ぶが開く", pg.locator(".msheet.cond-sheet").count() == 1)
        check("L2 条件は4行", pg.locator(".cond-line").count() == 4)
        check("L3 最初は最高が開いて範囲（つまみ2つ）", pg.locator(".cond-line.open[data-cond=max] .cond-slider input").count() == 2)
        layout_ok("L3b", "条件から選ぶ")
        pg.locator(".cond-line[data-cond=max] .seg button", has_text="以上").click(); wait(300)
        check("L4 以上はつまみ1つ", pg.locator(".cond-line[data-cond=max] .cond-slider input").count() == 1, txt(".cond-line[data-cond=max] .cond-value"))
        check("L5 値は「以上」と読める", "以上" in txt(".cond-line[data-cond=max] .cond-value"))
        pg.locator(".cond-line[data-cond=max] .seg button", has_text="問わない").click(); wait(200)
        pg.locator(".cond-line[data-cond=min] .cond-head").click(); wait(200)
        pg.locator(".cond-line[data-cond=min] .seg button", has_text="問わない").click(); wait(200)
        check("L6 開くのは1行だけ", pg.locator(".cond-line.open").count() == 1)
        pg.locator(".cond-line[data-cond=rain] .cond-head").click(); wait(200)
        pg.locator(".cond-line[data-cond=rain] .seg button", has_text="降らない").click(); wait(200)
        pg.locator(".cond-line[data-cond=rain] .seg.multi button").nth(1).click(); wait(200)
        check("L7 雨は時間帯で", "降らない" in txt(".cond-line[data-cond=rain] .cond-value") and "昼" not in txt(".cond-line[data-cond=rain] .cond-value"), txt(".cond-line[data-cond=rain] .cond-value"))
        for _ in range(30):
            if pg.locator(".cond-col.day").count() and pg.locator(".cond-count .loading").count() == 0: break
            wait(500)
        n = pg.locator(".cond-col.day").count()
        check("L8 合う日の表", n >= 1, txt(".cond-count"))
        pg.locator(".cond-col.day").nth(0).click(); wait(700)
        after = txt(".side-compare .date-button")
        check("L9 選ぶと比較日が変わり、シートは開いたまま", after != before and pg.locator(".msheet").count() == 1, after)
        check("L10 取り消せる", pg.locator(".cond-toast button").count() == 1)
        pg.locator(".cond-toast button").click(); wait(700)
        check("L11 取り消すと元の比較日", txt(".side-compare .date-button") == before, txt(".side-compare .date-button"))
        pg.click(".msheet .icon-btn.close"); wait(600)
        pg.locator(".side-compare select.mode").select_option(index=0); wait(500)
    step("L", l)

    # M. summary minimise and 表に集中
    def m():
        pg.evaluate("__flick('.sheet-handle',-600,120)"); wait(800)
        pg.locator(".chart-hit").nth(7).click(force=True); wait(700)
        pg.click(".cs-toggle"); wait(300)
        check("M1 要約を畳む", pg.locator(".compare-summary.collapsed").count() >= 1)
        pg.click(".cs-toggle"); wait(300)
        check("M2 要約を広げる", pg.locator(".compare-summary.compact").count() == 1)
        pg.click(".back-btn"); wait(500)
        pg.locator(".side .icon-btn").first.click(); wait(500)
        check("M3 表に集中", pg.evaluate("document.querySelector('.app').classList.contains('full')"))
        pg.locator(".side .icon-btn").first.click(); wait(500)
        check("M4 表示を戻す", not pg.evaluate("document.querySelector('.app').classList.contains('full')"))
    step("M", m)

    # N. long press guard: no text selection anywhere
    def n_():
        us = pg.evaluate("getComputedStyle(document.querySelector('.chart')).webkitUserSelect || getComputedStyle(document.querySelector('.chart')).userSelect")
        check("N1 グラフの文字は選択されない", us == "none", us)
    step("N", n_)

    # Q. calendar: presets and custom
    def q():
        pg.locator(".side-compare .date-button").click(); wait(600)
        check("Q1 比較日のカレンダーにプリセット", pg.locator(".cal-presets .chip").count() == 5)
        check("Q2 マスに天気と最高気温", pg.locator(".cal-day .cal-max").filter(has_text=re.compile(r"\d")).count() >= 20)
        pg.locator(".cal-presets .chip", has_text="前週").click(); wait(300)
        check("Q3 プリセットで組み合わせが前週に", "前週" in txt(".cal-pair-interval"), txt(".cal-pair-interval"))
        pg.click(".calendar-foot .primary"); wait(700)
        check("Q4 決定で前週になる", pg.locator(".side-compare select.mode").input_value() == "lastWeek" and txt(".side-compare .date-button") == "2026/11/3", txt(".side-compare .date-button"))
        pg.locator(".side-compare .date-button").click(); wait(600)
        pg.locator(".cal-day:not(:disabled)").nth(1).click(); wait(300)
        check("Q5 日を選ぶとカスタムと表示", "カスタム" in txt(".cal-pair-interval"), txt(".cal-pair-interval"))
        pg.click(".calendar-foot .primary"); wait(700)
        check("Q6 決定でカスタムになる", pg.locator(".side-compare select.mode").input_value() == "custom")
        pg.locator(".side-compare select.mode").select_option("sameDate"); wait(500)
    step("Q", q)

    # P. the four decisions (all B)
    def pp():
        check("P1 比較の表に差の行", pg.locator(".side-compare .label-diff").count() >= 2 and pg.locator(".side-compare .cell-diff").count() > 0)
        pg.locator(".side .icon-btn").first.click(); wait(600)
        wb = pg.locator(".side-target .strip-wrap").bounding_box()
        cols = pg.evaluate("[...document.querySelectorAll('.side-target .strip-col')].filter(c=>{const r=c.getBoundingClientRect();return r.left>=%f-1&&r.right<=%f+1}).length" % (wb["x"], wb["x"] + wb["width"]))
        check("P2 表に集中で9日", cols == 9, str(cols))
        check("P2b 横にはみ出さない", no_overflow())
        layout_ok("P2c", "表に集中")
        pg.locator(".side .icon-btn").first.click(); wait(600)
        pg.evaluate("__flick('.sheet-handle',-600,120)"); wait(800)
        pg.locator(".chart-hit").nth(7).click(force=True); wait(800)
        pg.evaluate("document.querySelector('.sheet-body').scrollTo(0,260)"); wait(600)
        dock = pg.locator(".sheet-dock .compare-summary.pinned").count()
        top = pg.evaluate("document.querySelector('.sheet-body').getBoundingClientRect().top")
        dbot = pg.evaluate("document.querySelector('.sheet-dock').getBoundingClientRect().bottom")
        check("P3 固定の1行は見出しの下（重ならない）", dock == 1 and top >= dbot - 1, f"dock {dock} body {top:.0f} dock下 {dbot:.0f}")
        # The pinned line (minimized) moves days with a sideways swipe too.
        dd = lambda: txt(".sheet-dock .cs-line-date")
        before = dd()
        db = pg.locator(".sheet-dock .compare-summary.pinned").bounding_box(); y = db["y"] + db["height"] / 2; x = db["x"] + db["width"] * 0.7
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); wait(900)
        check("P3c 固定の1行も横スワイプで日が動く", pg.locator(".sheet-dock .compare-summary.pinned").count() == 1 and dd() != before, f"{before}→{dd()}")
        touch("touchStart", x - 144, y)
        for k in range(1, 9):
            touch("touchMove", x - 144 + k * 18, y); wait(16)
        touch("touchEnd", x, y); wait(900)
        pg.locator(".sheet-dock .compare-summary.pinned").click(); wait(700)
        check("P3b 1行をタップで要約に戻る", pg.locator(".sheet-dock .compare-summary").count() == 0)
        # Folded (畳む) after being open: the folded line still moves days.
        pg.locator(".cs-toggle").first.click(); wait(500)
        ld = lambda: txt(".compare-summary.collapsed .cs-line-date")
        before = ld()
        lb = pg.locator(".compare-summary.collapsed").first.bounding_box(); y = lb["y"] + lb["height"] / 2; x = lb["x"] + lb["width"] * 0.7
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); wait(900)
        check("P3d 畳んだ要約も横スワイプで日が動く", ld() != before, f"{before}→{ld()}")
        touch("touchStart", x - 144, y)
        for k in range(1, 9):
            touch("touchMove", x - 144 + k * 18, y); wait(16)
        touch("touchEnd", x, y); wait(900)
        pg.locator(".cs-toggle").first.click(); wait(500)
        pg.click(".back-btn"); wait(500)
        pg.evaluate("__flick('.sheet-handle',600,120)"); wait(800)
        pg.locator(".side-target .strip-col.is-center .cell-feel.tappable-feel").first.click(); wait(900)
        c = lambda: txt(".band-map-date.center").split()[0]
        before = c()
        bb = pg.locator(".band-map").bounding_box(); y = bb["y"] + 120; x = bb["x"] + bb["width"] * 0.75
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); wait(900)
        check("P4 肌感マップを横スワイプで日が進む（ドラム）", c() != before and pg.locator(".msheet").count() == 1, f"{before}→{c()}")
        # During a drag the days follow the finger (the drum), and a pressed cell stays in place.
        bb = pg.locator(".band-map").bounding_box(); y = bb["y"] + 120; x = bb["x"] + bb["width"] * 0.75
        x0 = pg.evaluate("document.querySelector('.band-cell.center').getBoundingClientRect().left")
        touch("touchStart", x, y)
        for k in range(1, 4):
            touch("touchMove", x - k * 10, y); wait(16)
        x1 = pg.evaluate("document.querySelector('.band-cell.center').getBoundingClientRect().left")
        f0 = pg.evaluate("document.querySelector('.bm-center-frame').getBoundingClientRect().left")
        touch("touchEnd", x - 30, y); wait(900)
        check("P4b 指を動かしている間、マスが指についてくる", x1 < x0 - 15, f"{x0:.0f}→{x1:.0f}")
        f1 = pg.evaluate("document.querySelector('.bm-center-frame').getBoundingClientRect().left")
        check("P4c 中心の枠は動かない（マスだけが下を通る）", abs(f1 - f0) < 1 and abs(f0 - x0) < 4, f"frame {f0:.0f}→{f1:.0f}, cell {x0:.0f}")
        esc()
    step("P", pp)

    # T. 日照 › 移り変わり (時刻で・明るさで, 1週間〜1年)
    def tt():
        pg.click(".today-chip") if pg.locator(".today-chip").count() else None; wait(600)
        pg.click(".metrics .chip:nth-child(4)"); wait(600)
        check("T1 日照の日別に［移り変わり］", pg.locator(".trend-btn").count() == 1, title())
        pg.click(".trend-btn"); wait(700)
        check("T2 見出し", title() == "明るさの移り変わり", title())
        check("T3 時刻で：見出しが分で言う", "分" in txt(".lt-head-main"), txt(".lt-head-main"))
        check("T4 時刻で：グラフ", pg.locator(".light-trend svg.lt-chart").count() == 1)
        before = txt(".light-trend .readout-card .ro-title")
        pg.evaluate("__flick('.sheet-handle',-600,120)"); wait(800)  # P left the sheet low; the graph must be on screen
        pg.locator(".light-trend .drum-pane svg").first.scroll_into_view_if_needed(); wait(300)
        bx = pg.locator(".light-trend .drum-pane svg").first.bounding_box(); y = bx["y"] + min(80, bx["height"] / 2); x = bx["x"] + bx["width"] * 0.75
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); wait(900)
        after = txt(".light-trend .readout-card .ro-title")
        check("T4c 1週間は横に動かすと日が進む（ドラム）", after != before, f"{before}→{after}")
        layout_ok("T4b", "明るさの移り変わり")
        for span in ["1か月", "1年", "1週間"]:
            pg.locator(".lt-controls button", has_text=span).click(); wait(500)
            check(f"T5 時刻で {span}", pg.locator(".light-trend svg.lt-chart").count() == 1 and no_overflow())
        pg.locator(".lt-controls button", has_text="明るさで").click(); wait(600)
        check("T6 明るさで：読み取りに長さ", "長さ" in txt(".light-trend .readout-card"), txt(".light-trend .readout-card"))
        # Days run across here too (#151): the dates sit under the plot in a row, left to right.
        xs = pg.evaluate("[...document.querySelectorAll('.light-trend .lt-dates .lt-date:not(.sub)')].map(e => e.getBoundingClientRect()).filter(r => r.left >= 30 && r.right <= innerWidth).map(r => [Math.round(r.left), Math.round(r.top)])")
        check("T6b 明るさで：日は横に並ぶ", len(xs) == 7 and len({y for _, y in xs}) == 1 and [x for x, _ in xs] == sorted(x for x, _ in xs), str(xs))
        for span in ["1か月", "1年", "1週間"]:
            pg.locator(".lt-controls button", has_text=span).click(); wait(700)
            check(f"T7 明るさで {span}", pg.locator(".light-trend svg.lt-chart").count() == 1 and no_overflow())
            layout_ok(f"T7b", f"明るさで {span}")
        pg.locator(".lt-controls button", has_text="時刻で").click(); wait(400)
        pg.click(".back-btn"); wait(600)
        check("T8 ‹日別で戻る", title() == "日照の日別", title())
        pg.click(".metrics .chip:nth-child(3)"); wait(500)
        check("T9 日差しには［移り変わり］がない", pg.locator(".trend-btn").count() == 0)
        pg.click(".metrics .chip:nth-child(1)"); wait(400)
    step("T", tt)

    # The 500s step FS asks for on purpose are not errors of the app.
    errors = [e for e in errors if not (FAILED_ON_PURPOSE and "status of 500" in e)]
    check("Z コンソールのエラーなし", not errors, "; ".join(errors[:5]))
    b.close()
srv.shutdown()
ok = sum(r[0] for r in results)
print(f"WIDTH {W}: {ok}/{len(results)} passed")
for r in results:
    if not r[0]: print("  NG", r[1], r[2])
sys.exit(0 if ok == len(results) else 1)
