# The app end to end in a real browser (Playwright, Python): every screen and the main flows,
# against the built app (dist/client) with the weather API answered by made-up data.
#
# Run:  npx vite build && python3 e2e/e2e.py [width]
#       WN_CHROME=/path/to/chrome to use a given browser; exits 1 when a check fails (CI).
import re
import time
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

# 2026-11-08 is a 強風 day (as 2024-04-09 in Kochi: 最大風速 14.4, 最大瞬間 24.8) for the summary (#176).
STORM_DAY = datetime.date(2026, 11, 8)
def row(d, kind="actual"):
    base = row0(d, kind)
    if d == STORM_DAY: base.update(windMax=14.4, gust=24.8)
    return base

def row0(d, kind="actual"):
    r = random.Random(d.toordinal())
    mx = round(19 + 6 * r.random() - (d.month in (12, 1, 2)) * 9, 1)
    mn = round(mx - 6 - 4 * r.random(), 1)
    rain = round(max(0, r.random() * 30 - 18), 1)
    return {"date": d.isoformat(), "n": d.day, "type": kind, "provider": "JMA", "max": mx, "min": mn, "rain": rain,
            "humidity": round(55 + 30 * r.random()), "wind": round(1 + 4 * r.random(), 1),
            "dayWeather": SKY[d.toordinal() % len(SKY)], "snow": (2.0 if (d.year, d.day) == (2025, 8) else 0), "pressure": round(1012 + 8 * r.random(), 1), "gust": round(6 + 6 * r.random(), 1), "humidityMin": round(30 + 20 * r.random()), "sun": round(9 * r.random(), 1), "temp": round(mx - 4, 1), "raw": {"max": str(mx)}, "quality": {}, "unpublished": []}

ME = {"id": "u1", "loginId": "masao", "name": "渡辺", "role": "admin", "research": {"granted": False, "version": None, "at": None}, "consentVersion": 1}
LOGGED_IN = os.environ.get("WN_LOGGED_OUT") != "1"

# 近づいている台風 (/api/typhoon): one made-up typhoon (台風14号 テスト) south of Kochi, its 強風域 holding
# the station and its 暴風警戒域 ahead over it.
TYPHOON_NOW = {"ok": True, "fetchedAt": "2026-11-10T00:00:00Z", "typhoons": [{
    "tc": "TC2699", "number": 14, "name": "テスト", "category": "台風", "scale": "大型", "intensity": "強い",
    "issued": "2026-11-10T09:45:00+09:00",
    "at": {"lat": 31.8, "lon": 133.4, "location": "足摺岬の南東約120km", "course": "北北東", "speedKmh": 25},
    "pressure": 960, "wind": 40, "gust": 55,
    "gale": {"lat": 31.9, "lon": 133.5, "km": 400}, "storm": {"lat": 31.8, "lon": 133.4, "km": 150},
    "warning": [{"lat": 31.9, "lon": 133.5, "km": 180}, {"lat": 34.0, "lon": 134.5, "km": 220}],
    "warningTimes": ["2026-11-10T09:00:00+09:00", "2026-11-11T21:00:00+09:00"],
    "ahead": [{"validtime": "2026-11-10T21:00:00+09:00", "hours": 12, "center": [33.5, 134.0], "circleKm": 60}]}]}
# 雨の見込み（確認用）: the frames as /api/rain-now builds them (now = 12:00 JST, the fixed clock), and made-up
# tiles (a band of rain moving north-east, drawn in plain Python: no imaging library on CI). One past frame
# (11:30) and one hourly frame (18:30〜19:30) answer 404, to show 「取れなかった」.
def _name(minutes):
    t = datetime.datetime(2026, 11, 10, 3, 0, tzinfo=datetime.timezone.utc) + datetime.timedelta(minutes=minutes)
    return t.strftime("%Y%m%d%H%M%S")
def _frame(m, kind, product, b, member="none"):
    return {"m": m, "kind": kind, "product": product, "basetime": _name(b), "validtime": _name(m), "member": member}
RAIN_NOW = {"v": 1, "station": "47893", "supported": True, "now": _name(0),
    "frames": [_frame(m, "obs", "hrpns", m) for m in range(-180, 1, 5)] + [_frame(m, "nowcast", "hrpns", 0) for m in range(5, 61, 5)]
      + [_frame(m, "hourly", "rasrf", -30) for m in range(90, 871, 60)],
    "hours": [_frame(m, "hourly", "rasrf", m) for m in range(-360, 1, 60)] + [_frame(m, "hourly", "rasrf", -30) for m in range(30, 871, 60)],
    "lists": {"obs": {"ok": True, "count": 37, "latest": _name(0)}, "nowcast": {"ok": True, "count": 12, "latest": _name(0)}, "rasrf": {"ok": True, "count": 14, "latest": _name(-30)}},
    "fetchedAt": "2026-11-10T03:00:30Z", "source": "気象庁ホームページ「雨雲の動き」「今後の雨」"}
RAIN_MISSING = {_name(-30), _name(450)}
RAIN_COLORS = [(242, 242, 255), (160, 210, 255), (33, 140, 255), (0, 65, 255), (250, 245, 0), (255, 153, 0), (255, 40, 0), (180, 0, 104)]
_tile_cache = {}
def rain_tile(path):
    # /api/rain-tile/<product>/<basetime>/<member>/<validtime>/<z>/<x>/<y>.png
    import zlib, struct, math
    parts = path.split("/")
    valid, z, x, y = parts[6], int(parts[7]), int(parts[8]), int(parts[9].split(".")[0])
    if valid in RAIN_MISSING: return None
    key = (valid, z, x, y)
    if key in _tile_cache: return _tile_cache[key]
    t = datetime.datetime.strptime(valid, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
    h = (t - datetime.datetime(2026, 11, 10, 3, 0, tzinfo=datetime.timezone.utc)).total_seconds() / 3600
    n = 256 * 2 ** z
    rows = []
    for py in range(256):
        row = bytearray([0])
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y * 256 + py) / n))))
        for px in range(256):
            lon = (x * 256 + px) / n * 360 - 180
            # a band from the south-west, 1時間に経度 0.35°・緯度 0.22° ほど北東へ (as the sample)
            du, dv = lon - (133.2 + 0.35 * h), lat - (33.3 + 0.22 * h)
            u = du * 0.83 + dv * 0.56; v = -du * 0.56 + dv * 0.83
            val = 30 * math.exp(-(u * u) / (2 * 0.12 ** 2) - (v * v) / (2 * 0.6 ** 2))
            lv = -1 if val < 0.4 else 0 if val < 1 else 1 if val < 5 else 2 if val < 10 else 3 if val < 20 else 4 if val < 30 else 5
            row += bytes((0, 0, 0, 0)) if lv < 0 else bytes((*RAIN_COLORS[lv], 255))
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows))
    chunk = lambda k, d: struct.pack(">I", len(d)) + k + d + struct.pack(">I", zlib.crc32(k + d) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 256, 256, 8, 6, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")
    _tile_cache[key] = png
    return png
TYPHOON_ON = {"on": False}  # the TY step turns the made-up typhoon on, then off again
def api(path, q):
    if path == "/api/typhoon":
        if TYPHOON_ON.get("fail"): return {"ok": False, "fetchedAt": "2026-11-10T03:00:00Z", "typhoons": []}
        if TYPHOON_ON.get("old"): return {"ok": True, "fetchedAt": "2026-11-10T00:00:00Z", "typhoons": []}
        return TYPHOON_NOW if TYPHOON_ON["on"] else {"ok": True, "fetchedAt": "2026-11-10T03:00:00Z", "typhoons": []}
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
    if path == "/api/admin/forecast-import":
        return {"first": "2025-01", "last": "2026-11", "next": {"month": "2025-02", "expected": "2025-03-02", "available": False}, "parser": {"telegram": 1, "record": 1}, "months": [{"office": "390000", "month": "2025-01", "commit_sha": "abc", "fetched_at": "2026-11-17T03:00:00Z", "rows": 4791, "issues": 186, "empty_days": [], "overlaps": 0, "differ": 0, "license": "CC BY-SA 4.0"}]}
    if path == "/api/rain-now":
        return RAIN_NOW
    if path == "/api/wxchart-at":
        return {"v": 1, "at": q.get("at", ""), "charts": []}
    if path == "/api/forecast-history":
        # 予報の履歴 (R6): made-up — 2026-10 の記録（shiromatz）を日付だけずらした、TODAY を対象日にした1日分。
        if q.get("date") == TODAY.isoformat():
            with open(os.path.join(HERE, "forecast-history.json"), encoding="utf-8") as f:
                return json.load(f)
        return {"v": 1, "station": "47893", "date": q.get("date"), "supported": True, "places": {"office": "390000", "area": "390010", "point": "74182"}, "issues": [], "entries": [], "fetchLog": []}
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

# 台風の進路 (shared/typhoon.ts, compact): one made-up typhoon (2026年 99号) crossing Kochi on 20 October
# 2026 (UTC), its 強風域 300 km all round and its 暴風域 80 km.
def _ty_hours(y, m, d, h): return int(datetime.datetime(y, m, d, h, tzinfo=datetime.timezone.utc).timestamp() // 3600)
TYPHOON_TRACKS = {"v": 1, "source": "e2e", "built": "2026-11-01T00:00:00Z", "storms": [{"y": 2026, "n": 99, "name": "E2E", "p": [
    [_ty_hours(2026, 10, 19, 18), 5, 310, 1335, 960, [300, 300, -1], [80, 80, -1]],
    [_ty_hours(2026, 10, 20, 0), 5, 335, 1335, 965, [300, 300, -1], [80, 80, -1]],
    [_ty_hours(2026, 10, 20, 6), 5, 360, 1340, 975, [250, 250, -1], []],
]}, {"y": 2025, "n": 98, "name": "E2E2", "p": [
    [_ty_hours(2025, 11, 4, 18), 5, 310, 1335, 970, [300, 300, -1], []],
    [_ty_hours(2025, 11, 5, 0), 5, 335, 1335, 975, [300, 300, -1], []],
    [_ty_hours(2025, 11, 5, 6), 5, 360, 1340, 985, [250, 250, -1], []],
]}]}

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.split("?")[0] == "/data/typhoon-tracks.json":
            body = json.dumps(TYPHOON_TRACKS).encode()
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(body)
            return
        if not self.path.startswith("/api/") and not os.path.exists(DIST + self.path.split("?")[0]):
            self.path = "/index.html"
        return super().do_GET()

PORT = int(os.environ.get("WN_PORT", "8799"))  # another port lets two runs go side by side
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(H, directory=DIST))
threading.Thread(target=srv.serve_forever, daemon=True).start()


def with_quality(o):
    """The made-up rows say every number is a 正常値, as JMA's do: the new core takes no unmarked value."""
    if isinstance(o, dict):
        if "quality" in o and not o["quality"]:
            o["quality"] = {k: "normal" for k, v in o.items() if isinstance(v, (int, float)) and not isinstance(v, bool) and k != "n"}
        for v in o.values(): with_quality(v)
    elif isinstance(o, list):
        for v in o: with_quality(v)
    return o

results = []
def check(name, cond, detail=""):
    results.append((bool(cond), name, detail))

ONLY = [x for x in os.environ.get("WN_ONLY", "").split(",") if x]

TIMES = []
def settle(cond, timeout=5.0, every=0.1):
    """Waits until cond() is true (or the time is up) instead of a fixed sleep."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            if cond(): return True
        except Exception:
            pass
        time.sleep(every)
    return False
def step(name, fn):
    # WN_ONLY=A,T runs only those steps (and the first view), for looking into one failure.
    if ONLY and name not in ONLY and name != "A":
        return
    t0 = time.monotonic()
    try:
        fn()
    except Exception as e:
        results.append((False, name, "EXCEPTION " + str(e).splitlines()[0][:160]))
    TIMES.append((name, time.monotonic() - t0))

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
    ctx.add_init_script(path=os.path.join(HERE, "calm.js"))
    # WN_THEME=navy|mist|warm starts the app in that theme (as chosen in 設定 → 表示 → テーマ).
    if os.environ.get("WN_THEME"):
        ctx.add_init_script(f"try {{ localStorage.setItem('weather-note-theme', {json.dumps(os.environ['WN_THEME'])}) }} catch {{}}")
    FAIL = set()  # parts of a URL that answer 500 (a step makes a request fail on purpose)
    FAILED_ON_PURPOSE = []
    def handle(route):
        from urllib.parse import urlparse, parse_qs
        if any(f in route.request.url for f in FAIL):
            FAILED_ON_PURPOSE.append(route.request.url)
            return route.fulfill(status=500, content_type="application/json", body=json.dumps({"error": "テスト用の失敗"}))
        u = urlparse(route.request.url)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(with_quality(api(u.path, q))))
    ctx.route("**/api/**", handle)
    # 天気図 (#249): JMA's pictures stand in as a 1px PNG (no network in the test).
    PNG1 = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")
    ctx.route(re.compile(r"https://www\.(data\.)?jma\.go\.jp/.*\.png$"), lambda r: r.fulfill(status=200, content_type="image/png", body=PNG1))
    # 雨の見込み（確認用）: the tiles through the Worker (registered after /api/**, so it is tried first).
    TILES_404 = []  # the tiles RN answers 404 on purpose (「取れなかった」)
    def tile(route):
        from urllib.parse import urlparse
        png = rain_tile(urlparse(route.request.url).path)
        if png is None: TILES_404.append(route.request.url)
        route.fulfill(status=404, content_type="text/plain", body="none") if png is None else route.fulfill(status=200, content_type="image/png", body=png)
    ctx.route("**/api/rain-tile/**", tile)
    pg = ctx.new_page()
    pg.on("console", lambda m: m.type in ("error", "warning") and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/")
    pg.wait_for_timeout(1500)
    pg.add_script_tag(path=os.path.join(HERE, "flick.js")); pg.add_script_tag(path=os.path.join(HERE, "layout.js")); pg.add_style_tag(content=WIDE_FONT)
    cdp = ctx.new_cdp_session(pg)
    # WN_SLOW=4 runs the page's CPU 4× slower: a slow CI runner, to find waits that only just suffice.
    if os.environ.get("WN_SLOW"): cdp.send("Emulation.setCPUThrottlingRate", {"rate": float(os.environ["WN_SLOW"])})
    # After a reload the helpers and the wide font go back on the page.
    def reload():
        pg.reload(); pg.wait_for_timeout(1500)
        pg.add_script_tag(path=os.path.join(HERE, "flick.js")); pg.add_script_tag(path=os.path.join(HERE, "layout.js")); pg.add_style_tag(content=WIDE_FONT)
        calm()
    wait = pg.wait_for_timeout
    # Until the page is at rest (e2e/calm.js), at most max_ms: for after a tap or a swipe (#182).
    def calm(max_ms=3000):
        t = pg.evaluate(f"__calm({int(max_ms)})")
        if os.environ.get("WN_CALM"): print("CALM", t, sys._getframe(1).f_lineno)
        return t
    txt = lambda sel: pg.locator(sel).first.inner_text()
    title = lambda: txt(".sheet-head-title")
    no_overflow = lambda: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    # Text that runs out of its box, lies on other text, or is cut short (e2e/layout.js, #151).
    # WN_STYLES=<file>: the computed look (spacing, edges, corners, shadows, times) of every element drawn,
    # written at each check of the text and the layout, so a change that should not change the look can
    # be compared before and after (e2e/style_diff.py, #142 A).
    STYLE_PROPS = ["padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left",
                   "row-gap", "column-gap", "top", "right", "bottom", "left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
                   "outline-width", "outline-offset", "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius",
                   "box-shadow", "text-shadow", "opacity", "transition-duration", "transition-timing-function", "transition-delay", "animation-duration", "animation-timing-function",
                   "stroke-width", "rx", "font-size", "width", "height"]
    STYLE_N = [0]
    def snap_styles(where):
        if not os.environ.get("WN_STYLES"): return
        STYLE_N[0] += 1
        rows = pg.evaluate("""(props) => { const key = (e) => { const p = []; for (let a = e; a && a !== document.body; a = a.parentElement) {
            const sib = a.parentElement ? [...a.parentElement.children].filter(c => c.tagName === a.tagName) : [a];
            p.unshift(a.tagName.toLowerCase() + (a.classList.length ? '.' + [...a.classList].sort().join('.') : '') + ':' + sib.indexOf(a)); } return p.join('>'); };
          const out = {}; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (!r.width && !r.height) continue;
            const c = getComputedStyle(e); out[key(e)] = props.map(p => c.getPropertyValue(p)).join('|'); } return out; }""", STYLE_PROPS)
        with open(os.environ["WN_STYLES"], "a") as f: f.write(json.dumps({"n": STYLE_N[0], "where": where, "props": STYLE_PROPS, "rows": rows}, ensure_ascii=False) + "\n")
    # WN_TAPS=<file>: the things to press that are smaller than 44px across or high (design-system 3, the
    # pressable area, a ::before/::after laid over them counted), written at each check of the layout — an
    # audit, not a check (python3 e2e/tap_report.py <file> lists them by kind).
    def tap_audit(where):
        if not os.environ.get("WN_TAPS"): return
        rows = pg.evaluate("""() => { const out = [];
          for (const e of document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=radio], input, select, summary, [tabindex]:not([tabindex="-1"])')) {
            const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
            const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
            let w = r.width, h = r.height;
            for (const ps of ['::before', '::after']) { const p = getComputedStyle(e, ps); if (p.content === 'none' || p.position !== 'absolute') continue;
              w = Math.max(w, parseFloat(p.width) || 0); h = Math.max(h, parseFloat(p.height) || 0); }
            if (w < 43.5 || h < 43.5) out.push([e.tagName.toLowerCase() + '.' + [...e.classList].join('.'), (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16), Math.round(w), Math.round(h)]); }
          return out; }""")
        with open(os.environ["WN_TAPS"], "a") as f: f.write(json.dumps({"where": where, "rows": rows}, ensure_ascii=False) + "\n")
    def layout_ok(code, where):
        snap_styles(f"{code} {where}")
        tap_audit(f"{code} {where}")
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
    # In an SVG the computed font-size is in the drawing's own units: the size on screen is that times the
    # drawing's scale (getScreenCTM), so a map or a graph drawn smaller than its viewBox is caught too.
    # Every check also notes the classes of the text it looked at and their parents (WN_SEEN writes them out),
    # so the parts that no check ever sees can be listed.
    SMALL_SEEN = set()
    def small_text():
        snap_styles(f"文字 {len(results)}")
        r = pg.evaluate("""(() => { const seen = new Set();
      const px = (e) => { const f = parseFloat(getComputedStyle(e).fontSize);
        if (!(e instanceof SVGElement) || !e.getScreenCTM) return f;
        const m = e.getScreenCTM(); return m ? f * Math.hypot(m.a, m.b) : f; };
      const hits = [...document.querySelectorAll('body *')].filter(e => {
        const r = e.getBoundingClientRect();
        // Off screen (scrolled out of the sheet, the next day in the drum) still counts: its size is the same.
        if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') return false;
        if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return false;
        for (let a = e; a && a !== document.body; a = a.parentElement) for (const c of a.classList) seen.add(c);
        return px(e) < 10.95;
      }).map(e => (e.getAttribute('class') || e.tagName) + ' ' + px(e).toFixed(1) + 'px ' + e.textContent.trim().slice(0, 8)).slice(0, 5);
      return { hits, seen: [...seen] }; })()""")
        SMALL_SEEN.update(r["seen"])
        return r["hits"]
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
        # Today (2026-11-10, 12:00 JST): its weekday filled, its 肌感 band ringed at the band now.
        check("A9 今日の列だけ曜日に印", pg.locator(".cell-date.is-today").count() == 1 and "火" in txt(".cell-date.is-today small"), str(pg.locator(".cell-date.is-today").count()))
        ring = pg.evaluate("[...document.querySelectorAll('.feel-bar i.now')].map(i => !!i.closest('.cell-stack').querySelector('.cell-date.is-today'))")
        check("A10 今の時間帯の輪は今日の帯に1つ", ring == [True], str(ring))
        check("A11 肌感の帯の予報に網が見える", pg.evaluate("[...document.querySelectorAll('.feel-bar i.forecast')].every(i => getComputedStyle(i).backgroundImage.includes('repeating-linear-gradient'))") and pg.locator(".feel-bar i.forecast").count() > 0)
    step("A", a)

    # B. every item chip
    def bb():
        for i, label in enumerate(["気温", "降水", "日差し", "日照", "湿度", "風速", "気圧"]):
            pg.click(f".metrics .chip:nth-child({i+1})"); calm()
            check(f"B{i+1} {label}: チップがオン", "on" in pg.locator(f".metrics .chip:nth-child({i+1})").get_attribute("class"))
            check(f"B{i+1} {label}: シート見出し", title().startswith(label), title())
            check(f"B{i+1} {label}: 読み取りカード", pg.locator(".sheet .readout-card").count() == 1)
            check(f"B{i+1} {label}: 凡例がグラフの下", pg.locator(".sheet .line-legend").count() >= 1)
            layout_ok(f"B{i+1}b", f"{label}の日別")
        pg.click(".metrics .chip:nth-child(1)"); calm()
    step("B", bb)


    # C. sheet heights
    def c():
        h0 = sheet_h()
        pg.evaluate("__flick('.sheet-handle',-600,120)"); calm()
        h1 = sheet_h()
        top = pg.evaluate("document.querySelector('.sheet').getBoundingClientRect().top")
        chips = pg.evaluate("document.querySelector('.metrics').getBoundingClientRect().bottom")
        check("C1 上へ弾くと高くなる", h1 > h0 + 50, f"{h0:.0f}→{h1:.0f}")
        check("C2 最大はチップの下で止まる", top >= chips - 1, f"top {top:.0f} chips {chips:.0f}")
        layout_ok("C2b", "シート最大")
        pg.evaluate("__flick('.sheet-handle',600,120)"); calm()
        h2 = sheet_h()
        check("C3 下へ弾くと低くなる", h2 < h1 - 50, f"{h1:.0f}→{h2:.0f}")
        pg.evaluate("__flick('.sheet-handle',-600,120)"); calm()
    step("C", c)

    # TX. 質感 (design-system.md 4.1): values by the points, the 幅 view, rounded amount bars
    def tx():
        fit = pg.evaluate("(()=>{const b=document.querySelector('.sheet-body');return [b.scrollHeight,b.clientHeight]})()")
        check("TX0 日別のグラフはシートに収まる（縦にスクロールしない）", fit[0] <= fit[1] + 1, str(fit))
        check("TX0b 上のカードに時間帯の天気（朝〜夜の5つ）", pg.locator(".sheet .readout-card .parts-wx-cell").count() == 5)
        # 前年同日: the comparison days are the same dates, so one row of dates (the card says the year)
        check("TX0c 比較が同じ日付なら日付の行は1つ", pg.locator(".sheet .chart > svg .chart-x.partner").count() == 0 and pg.locator(".sheet .chart > svg .chart-x-side").count() == 0)
        check("TX0d 線のチップは1行（折り返さない）", pg.evaluate("(()=>{const r=document.querySelector('.sheet .chip-row-scroll');if(!r)return true;const t=[...r.children].map(c=>Math.round(c.getBoundingClientRect().top));return new Set(t).size===1})()"))
        check("TX1 気温の値を点のそばに（対象日の最高・最低）", pg.locator(".sheet .chart-values text").count() >= 14, str(pg.locator(".sheet .chart-values text").count()))
        check("TX2 線は区間ごとに1本（日ごとの線分にしない）", pg.evaluate("document.querySelectorAll('.sheet .chart > svg line[stroke-dasharray]:not(.guide *)').length") == 0)
        pg.locator(".chart-look button", has_text="幅").click(); calm()
        check("TX3 幅：1日1本の丸い棒（対象・比較）", pg.locator(".sheet .range-bars rect").count() >= 14, str(pg.locator(".sheet .range-bars rect").count()))
        check("TX4 幅：最高・最低のチップは出さない", pg.locator(".sheet .chip-row .chip", has_text="最高").count() == 0)
        layout_ok("TX4b", "気温の幅")
        pg.locator(".chart-look button", has_text="線").click(); calm()
        check("TX5 線に戻せる", pg.locator(".sheet .range-bars").count() == 0 and pg.locator(".sheet .chip-row .chip", has_text="最高").count() == 1)
        pg.click(".metrics .chip:nth-child(2)"); calm()
        check("TX6 量の棒は上の角だけ丸い（path）", pg.locator(".sheet .chart svg path[d*='A']").count() > 0 and pg.locator(".sheet .chart svg rect[fill='#45c8d8']").count() == 0)
        pg.click(".metrics .chip:nth-child(1)"); calm()
    step("TX", tx)

    # D. daily -> hours -> back, every item
    def d():
        pg.locator(".chart-hit").nth(7).click(force=True); calm()
        check("D1 日をタップで時間帯", title().endswith("の時間帯"), title())
        check("D2 戻るボタン", pg.locator(".back-btn").count() == 1)
        for i, label in enumerate(["気温", "降水", "日差し", "日照と明るさ", "湿度", "風速", "気圧"]):
            pg.click(f".metrics .chip:nth-child({i+1})"); calm()
            check(f"D3 時間帯 {label}", title() == f"{label}の時間帯" and pg.locator(".day-chart > svg").count() == 1, title())
        pg.click(".metrics .chip:nth-child(1)"); wait(300)
        pg.click(".back-btn"); calm()
        check("D4 ‹日別で戻る", title() == "気温の日別", title())
    step("D", d)

    # U. 日照の時間帯 › 空の色（模式）: なぞると1時間を拡大、テキスト選択・拡大鏡は出ない
    def uu():
        pg.locator(".chart-hit").nth(7).click(force=True); calm()
        pg.click(".metrics .chip:nth-child(4)"); calm()
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
        pg.click(".metrics .chip:nth-child(1)"); calm()
        pg.click(".back-btn"); calm()
    step("U", uu)

    # E. forecast hatch in hours (tomorrow)
    def e():
        pg.locator(".chart-hit").nth(8).click(force=True); calm()
        check("E1 予報の時間に網かけ", pg.locator(".day-chart .chart-forecast").count() >= 20, str(pg.locator(".day-chart .chart-forecast").count()))
        check("E2 予報の線は実線のまま", pg.evaluate("[...document.querySelectorAll('.day-chart :is(line,path)[stroke-dasharray=\"2 4\"]')].length") == 0)
        pg.locator(".day-chart > svg").scroll_into_view_if_needed(); wait(300)
        b = pg.locator(".day-chart > svg").bounding_box()
        pg.mouse.move(b["x"] + b["width"] * 0.6, b["y"] + 100); pg.mouse.down(); pg.mouse.move(b["x"] + b["width"] * 0.7, b["y"] + 100)
        check("E3 触ると補助線と軸のタグ", pg.locator(".day-chart .guide-tag").count() >= 1)
        check("E4 触っている間カードが光る", pg.locator(".readout-card.live").count() == 1)
        pg.mouse.up(); wait(200)
        check("E5 離すとカードは戻る", pg.locator(".readout-card.live").count() == 0)
        pg.click(".back-btn"); calm()
    step("E", e)

    # F. long press on the daily graph (touch) scrubs, no day opens; a swipe moves days
    def f():
        b = pg.locator(".chart svg").first.bounding_box()
        x, y = b["x"] + b["width"] * 0.3, b["y"] + b["height"] * 0.4
        touch("touchStart", x, y); wait(500)  # held on purpose: a long press, not a rest
        touch("touchMove", x + 40, y); wait(200)
        check("F1 長押しでカードが光る", pg.locator(".readout-card.live").count() == 1)
        check("F2 長押しで補助線", pg.locator(".chart .guide").count() == 1)
        touch("touchEnd", x + 40, y); calm()
        check("F3 長押しの後に時間帯へ飛ばない", title().endswith("の日別"), title())
        before = txt(".side .date-button")
        sx = b["x"] + b["width"] * 0.7
        touch("touchStart", sx, y)
        for k in range(1, 9):
            touch("touchMove", sx - k * 22, y); wait(16)
        touch("touchEnd", sx - 176, y); calm()
        after = txt(".side .date-button")
        check("F4 横スワイプで日が動く", before != after, f"{before}→{after}")
        pg.click(".today-chip") if pg.locator(".today-chip").count() else None; calm()
    step("F", f)

    # G. compare presets and link
    def g():
        sel = pg.locator(".side-compare select.mode")
        opts = [o for o in sel.locator("option").evaluate_all("os => os.map(o => o.value)") if o != "__conditions"]
        seen = set()
        for o in opts:
            sel.select_option(o); calm()
            seen.add(txt(".side-compare .date-button"))
        check("G1 比較のプリセットで比較日が変わる", len(seen) >= len(opts) - 1, f"{len(opts)} 種類 → {len(seen)} 通り")
        hits = frame_hits(); check("G1b どの比較のしかたでも、中央の枠の線が操作に被らない", not hits, str(hits))
        sel.select_option(opts[0]); calm()
        pg.click(".link-toggle"); calm()
        check("G2 個別にすると帯が2つ", pg.locator(".center-band.apart").count() == 2)
        pg.click(".link-toggle"); calm()
        check("G3 連動に戻すと枠は実線の2つ", pg.locator(".center-band").count() == 2 and pg.locator(".center-band.apart").count() == 0)
    step("G", g)

    # H. date arrows and 今日
    def h():
        before = txt(".side .date-button")
        pg.locator(".side .arrow").nth(1).click(); calm()
        check("H1 ▶で次の日", txt(".side .date-button") != before)
        check("H2 今日へ戻るボタンが出る", pg.locator(".today-chip").count() == 1)
        moved = txt(".side .date-button")
        pg.reload(); calm(7500); pg.add_script_tag(path=os.path.join(HERE, "flick.js")); pg.add_script_tag(path=os.path.join(HERE, "layout.js")); pg.add_style_tag(content=WIDE_FONT)
        check("H2b 再読み込み（新しい版への切り替え）でも見ていた日のまま", txt(".side .date-button") == moved, txt(".side .date-button"))
        pg.click(".today-chip")
        # Waits for the strip to come back (a slow runner glides longer than a fixed 500 ms).
        settle(lambda: txt(".side .date-button") == before)
        check("H3 今日へ戻る", txt(".side .date-button") == before, txt(".side .date-button"))
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
        calm()
        pg.evaluate("""() => { window.__ghost = 0; const t = document.querySelector('.chart-hit, .date-button');
          t.addEventListener('click', () => window.__ghost++, {once: true}); }""")
        pg.locator(".side .arrow").nth(1).click(); calm()
        pg.locator(".today-chip").click(); calm()
        check("G2b 少し後のタップは普通に届く", pg.locator(".today-chip").count() == 0)
        pg.evaluate("""() => { const h = document.querySelector('.sheet-handle');
          h.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, clientY: 300, pointerId: 9}));
          h.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, clientY: 300, pointerId: 9})); }""")
        calm()
    step("G2", ghost)

    # FS. 取得できなかったもの: the status bar's message opens what failed, when and for what
    def fs():
        FAIL.add("/api/hourly")
        # A week back: the table asks for those days' hours (and their comparison days'), which now fail.
        for _ in range(9):
            pg.locator(".side .arrow").nth(0).click(); wait(250)
        for _ in range(20):
            if pg.locator(".status-bar.error").count(): break
            calm()
        check("FS1 失敗がステータスに出る", pg.locator(".status-bar.error").count() == 1)
        st = small_text(); check("FS1b 11px より小さい文字がない（状態の行）", not st, str(st))
        pg.locator(".status-detail").click(); calm()
        items = pg.locator(".failure-item").count()
        body = txt(".failure-sheet") if pg.locator(".failure-sheet").count() else ""
        st = small_text(); check("FS2b 11px より小さい文字がない（取得できなかったもの）", not st, str(st))
        check("FS2 押すと何が取れなかったかのシート", items >= 1, str(items))
        check("FS3 理由・取り先・使う所・時刻が出る", all(w in body for w in ["テスト用の失敗", "時間別の表", "使う所", "失敗"]), body[:120])
        pg.locator(".failure-all").scroll_into_view_if_needed(); wait(300)
        buttons_ok("FS3b", "取得できなかったもの", 1)
        FAIL.clear()
        pg.locator(".failure-all").click(); calm(9000)
        check("FS4 すべて再試行で消える", pg.locator(".failure-item").count() == 0 and pg.locator(".status-bar.error").count() == 0, str(pg.locator(".failure-item").count()))
        pg.click(".msheet .icon-btn.close"); calm()
        pg.click(".today-chip"); calm()
    step("FS", fs)
    # AV. 手前の平均 on the hour chart: rows in the readout, a legend that sets lines aside, the span
    def av():
        pg.locator(".chart-hit").nth(7).click(force=True); calm(7500)
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
        # HC. The hour graph (#151): rows named, the sun in its own strip, a clear night drawn as the moon.
        hc = pg.evaluate("""() => ({ names: [...document.querySelectorAll('.band-wx-name')].map(e => e.textContent),
          strip: !!document.querySelector('.day-sun-name'),
          sky: [...document.querySelectorAll('.band-wx-cell')].map(c => { const k = c.querySelector('.band-wx-main svg')?.dataset.sky || '';
            return k === 'sun' ? 'sun' : k.endsWith('-night') ? 'moon' : 'other'; }) })""")
        check("HC1 天気の行に 対象／比較 の名前", hc["names"][:2] == ["対象", "比較"], str(hc["names"]))
        check("HC2 太陽の高さは別の帯（太陽）", hc["strip"])
        # 0・3・21・24時 are night all year in Kochi: no sun there; a moon never by day (12時).
        check("HC3 夜に太陽を描かない・昼に月を描かない", all(hc["sky"][i] != "sun" for i in (0, 1, 7, 8)) and hc["sky"][4] != "moon", str(hc["sky"]))
        # #173: the strip says 空は模式 at its right end, clear of 南中 and inside the plot; the sun line has its dark edge.
        sm = pg.evaluate("""() => { const m = document.querySelector('.day-sun-model'), n = document.querySelector('.day-sun-label:not(.day-sun-model)');
          const a = m && m.getBoundingClientRect(), b = n && n.getBoundingClientRect(), svg = m && m.ownerSVGElement.getBoundingClientRect();
          return a && b ? { text: m.textContent, apart: a.left >= b.right + 4, inside: a.right <= svg.right, casing: !!document.querySelector('.day-sun-casing') } : null; }""")
        check("HC4 太陽の帯に「空は模式」（南中と重ならない）、太陽の線に暗い縁", sm and sm["text"] == "空は模式" and sm["apart"] and sm["inside"] and sm["casing"], str(sm))
        # SS. 太陽: the sun strip opens the sheet; the three twilights in order; the slider reads 10-minute steps.
        pg.locator(".day-sun-button").first.scroll_into_view_if_needed(); pg.locator(".day-sun-button").first.click(); calm()
        times = pg.locator(".sun-times dd").all_inner_texts()
        check("SS1 太陽のシートが開き、薄明の時刻が9つと昼の長さ", pg.locator(".sun-sheet").count() == 1 and len(times) == 10, str(times))
        st = small_text(); check("SS1b 11px より小さい文字がない（太陽のシート）", not st, str(st))
        mins = [int(t.split(":")[0]) * 60 + int(t.split(":")[1]) for t in (x.split()[-1] for x in times[:9]) if ":" in t]
        check("SS2 天文→航海→市民→日の出→南中→日の入り→市民→航海→天文 の順", mins == sorted(mins) and len(mins) == 9, str(mins))
        pg.evaluate("""() => { const r = document.querySelector('.sun-slider input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          set.call(r, '370'); r.dispatchEvent(new Event('input', { bubbles: true })); }"""); wait(300)
        check("SS3 スライダーで 6:10 に（10分ごと）", txt(".sun-now-time") == "6:10", txt(".sun-now"))
        layout_ok("SS4", "太陽のシート")
        pg.click(".msheet .icon-btn.close"); calm()
        check("SS5 閉じる", pg.locator(".sun-sheet").count() == 0)
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
        calm(4500)
        before_ticks = ticks()
        pg.locator(".avg-window").click(); calm(4500)
        check("AV5 平均の期間が 2週 に", pg.locator(".readout-card .ro-label", has_text="手前2週の平均").count() == 1)
        check("AV5c 差の行の名前も 2週 に", pg.locator(".readout-card .ro-label", has_text="手前2週との差").count() == 1)
        check("AV5b 期間を変えても縦軸は同じ", ticks() == before_ticks, f"{before_ticks} → {ticks()}")
        pg.locator(".avg-window").click(); calm(3600)
        pg.locator(".ro-grid").last.scroll_into_view_if_needed(); wait(300)
        check("AV5d 1か月 でも名前が列に収まる", pg.locator(".readout-card .ro-label", has_text="手前1か月との差").count() == 1)
        layout_ok("AV5e", "手前1か月の読み取り")
        pg.locator(".avg-window").click(); wait(300)
        check("AV6 1か月 を経て 1週 に戻る", pg.locator(".readout-card .ro-label", has_text="手前1週の平均").count() == 1)
        pg.locator(".back-btn").first.click(); calm()
    step("AV", av)

    # I. close rules on the calendar: Esc, backdrop, ×, drag; pick closes
    def i_():
        for how in ["Esc", "背景", "×", "つまみ"]:
            pg.locator(".side .date-button").first.click(); calm()
            ok_open = pg.locator(".msheet.calendar").count() == 1
            if how == "Esc": pg.keyboard.press("Escape")
            elif how == "背景": pg.mouse.click(200, 30)
            elif how == "×": pg.click(".msheet .icon-btn.close")
            else:
                hb = pg.locator(".msheet .sheet-handle").bounding_box()
                pg.mouse.move(hb["x"] + hb["width"]/2, hb["y"] + 8); pg.mouse.down(); pg.mouse.move(hb["x"] + hb["width"]/2, hb["y"] + 300, steps=6); pg.mouse.up()
            calm()
            check(f"I 閉じ方（{how}）", ok_open and pg.locator(".msheet").count() == 0)
        pg.locator(".side .date-button").first.click(); calm()
        check("I カレンダーは中身の高さ", "fit" in pg.locator(".msheet").get_attribute("class"))
        layout_ok("I0", "カレンダー")
        buttons_ok("I0b", "カレンダー", 1)
        check("I0c 日を選ぶまで［決定］は押せない", pg.locator(".calendar-foot .btn.primary").is_disabled())
        pg.locator(".cal-day:not(:disabled)").nth(3).click(); calm()
        check("I 1回目のタップは仮（閉じない、上の組み合わせが変わる）", pg.locator(".msheet").count() == 1 and pg.locator(".cal-pair.changed").count() == 1)
        st = small_text(); check("I1b 11px より小さい文字がない（カレンダー）", not st, str(st))
        pg.locator(".cal-day:not(:disabled)").nth(3).click(); calm()
        check("I 同じ日をもう一度で決まって閉じる", pg.locator(".msheet").count() == 0 and txt(".side .date-button") != "2026/11/10", txt(".side .date-button"))
        had = pg.locator(".today-chip").count()
        pg.click(".today-chip") if had else None; calm()
        check("I 今日ボタンで今日に戻る", had and txt(".side .date-button") == "2026/11/10", f"chip {had} → {txt('.side .date-button')}")
    step("I", i_)

    # J. settings
    def j():
        pg.click(".app-head .icon-btn"); calm()
        check("J1 設定が開く", pg.locator(".msheet.settings").count() == 1)
        st = small_text(); check("J1b 11px より小さい文字がない（設定）", not st, str(st))
        layout_ok("J1c", "設定")
        buttons_ok("J1d", "設定", 0)
        check("J2 設定は下に閉じるボタンなし", pg.locator(".msheet .actions button:has-text('閉じる')").count() == 0)
        check("J3 管理者には「研究用（テスト）」に比べ板が4つまとまる（雨の見込みは 1日モードへ移した）", pg.locator("#set-research").count() == 1 and pg.locator("section[aria-labelledby='set-research'] .actions button").count() == 4)
        check("J4 肌感の基準にはテストのボタンがない", pg.locator("section[aria-labelledby='set-feel'] button", has_text="比べる").count() == 0)
        # 予報の履歴 (#250, R2): the record's months, taken one at a time by the administrator.
        pg.locator(".msheet.settings button", has_text="ユーザー管理").click(); calm()
        settle(lambda: pg.locator(".admin-imports li").count() == 1)
        sec = pg.locator("section[aria-labelledby='admin-forecast-import']")
        sec.scroll_into_view_if_needed(); calm()
        check("J5 管理：予報の履歴の取り込み（取り込んだ月と次の月のボタン）", pg.locator(".admin-imports li").count() == 1 and sec.locator("button", has_text="2025-02 を取り込む").count() == 1, sec.inner_text()[:120])
        btn = sec.locator("button", has_text="2025-02 を取り込む")
        check("J5c 次の月が記録にまだ無いときは押せず、入る見込みの日を出す", btn.count() == 1 and btn.is_disabled() and "2025年3月2日の夜の見込み" in sec.inner_text(), sec.inner_text()[:200])
        layout_ok("J5b", "ユーザー管理")
        if os.environ.get("WN_SHOT"): sec.screenshot(path=f"{os.environ['WN_SHOT']}-admin-import.png")
        esc()
        esc()
    step("J", j)

    # TH. テーマ (#241): chosen in settings, put in use at once (CSS and the SVG charts), kept on the device.
    def th():
        shots = os.environ.get("WN_SHOT")
        for name, label in (("mist", "Mist"), ("warm", "White"), ("navy", "Navy")):
            pg.click(".app-head .icon-btn"); calm()
            pg.locator(".msheet.settings .seg button", has_text=label).click(); calm()
            check(f"TH1 {label}：テーマが変わり、設定は開いたまま", pg.evaluate("document.documentElement.dataset.theme") == name and pg.locator(".msheet.settings").count() == 1)
            esc()
            bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
            want = {"mist": "rgb(196, 208, 193)", "warm": "rgb(247, 245, 240)", "navy": "rgb(0, 7, 31)"}[name]
            check(f"TH2 {label}：画面の地の色がそのテーマの page", bg == want, bg)
            if shots:
                pg.screenshot(path=f"{shots}-theme-{name}.png", full_page=False)
                pg.evaluate("window.scrollTo(0, 0)")
                pg.locator(".side-target .strip-col.is-center .cell-stack").first.dispatch_event("click"); calm(1500)
                pg.evaluate("__flick('.sheet-handle',-700,120)"); calm(800)
                pg.screenshot(path=f"{shots}-theme-{name}-hours.png", full_page=False)
                pg.click(".back-btn") if pg.locator(".back-btn").count() else None; calm()
                pg.evaluate("__flick('.sheet-handle',700,120)"); calm(800)
            st = small_text(); check(f"TH3 {label}：11px より小さい文字がない", not st, str(st))
        check("TH4 選んだテーマはこの端末に残る", pg.evaluate("localStorage.getItem('weather-note-theme')") == "navy")
    step("TH", th)

    # SD. 1日モード (#247): the header switch hides the comparison table and the sheet, and tells the
    # selected day under the week; its 時間帯 open their hours; back to 比較 brings the table back.
    def sd():
        shots = os.environ.get("WN_SHOT")
        pg.locator(".app-head .seg button", has_text="1日").click(); calm()
        check("SD1 1日：比較の表と下のシートが消え、1日の画面が出る", pg.locator(".side-compare").count() == 0 and pg.locator(".day-detail").count() == 1 and pg.locator("aside.sheet").count() == 0)
        settle(lambda: pg.locator(".dd-part").count() == 5)
        check("SD2 時間帯は5つ", pg.locator(".dd-part").count() == 5, pg.locator(".dd-part").count())
        pg.locator(".dd-part").nth(2).click(); calm()
        check("SD3 時間帯を押すと1時間ごと", pg.locator(".dd-hours tbody tr").count() >= 1, pg.locator(".dd-hours tbody tr").count())
        check("SD4 この日の値：肌感＋7項目", pg.locator(".dd-value").count() == 8, pg.locator(".dd-value").count())
        # 天気図は予報の移り変わりと連動（2026-11-18）：「発表の時」は選んだ発表の直前の天気図と、その時の予想天気図。
        lead = txt(".wx-chart .wx-lead") if pg.locator(".wx-chart .wx-lead").count() else ""
        check("SD4b 天気図：「発表の時｜この日」、発表の時は選んだ発表の時刻の図（保存の無い予想天気図は無いと書く）", pg.locator(".wx-chart").count() == 1 and pg.locator(".wx-chart .seg button").count() == 2 and "の発表のときの空の形" in lead and "予想天気図はありません" in txt(".wx-chart"), lead)
        pg.locator(".wx-chart .seg button", has_text="この日").click(); calm()
        check("SD4b2 「この日」：対象日の天気図（時刻を選べる）", pg.locator(".wx-hours button").count() == 7 or pg.locator(".wx-chart h4", has_text="予想天気図").count() == 1)
        pg.locator(".wx-chart .seg button", has_text="発表の時").click(); calm()
        # 予報の移り変わり (R6): 選んだ発表と実績・グラフ・発表した日ごとの一覧。降水確率の欄を押すと 1マス⇄6時間ごと。
        settle(lambda: pg.locator(".fh-split").count() == 1)
        check("SD4d 予報の移り変わり：上の枠・グラフ・日ごとの一覧", pg.locator(".fh-split").count() == 1 and pg.locator(".fh-step > svg").count() == 1 and pg.locator(".fh-dgroup").count() >= 5, (pg.locator(".fh-split").count(), pg.locator(".fh-dgroup").count()))
        n0 = pg.locator(".fh-step .fh-step-cell").count()
        pg.locator(".fh-step > svg").scroll_into_view_if_needed(); calm()
        b = pg.locator(".fh-step .fh-step-cell").first.bounding_box()
        pg.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2); calm()
        n1 = pg.locator(".fh-step .fh-step-cell").count()
        check("SD4e 降水確率の欄を押すと6時間ごと（マスが増える）", n1 > n0, (n0, n1))
        pg.mouse.click(b["x"] + b["width"] / 2, b["y"] + 4); calm()
        wide = pg.evaluate("[...document.querySelectorAll('.fh, .fh *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).map(e => e.className).slice(0, 3)")
        check("SD4f 予報の移り変わりが画面からはみ出さない", not wide, str(wide))
        fb = pg.locator(".fh-days .fold-btn")
        closed = fb.count() == 1 and fb.get_attribute("aria-expanded") == "false" and pg.locator(".fh-days .fold-body[inert]").count() == 1
        if fb.count():
            fb.click(); pg.wait_for_timeout(500)
        opened = fb.count() == 1 and fb.get_attribute("aria-expanded") == "true" and pg.locator(".fh-days .fold-body").bounding_box()["height"] > 100
        check("SD4g 予報の一覧：前の日の発表は畳まれていて、押すと開く", closed and opened, (closed, opened))
        if fb.count():
            fb.click(); pg.wait_for_timeout(500)
        st = small_text(); check("SD4c 11px より小さい文字がない（1日モード・天気図）", not st, str(st))
        pg.locator(".dd-value", has_text="降水").first.click(); calm()
        check("SD5 値を押すとその項目に（上のタブも）", pg.locator('.metrics [aria-selected="true"]').inner_text().strip() == "降水")
        if shots: pg.screenshot(path=f"{shots}-single.png", full_page=True)
        # 暫定の説明 (2026-11-18)：昨日（暫定）にすると、出どころ・待っているもの・確定の見込みが出る。予報の今日には出ない。
        # 出どころは ⓘ で開く（2026-11-18）：予報の日は ⓘ だけ、開くと出どころ（信頼度の意味まで）。暫定の説明は出ない。
        closed0 = pg.locator(".dd-prov").count() == 0 and pg.locator(".dd-kind .info-btn").count() == 1
        pg.locator(".dd-kind .info-btn").click(); calm()
        src = pg.locator(".dd-prov").inner_text() if pg.locator(".dd-prov").count() else ""
        pg.locator(".dd-kind .info-btn").click(); calm()
        check("SD7a 予報の日：ⓘ で出どころが開き、暫定の説明は出ない、「根拠と記録」に出どころの行は無い", closed0 and "出どころ" in src and "気象庁の予報" in src and "暫定" not in src and pg.locator(".dd-basis", has_text="出どころ").count() == 0, src[:80])
        pg.locator("button[aria-label$='1日前へ']").first.click(); calm()
        settle(lambda: pg.locator(".dd-kind .info-btn").count() == 1, 5)
        check("SD7d 暫定の日：ふだんは「暫定 ⓘ」だけ（説明は閉じている）", pg.locator(".dd-kind .info-btn").count() == 1 and pg.locator(".dd-prov").count() == 0)
        pg.locator(".dd-kind .info-btn").click(); calm()
        settle(lambda: pg.locator(".dd-prov").count() == 1, 5)
        t = pg.locator(".dd-prov").inner_text() if pg.locator(".dd-prov").count() else ""
        check("SD7b 暫定の日：いまの値・待っているもの・確定の見込み（11/12 以降）", all(w in t for w in ("いまの値", "待っているもの", "確定の見込み", "11/12以降")), t[:160])
        layout_ok("SD7c", "暫定の説明")
        if shots: pg.locator(".dd-hero").screenshot(path=f"{shots}-prov-hero.png"); pg.locator(".dd-prov").screenshot(path=f"{shots}-prov.png")
        pg.locator("button[aria-label$='1日後へ']").first.click(); calm()
        pg.locator(".metrics button", has_text="気温").click(); calm()
        pg.locator(".app-head .seg button", has_text="比較").click(); calm()
        check("SD6 比較に戻すと比較の表が戻る", pg.locator(".side-compare").count() == 1 and pg.locator(".day-detail").count() == 0)
        pg.evaluate("window.scrollTo(0, 0)")
    step("SD", sd)

    # RN. 雨の見込み（確認用）: 本物の形のこまとタイル（作ったもの）で、地図・グラフ・取れなかったこま・再生。
    def rn():
        shots = os.environ.get("WN_SHOT")
        # 雨の見込みは今日の 1日モードにある（2026-11-18）：札の言葉と「地図で見る」。過去の日には出ない。
        pg.locator(".app-head .seg button", has_text="1日").click(); calm()
        settle(lambda: pg.locator(".rn-card .rn-say-item").count() == 2 and "読み込み中" not in txt(".rn-card"), 15)
        check("RN0 今日の 1日モードに雨の見込み（1時間・15時間の2枚と「地図で見る」）", pg.locator(".rn-card .rn-say-item").count() == 2 and pg.locator(".rn-card button", has_text="地図で見る").count() == 1, txt(".rn-card")[:120])
        if shots: pg.screenshot(path=f"{shots}-rain-card.png", clip={**pg.locator(".day-detail").bounding_box(), "height": 520})
        pg.locator("button[aria-label$='1日前へ']").first.click(); calm()
        check("RN0b 昨日の 1日モードには雨の見込みが出ない", pg.locator(".rn-card").count() == 0)
        pg.locator("button[aria-label$='1日後へ']").first.click(); calm()
        settle(lambda: pg.locator(".rn-card button").count() == 1, 5)
        pg.locator(".rn-card button", has_text="地図で見る").click(); calm()
        settle(lambda: pg.locator(".rn-board .rn-map").count() == 1 and pg.locator(".rn-board .rn-loading").count() == 0, 15)
        check("RN1 雨の見込み：地図・つまみ・グラフが出る", pg.locator(".rn-board .rn-map canvas").count() == 1 and pg.locator(".rn-board .rn-scrub").count() == 1 and pg.locator(".rn-board .rn-graph").count() == 1)
        check("RN2 今のこま：「12:00」「今・実況」", "12:00" in txt(".rn-when") and "今・実況" in txt(".rn-when"), txt(".rn-when"))
        settle(lambda: "読み込み中" not in txt(".rn-say"), 20)
        check("RN3 この先の言葉が出る（読み込み中でない）", pg.locator(".rn-say-item").count() >= 2 and "読み込み中" not in txt(".rn-say"), txt(".rn-say"))
        if shots: pg.screenshot(path=f"{shots}-rain.png", full_page=True)
        # 取れなかったこま（11:30）：雨なしと見せない
        idx = [f["m"] for f in RAIN_NOW["frames"]].index(-30)
        pg.locator(".rn-scrub input").fill(str(idx)); calm()
        settle(lambda: pg.locator(".rn-miss").count() == 1, 8)
        check("RN4 取れなかったこま：「このこまは取れませんでした」と「取れなかった」", pg.locator(".rn-miss").count() == 1 and "取れなかった" in txt(".rn-when"), txt(".rn-when"))
        if shots: pg.screenshot(path=f"{shots}-rain-missing.png")
        # 1時間の量のこま：凡例の見出しが変わる
        idx = [f["m"] for f in RAIN_NOW["frames"]].index(150)
        pg.locator(".rn-scrub input").fill(str(idx)); calm()
        settle(lambda: pg.locator(".rn-loading").count() == 0, 8)
        check("RN5 1時間の量のこま：「1時間の量（mm）」と「1〜2時間後」…の幅", "1時間の量（mm）" in txt(".rn-legend-title") and "〜" in txt(".rn-when"), (txt(".rn-legend-title"), txt(".rn-when")))
        layout_ok("RN6", "雨の見込み")
        st = small_text(); check("RN7 11px より小さい文字がない（雨の見込み）", not st, str(st))
        check("RN8 画面からはみ出さない（雨の見込み）", no_overflow())
        pg.locator(".rn-diag summary").click(); calm()
        check("RN9 取れ方（確認用）：一覧3つとこまの数", pg.locator(".rn-diag tbody tr").count() == 3 and "こまのうち" in txt(".rn-diag-body"), txt(".rn-diag-body")[:200])
        if shots: pg.screenshot(path=f"{shots}-rain-hourly.png", full_page=True)
        esc()
        pg.locator(".app-head .seg button", has_text="比較").click(); calm()
    step("RN", rn)

    # AC. 長期の気温履歴を比べる（テスト）: L1 and L2 through the new core, side by side (#189)
    def ac():
        pg.click(".app-head .icon-btn"); calm()
        pg.locator(".msheet.settings button", has_text="長期の気温履歴を比べる").click(); calm()
        check("AC1 長期の気温履歴の比べ板が開く", pg.locator(".msheet.history-cmp").count() == 1)
        settle(lambda: "比べた日" in txt(".history-cmp-facts") and pg.locator(".history-cmp tbody tr").count() == 24, 8)
        t = txt(".history-cmp-facts")
        check("AC2 要約に比べた日数・境目の差・段が違った時間", "比べた日" in t and "境目の差の最大" in t and "段が違った時間" in t, t)
        check("AC3 選んだ日の24時間に、両方の段", pg.locator(".history-cmp tbody tr").count() == 24, str(pg.locator(".history-cmp tbody tr").count()))
        before = txt(".history-cmp .section-head:has-text('の時間ごと') .section-title")
        pg.locator(".history-cmp svg[aria-label*='境目の差']").first.scroll_into_view_if_needed(); calm()
        g = pg.locator(".history-cmp svg[aria-label*='境目の差']").first.bounding_box()
        pg.mouse.click(g["x"] + g["width"] * 0.3, g["y"] + g["height"] / 2); calm()
        after = txt(".history-cmp .section-head:has-text('の時間ごと') .section-title")
        check("AC4 境目の差のグラフをタップするとその日を選ぶ", before != after, f"{before} → {after}")
        # 横軸を共有する1つのグラフに2段（design-system 4.1）：選んだ日の線は1本で上下を通す
        gs = ".history-cmp svg[aria-label*='境目の差']"
        check("AC4b 気温と境目の差は1つのグラフ（2段）、選んだ日の線は1本", pg.locator(".history-cmp svg[aria-label*='L1']").count() == 1 and pg.locator(f"{gs} line[stroke='var(--ink-secondary)']").count() == 1)
        settle(lambda: pg.locator(".history-cmp tbody tr").count() == 24, 8)
        t2 = txt(".history-cmp-facts"); m2 = re.search(r"段が違った時間 (\d+)", t2)
        check("AC5 太字の行の数＝要約の「段が違った時間」", m2 and int(m2.group(1)) == pg.locator(".history-cmp tr.history-cmp-diff").count(), f"{t2} / {pg.locator('.history-cmp tr.history-cmp-diff').count()}")
        st = small_text(); check("AC6 11px より小さい文字がない（長期の気温履歴の比べ板）", not st, str(st))
        layout_ok("AC7", "長期の気温履歴の比べ板")
        if os.environ.get("WN_SHOT"): pg.locator(".history-cmp svg[aria-label*='境目の差']").screenshot(path=f"{os.environ['WN_SHOT']}-history-cmp.png")
        esc(); esc()
    step("AC", ac)

    # AS. 短期の履歴と答え（テスト）: one day's 肌感, S and rate from the new core (#189 S0)
    def as_():
        pg.click(".app-head .icon-btn"); calm()
        pg.locator(".msheet.settings button", has_text="短期の履歴と答え").click(); calm()
        check("AS1 短期の履歴と答えが開く", pg.locator(".msheet.short-hist").count() == 1)
        settle(lambda: pg.locator(".short-hist svg[aria-label*='短期の履歴 S']").count() == 1, 8)
        # 横軸を共有する1つのグラフに2段（design-system 4.1）：時刻の目盛りは下に1組だけ
        g = ".short-hist svg[aria-label*='短期の履歴 S']"
        check("AS2 肌感と S、変化の速さが横軸を共有する1つのグラフ（2段、時刻の目盛りは1組）", pg.locator(g).count() == 1 and "変化の速さ" in pg.locator(g).get_attribute("aria-label") and pg.locator(f"{g} text", has_text="12時").count() == 1)
        paths = pg.locator(".short-hist svg[aria-label*='短期の履歴 S'] path").count()
        check("AS3 肌感と S の線が引かれる", paths == 2, str(paths))
        t = txt(".short-hist .history-cmp-facts")
        check("AS4 要約に答えの件数と、いつもと違う動き", "この日の答え" in t and "いつもと違う動き" in t, t)
        pg.locator(".short-hist .seg button", has_text="日なた").click(); calm()
        check("AS5 日なたに切り替えると凡例も日なた", "肌感（日なた）" in txt(".short-hist .sun-test-legend"))
        st = small_text(); check("AS6 11px より小さい文字がない（短期の履歴と答え）", not st, str(st))
        layout_ok("AS7", "短期の履歴と答え")
        if os.environ.get("WN_SHOT"): pg.locator(".short-hist svg[aria-label*='短期の履歴 S']").screenshot(path=f"{os.environ['WN_SHOT']}-short-hist.png")
        esc(); esc()
    step("AS", as_)

    # AL. 学習あり版を比べる（テスト）: one step ahead on the person's answers (#189, #117)
    def al():
        pg.click(".app-head .icon-btn"); calm()
        pg.locator(".msheet.settings button", has_text="学習あり版を比べる").click(); calm()
        check("AL1 学習あり版を比べるが開く", pg.locator(".msheet.learned-cmp").count() == 1)
        t = txt(".learned-cmp .history-cmp-facts")
        check("AL2 要約に答えの件数", "答え" in t and "件" in t, t)
        b = pg.locator(".learned-cmp .btn.primary")
        check("AL3 答えがないうちは［比べる］を押せない", b.count() == 1 and b.is_disabled(), t)
        st = small_text(); check("AL4 11px より小さい文字がない（学習あり版を比べる）", not st, str(st))
        layout_ok("AL5", "学習あり版を比べる")
        buttons_ok("AL6", "学習あり版を比べる", 1)
        esc(); esc()
    step("AL", al)

    # R. 記録: the save button stays in view and names what is missing (#151 操作の体系)
    def rr():
        pg.click(".head-report"); calm()
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
        st = small_text(); check("R6 11px より小さい文字がない（記録）", not st, str(st))
        layout_ok("R7", "記録")
        buttons_ok("R8", "記録", 1)
        esc()
    step("R", rr)

    # K. feel map
    def k():
        pg.evaluate("__flick('.sheet-handle',600,120)"); calm()
        pg.locator(".side-target .strip-col.is-center .cell-feel.tappable-feel").first.click(); calm()
        head = pg.evaluate("document.querySelector('.side-target .date-button').innerText")
        md = txt(".band-map-date.center").split()[0]
        check("K0 中央の日のマップ", head.endswith("/" + md.split("/")[0] + "/" + md.split("/")[1]), f"マップ {md} / 表 {head}")
        check("K1 肌感マップが開く", pg.locator(".msheet.feel-sheet").count() == 1)
        st = small_text(); check("K1b 11px より小さい文字がない（肌感マップ）", not st, str(st))
        layout_ok("K1c", "肌感マップ")
        mh = pg.evaluate("document.querySelector('.msheet').getBoundingClientRect().height")
        sm = pg.evaluate("parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-max'))")
        check("K2 グラフシート最大と同じ高さ", abs(mh - sm) <= 2, f"{mh:.0f} vs {sm:.0f}")
        seen = pg.evaluate("""(() => { const d = document.querySelector('.bm-drum').getBoundingClientRect();
          return [...document.querySelectorAll('.band-cell')].filter(c => { const r = c.getBoundingClientRect(); return r.left >= d.left + 30 && r.right <= d.right + 1; }).length; })()""")
        check("K3 1枚の比較マップ（見えるのは7日×5区分）", seen == 35, str(seen))
        check("K4 予報のマスに網かけ", pg.locator(".bm-a.forecast").count() >= 1)
        check("K5 凡例がマップの下", pg.evaluate("document.querySelector('.map-legend').getBoundingClientRect().top > document.querySelector('.band-map').getBoundingClientRect().bottom"))
        pg.locator(".band-cell.center").nth(2).click(); calm()
        check("K6 マスで両日の詳細", pg.locator(".band-detail table").count() == 2)
        st = small_text(); check("K6b 11px より小さい文字がない（肌感マップの詳細）", not st, str(st))
        pg.locator(".seg button", has_text="推移").click(); calm()
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
        touch("touchEnd", x - 144, y); calm()
        after = txt(".band-trend .readout-card .ro-title")
        check("K7b 推移も横に動かすと日が進む（ドラム）", after != before, f"{before}→{after}")
        layout_ok("K7c", "肌感の推移（動かした後）")
        check("K8 時間区分の線にデータ色を使わない", pg.evaluate("![...document.querySelectorAll('svg.scrub line[stroke]')].some(l => ['#86b8ff','#f5c865','#c9a6f7','#f39a86','#8fd8c4'].includes(l.getAttribute('stroke')))"))
        check("K9 横にはみ出さない", no_overflow())
        pg.click(".msheet .icon-btn.close"); calm()
        check("K10 ×で閉じる", pg.locator(".msheet").count() == 0)
        # K7b moved the target day; back to today so the later steps start where they expect.
        pg.click(".today-chip") if pg.locator(".today-chip").count() else None; calm()
    step("K", k)

    # L. 条件から選ぶ
    def l():
        before = txt(".side-compare .date-button")
        pg.locator(".side-compare select.mode").select_option("__conditions"); calm(4500)
        check("L1 条件から選ぶが開く", pg.locator(".msheet.cond-sheet").count() == 1)
        check("L2 条件は5行（最高・最低・雨・台風・期間）", pg.locator(".cond-line").count() == 5)
        check("L3 最初は最高が開いて範囲（つまみ2つ）", pg.locator(".cond-line.open[data-cond=max] .slider input").count() == 2)
        st = small_text(); check("L3b 11px より小さい文字がない（条件から選ぶ）", not st, str(st))
        layout_ok("L3b", "条件から選ぶ")
        pg.locator(".cond-line[data-cond=max] .seg button", has_text="以上").click(); wait(300)
        check("L4 以上はつまみ1つ", pg.locator(".cond-line[data-cond=max] .slider input").count() == 1, txt(".cond-line[data-cond=max] .cond-value"))
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
            if pg.locator(".cond-col.day").count() and pg.locator(".cond-result .loading").count() == 0: break
            calm()
        n = pg.locator(".cond-col.day").count()
        check("L8 合う日の表", n >= 1, txt(".cond-count"))
        check("L8b 合う日は見出し（SectionHead）", pg.locator(".cond-result .section-head .cond-count").count() == 1)
        pg.locator(".cond-col.day").nth(0).click(); calm()
        after = txt(".side-compare .date-button")
        check("L9 選ぶと比較日が変わり、シートは開いたまま", after != before and pg.locator(".msheet").count() == 1, after)
        check("L10 取り消せる", pg.locator(".cond-toast button").count() == 1)
        pg.locator(".cond-toast button").click(); calm()
        check("L11 取り消すと元の比較日", txt(".side-compare .date-button") == before, txt(".side-compare .date-button"))
        # 雨の強さ・台風
        pg.locator(".cond-line[data-cond=rain] .seg button", has_text="降る").click(); wait(200)
        check("L12 降るで強さが選べる", pg.locator(".cond-line[data-cond=rain] .seg button", has_text="激しい").count() >= 1)
        pg.locator(".cond-line[data-cond=rain] .seg button", has_text="激しい").first.click(); wait(200)
        check("L13 値は「激しい雨」と読める", "激しい雨" in txt(".cond-line[data-cond=rain] .cond-value"), txt(".cond-line[data-cond=rain] .cond-value"))
        pg.locator(".cond-line[data-cond=rain] .seg button", has_text="問わない").first.click(); wait(200)
        pg.locator(".cond-line[data-cond=typhoon] .cond-head").click(); wait(200)
        pg.locator(".cond-line[data-cond=typhoon] .seg button", has_text="台風の日").first.click()
        for _ in range(30):
            if pg.locator(".cond-result .loading").count() == 0: break
            calm()
        check("L13b 台風の日を選ぶと最高・最低・雨は問わない、期間は通年", all("問わない" in txt(f".cond-line[data-cond={k}] .cond-value") for k in ("max", "min", "rain")) and "通年" in txt(".cond-line[data-cond=period] .cond-value"))
        check("L14 台風の日だけ：表に台風の号", pg.locator(".cond-col.day").count() >= 1 and "98号" in txt(".cond-table"), txt(".cond-count"))
        check("L15 台風の行に出典", "ベストトラック" in txt(".cond-line[data-cond=typhoon]"))
        layout_ok("L16", "条件から選ぶ 台風")
        pg.click(".msheet .icon-btn.close"); calm()
        pg.locator(".side-compare select.mode").select_option(index=0); calm()
    step("L", l)


    # M. summary minimise and 表に集中
    def m():
        pg.evaluate("__flick('.sheet-handle',-600,120)"); calm()
        pg.locator(".chart-hit").nth(7).click(force=True); calm()
        pg.click(".cs-toggle"); wait(300)
        check("M1 要約を畳む", pg.locator(".compare-summary.collapsed").count() >= 1)
        pg.click(".cs-toggle"); wait(300)
        check("M2 要約を広げる", pg.locator(".compare-summary.compact").count() == 1)
        pg.click(".back-btn"); calm()
        pg.locator(".side .icon-btn").first.click(); calm()
        check("M3 表に集中", pg.evaluate("document.querySelector('.app').classList.contains('full')"))
        pg.locator(".side .icon-btn").first.click(); calm()
        check("M4 表示を戻す", not pg.evaluate("document.querySelector('.app').classList.contains('full')"))
    step("M", m)

    # N. long press guard: no text selection anywhere
    def n_():
        us = pg.evaluate("getComputedStyle(document.querySelector('.chart')).webkitUserSelect || getComputedStyle(document.querySelector('.chart')).userSelect")
        check("N1 グラフの文字は選択されない", us == "none", us)
    step("N", n_)

    # DS. その日の要約 (#176): a long press on a day's weather picture, from the table and the calendar.
    def ds():
        def hold(loc):
            loc.scroll_into_view_if_needed(); bx = loc.bounding_box()
            pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); pg.mouse.down(); wait(700); pg.mouse.up(); calm()  # held on purpose: a long press
        pg.evaluate("window.scrollTo(0, 0)")
        # The day sheet lowered when it covers the table's pictures (raised again at the end).
        covered = pg.evaluate("""() => { const e = document.querySelector(".side-target .cell-icon[data-summary^='2026-11-08']"); const b = e.getBoundingClientRect();
          const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !(t && e.contains(t)); }""")
        if covered: pg.evaluate("__flick('.sheet-handle',700,120)"); calm()
        sheets = pg.locator(".msheet").count()
        hold(pg.locator(".side-target .cell-icon[data-summary^='2026-11-08']").first)
        check("DS1 表の天気の絵を長押しで要約が開く（タップの動きは起きない）", pg.locator(".day-summary-sheet").count() == 1 and pg.locator(".msheet").count() == sheets + 1, str(pg.locator(".msheet").count()))
        check("DS2 まとめ（浮いた面）に一言、読み取り（沈んだ面）に対象・比較・差", pg.locator(".day-summary-sheet .ds-lead .ds-comment span").count() >= 1 and pg.locator(".day-summary-sheet .readout-card .ro-label").count() == 8, txt(".day-summary-sheet .ds-comment") if pg.locator(".ds-comment").count() else "")
        check("DS2b 要約の年は「’25/」（半角の ' を使わない）", "'" not in txt(".day-summary-sheet"), txt(".day-summary-sheet .readout-card .ro-col")[:40] if pg.locator(".day-summary-sheet .ro-col").count() else "")
        check("DS3 強風の日は風の強さ（基準の目盛り）", pg.locator(".day-summary-sheet .ds-meter").count() == 2 and "強風" in txt(".day-summary-sheet .ro-title") and "強風" in txt(".day-summary-sheet .ds-comment"), txt(".day-summary-sheet .ro-title"))
        layout_ok("DS4", "要約")
        st = small_text(); check("DS5 11px より小さい文字がない（要約）", not st, str(st))
        pg.click(".day-summary-sheet .icon-btn.close"); calm()
        hold(pg.locator(".side-target .cell-icon[data-summary^='2026-11-09']").first)
        check("DS6 ふつうの日は風の強さを出さない", pg.locator(".day-summary-sheet").count() == 1 and pg.locator(".day-summary-sheet .ds-meter").count() == 0)
        pg.click(".day-summary-sheet .icon-btn.close"); calm()
        pg.locator(".side-target .date-button").click(); calm()
        hold(pg.locator(".calendar-grid [data-summary^='2026-11-05']").first)
        check("DS7 カレンダーからも長押しで要約（カレンダーの上に重なる）", pg.locator(".day-summary-sheet").count() == 1 and pg.locator(".msheet.calendar").count() == 1)
        pg.click(".day-summary-sheet .icon-btn.close"); calm()
        check("DS8 要約を閉じてもカレンダーはそのまま", pg.locator(".msheet.calendar").count() == 1 and pg.locator(".day-summary-sheet").count() == 0)
        # The table is not left held as moving by a release that landed on the sheet (Strip).
        check("DS9 長押しの後も表は動いていない扱いにならない", not pg.locator(".side-compare select.mode").is_disabled())
        pg.click(".msheet.calendar .icon-btn.close"); calm()
        if covered: pg.evaluate("__flick('.sheet-handle',-700,120)"); calm()
    step("DS", ds)

    # MR. 月の振り返り: opened from the calendar's month name; one place chooses; the pages follow.
    def mr():
        pg.locator(".side-target .date-button").click(); calm()
        pg.locator(".calendar-head .icon-btn").first.click(); calm()  # the month before: a whole month
        pg.click(".cal-month-review"); calm()
        check("MR1 カレンダーの月の名前で月の振り返りが開く（カレンダーは閉じる）", pg.locator(".month-review").count() == 1 and pg.locator(".msheet.calendar").count() == 0)
        check("MR2 ページは4つ（まとめ・日ごと・曜日・肌感）", pg.locator(".month-tabs button").count() == 4, txt(".month-tabs"))
        check("MR3b 台風の日：レポートに台風◯号と出典", "台風99号" in txt(".month-report") and "ベストトラック" in txt(".month-report"), txt(".month-report")[-200:])
        check("MR3 まとめに月の値とレポート（前年同曜日と比べる）", pg.locator(".month-review .readout-card").count() >= 1 and pg.locator(".month-report-part").count() >= 3 and "前年同曜日" in txt(".month-review"))
        pg.locator(".month-filter-days .chip").nth(6).click(); calm()  # 土
        check("MR4 曜日を選ぶと「選んだ N日」、レポートも選んだ日に", pg.locator(".month-picked").count() == 1 and "選んだ" in txt(".month-review .section-head") if pg.locator(".month-review .section-head").count() else False, txt(".month-picked") if pg.locator(".month-picked").count() else "")
        bx = pg.locator(".month-filter-days").bounding_box()
        pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); pg.mouse.down(); pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2 + 60, steps=4); pg.mouse.up(); calm()
        check("MR5 曜日の並びを下に引くとカレンダー（曜日の並びは隠れる）", pg.locator(".month-filter .month-cal").count() == 1 and pg.locator(".month-filter-days").count() == 0)
        check("MR5b カレンダーに台風の印（暴風域は塗り）", pg.locator(".month-cal-ty").count() >= 1 and pg.locator(".month-cal-ty.violent").count() >= 1, str(pg.locator(".month-cal-ty").count()))
        pg.click(".month-fold"); calm()
        check("MR6 つまみでたたむ", pg.locator(".month-filter .month-cal").count() == 0 and pg.locator(".month-filter-days").count() == 1)
        for i, name in enumerate(["日ごと", "曜日", "肌感"]):
            pg.locator(".month-tabs button").nth(i + 1).click(); calm()
            layout_ok(f"MR7{i}", f"月の振り返り {name}")
        st = small_text(); check("MR8 11px より小さい文字がない（月の振り返り）", not st, str(st))
        pg.click(".month-review .icon-btn.close"); calm()
        check("MR9 閉じると元の画面", pg.locator(".month-review").count() == 0)
    step("MR", mr)

    # Q. calendar: presets and custom
    def q():
        pg.locator(".side-compare .date-button").click(); calm()
        check("Q1 比較日のカレンダーにプリセット", pg.locator(".cal-presets .chip").count() == 5)
        check("Q2 マスに天気と最高気温", pg.locator(".cal-day .cal-max").filter(has_text=re.compile(r"\d")).count() >= 20)
        pg.locator(".cal-presets .chip", has_text="前週").click(); wait(300)
        check("Q3 プリセットで組み合わせが前週に", "前週" in txt(".cal-pair-interval"), txt(".cal-pair-interval"))
        st = small_text(); check("Q3b 11px より小さい文字がない（カレンダーの組み合わせ・プリセット）", not st, str(st))
        pg.click(".calendar-foot .primary"); calm()
        check("Q4 決定で前週になる", pg.locator(".side-compare select.mode").input_value() == "lastWeek" and txt(".side-compare .date-button") == "2026/11/3", txt(".side-compare .date-button"))
        pg.locator(".side-compare .date-button").click(); calm()
        pg.locator(".cal-day:not(:disabled)").nth(1).click(); wait(300)
        check("Q5 日を選ぶとカスタムと表示", "カスタム" in txt(".cal-pair-interval"), txt(".cal-pair-interval"))
        pg.click(".calendar-foot .primary"); calm()
        check("Q6 決定でカスタムになる", pg.locator(".side-compare select.mode").input_value() == "custom")
        pg.locator(".side-compare select.mode").select_option("sameDate"); calm()
    step("Q", q)

    # P. the four decisions (all B)
    def pp():
        check("P1 比較の表に差の行", pg.locator(".side-compare .label-diff").count() >= 2 and pg.locator(".side-compare .cell-diff").count() > 0)
        pg.locator(".side .icon-btn").first.click(); calm()
        wb = pg.locator(".side-target .strip-wrap").bounding_box()
        cols = pg.evaluate("[...document.querySelectorAll('.side-target .strip-col')].filter(c=>{const r=c.getBoundingClientRect();return r.left>=%f-1&&r.right<=%f+1}).length" % (wb["x"], wb["x"] + wb["width"]))
        check("P2 表に集中で9日", cols == 9, str(cols))
        check("P2b 横にはみ出さない", no_overflow())
        layout_ok("P2c", "表に集中")
        pg.locator(".side .icon-btn").first.click(); calm()
        pg.evaluate("__flick('.sheet-handle',-600,120)"); calm()
        pg.locator(".chart-hit").nth(7).click(force=True); calm()
        pg.evaluate("document.querySelector('.sheet-body').scrollTo(0,260)"); calm()
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
        touch("touchEnd", x - 144, y); calm()
        check("P3c 固定の1行も横スワイプで日が動く", pg.locator(".sheet-dock .compare-summary.pinned").count() == 1 and dd() != before, f"{before}→{dd()}")
        touch("touchStart", x - 144, y)
        for k in range(1, 9):
            touch("touchMove", x - 144 + k * 18, y); wait(16)
        touch("touchEnd", x, y); calm()
        pg.locator(".sheet-dock .compare-summary.pinned").click(); calm()
        check("P3b 1行をタップで要約に戻る", pg.locator(".sheet-dock .compare-summary").count() == 0)
        # Folded (畳む) after being open: the folded line still moves days.
        pg.locator(".cs-toggle").first.click(); calm()
        ld = lambda: txt(".compare-summary.collapsed .cs-line-date")
        before = ld()
        lb = pg.locator(".compare-summary.collapsed").first.bounding_box(); y = lb["y"] + lb["height"] / 2; x = lb["x"] + lb["width"] * 0.7
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); calm()
        check("P3d 畳んだ要約も横スワイプで日が動く", ld() != before, f"{before}→{ld()}")
        touch("touchStart", x - 144, y)
        for k in range(1, 9):
            touch("touchMove", x - 144 + k * 18, y); wait(16)
        touch("touchEnd", x, y); calm()
        pg.locator(".cs-toggle").first.click(); calm()
        pg.click(".back-btn"); calm()
        pg.evaluate("__flick('.sheet-handle',600,120)"); calm()
        pg.locator(".side-target .strip-col.is-center .cell-feel.tappable-feel").first.click(); calm()
        c = lambda: txt(".band-map-date.center").split()[0]
        before = c()
        bb = pg.locator(".band-map").bounding_box(); y = bb["y"] + 120; x = bb["x"] + bb["width"] * 0.75
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); calm()
        check("P4a 肌感マップの見出しにマップ／推移の切り替え", pg.locator(".band-face .section-head .seg").count() == 1)
        check("P4 肌感マップを横スワイプで日が進む（ドラム）", c() != before and pg.locator(".msheet").count() == 1, f"{before}→{c()}")
        # During a drag the days follow the finger (the drum), and a pressed cell stays in place.
        bb = pg.locator(".band-map").bounding_box(); y = bb["y"] + 120; x = bb["x"] + bb["width"] * 0.75
        x0 = pg.evaluate("document.querySelector('.band-cell.center').getBoundingClientRect().left")
        touch("touchStart", x, y)
        for k in range(1, 4):
            touch("touchMove", x - k * 10, y); wait(16)
        x1 = pg.evaluate("document.querySelector('.band-cell.center').getBoundingClientRect().left")
        f0 = pg.evaluate("document.querySelector('.bm-center-frame').getBoundingClientRect().left")
        touch("touchEnd", x - 30, y); calm()
        check("P4b 指を動かしている間、マスが指についてくる", x1 < x0 - 15, f"{x0:.0f}→{x1:.0f}")
        f1 = pg.evaluate("document.querySelector('.bm-center-frame').getBoundingClientRect().left")
        check("P4c 中心の枠は動かない（マスだけが下を通る）", abs(f1 - f0) < 1 and abs(f0 - x0) < 4, f"frame {f0:.0f}→{f1:.0f}, cell {x0:.0f}")
        esc()
    step("P", pp)

    # T. 日照 › 移り変わり (時刻で・明るさで, 1週間〜1年)
    def tt():
        pg.click(".today-chip") if pg.locator(".today-chip").count() else None; calm()
        pg.click(".metrics .chip:nth-child(4)"); calm()
        check("T1 日照の日別に［移り変わり］", pg.locator(".trend-btn").count() == 1, title())
        pg.click(".trend-btn"); calm()
        check("T2 見出し", title() == "明るさの移り変わり", title())
        check("T3 時刻で：見出しが分で言う", "分" in txt(".lt-head-main"), txt(".lt-head-main"))
        check("T4 時刻で：グラフ", pg.locator(".light-trend svg.lt-chart").count() == 1)
        st = small_text(); check("T4b 11px より小さい文字がない（日照と明るさの推移）", not st, str(st))
        before = txt(".light-trend .readout-card .ro-title")
        pg.evaluate("__flick('.sheet-handle',-600,120)"); calm()  # P left the sheet low; the graph must be on screen
        pg.locator(".light-trend .drum-pane svg").first.scroll_into_view_if_needed(); wait(300)
        bx = pg.locator(".light-trend .drum-pane svg").first.bounding_box(); y = bx["y"] + min(80, bx["height"] / 2); x = bx["x"] + bx["width"] * 0.75
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); calm()
        after = txt(".light-trend .readout-card .ro-title")
        check("T4c 1週間は横に動かすと日が進む（ドラム）", after != before, f"{before}→{after}")
        layout_ok("T4b", "明るさの移り変わり")
        for span in ["1か月", "1年", "1週間"]:
            pg.locator(".lt-controls button", has_text=span).click(); calm()
            check(f"T5 時刻で {span}", pg.locator(".light-trend svg.lt-chart").count() == 1 and no_overflow())
        pg.locator(".lt-controls button", has_text="明るさで").click(); calm()
        check("T6 明るさで：読み取りに長さ", "長さ" in txt(".light-trend .readout-card"), txt(".light-trend .readout-card"))
        # Days run across here too (#151): the dates sit under the plot in a row, left to right.
        xs = pg.evaluate("[...document.querySelectorAll('.light-trend .lt-dates .lt-date:not(.sub)')].map(e => e.getBoundingClientRect()).filter(r => r.left >= 30 && r.right <= innerWidth).map(r => [Math.round(r.left), Math.round(r.top)])")
        check("T6b 明るさで：日は横に並ぶ", len(xs) == 7 and len({y for _, y in xs}) == 1 and [x for x, _ in xs] == sorted(x for x, _ in xs), str(xs))
        for span in ["1か月", "1年", "1週間"]:
            pg.locator(".lt-controls button", has_text=span).click(); calm()
            check(f"T7 明るさで {span}", pg.locator(".light-trend svg.lt-chart").count() == 1 and no_overflow())
            layout_ok(f"T7b", f"明るさで {span}")
        pg.locator(".lt-controls button", has_text="時刻で").click(); calm()
        pg.click(".back-btn"); calm()
        check("T8 ‹日別で戻る", title() == "日照の日別", title())
        pg.click(".metrics .chip:nth-child(3)"); calm()
        check("T9 日差しには［移り変わり］がない", pg.locator(".trend-btn").count() == 0)
        pg.click(".metrics .chip:nth-child(1)"); calm()
    step("T", tt)

    # GR. 数字の格子 (#151): decimal points in one line down the table's centre column and down each
    # side of the comparison summary; the units once after the names there.
    def gr():
        esc() if pg.locator(".msheet").count() else None
        pg.evaluate("window.scrollTo(0, 0)")
        # The day's hours: its sheet opens with the comparison summary at the top.
        pg.locator(".side-target .strip-col.is-center .cell-stack").first.dispatch_event("click"); calm()  # under the sheet, perhaps
        r = pg.evaluate("""() => {
          const right = (e) => Math.round(e.getBoundingClientRect().right);
          const col = [...document.querySelectorAll('.side-target .strip-col.is-center .cell-value')].filter(e => /\d/.test(e.textContent)).map(right);
          const cs = document.querySelector('.compare-summary');
          const a = cs ? [...cs.querySelectorAll('.cs-val.cs-a .cs-num')].map(right) : [];
          const b = cs ? [...cs.querySelectorAll('.cs-val.cs-b .cs-num')].map(right) : [];
          const units = cs ? cs.querySelectorAll('.cs-val .unit').length : -1;
          const straight = (document.body.innerText.match(/'\d\d\//g) || []).length;
          const sun = cs ? [...cs.querySelectorAll('.cs-sun .cs-val')].map(e => e.getClientRects().length === 1 && e.scrollWidth <= e.clientWidth + 1 && Math.round(e.getBoundingClientRect().height) < 26) : [];
          return { col, a, b, units, sun, straight };
        }""")
        check("GR1 表の列で小数点が縦にそろう（右そろえ）", len(r["col"]) >= 3 and max(r["col"]) - min(r["col"]) <= 1, str(r["col"]))
        if r["a"]:
            check("GR2 比較の要約の両側で小数点が縦にそろう", max(r["a"]) - min(r["a"]) <= 1 and max(r["b"]) - min(r["b"]) <= 1, f'{r["a"]} {r["b"]}')
            check("GR3 比較の要約の単位は名前の後ろ（数字に付けない）", r["units"] == 0, str(r["units"]))
            check("GR4 日の出・日の入りの時刻は1行（折り返さない）", r["sun"] and all(r["sun"]), str(r["sun"]))
            check("GR5 短い年は「’25/」（半角の ' を使わない）", r["straight"] == 0, str(r["straight"]))
        else:
            check("GR2 比較の要約が開いている", False, "no .compare-summary")
        pg.click(".back-btn"); calm()
    step("GR", gr)

    # TY. 近づいている台風: a card at the top while a typhoon concerns the station; from it, the past typhoon days.
    def ty():
        check("TY0 台風がないときカードは出ない", pg.locator(".typhoon-card").count() == 0)
        TYPHOON_ON["on"] = True
        reload()
        check("TY1 台風のカード：号・気圧・強風域", pg.locator(".typhoon-card").count() == 1 and "台風14号" in txt(".typhoon-card") and "960" in txt(".typhoon-card") and "強風域に入っています" in txt(".typhoon-card"), txt(".typhoon-card") if pg.locator(".typhoon-card").count() else "")
        check("TY2 出典と気象庁へのリンク", "気象庁" in txt(".typhoon-source") and pg.locator(".typhoon-link[target=_blank]").count() == 1)
        layout_ok("TY3", "台風のカード")
        check("TY3b 表の今日に台（強風域）、明日に破線の台（暴風警戒域）", pg.locator(".side-target .typhoon-tag.gale").count() >= 1 and pg.locator(".side-target .typhoon-tag.warning").count() >= 1, str(pg.locator(".side-target .typhoon-tag").count()))
        # その日の要約 on a typhoon day: 台 by the picture, the typhoon first in the words, and the way in.
        loc = pg.locator(".side-target .cell-icon[data-summary^='2026-11-10']").first
        loc.scroll_into_view_if_needed(); bx = loc.bounding_box()
        pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); pg.mouse.down(); wait(700); pg.mouse.up(); calm()
        check("TY8 要約：絵の横に台、一言の最初に台風14号", pg.locator(".day-summary-sheet .ds-head .typhoon-tag").count() == 1 and txt(".day-summary-sheet .ds-comment").startswith("台風14号"), txt(".day-summary-sheet .ds-comment") if pg.locator(".ds-comment").count() else "")
        pg.click(".day-summary-sheet .ds-typhoon"); calm(1500)
        check("TY9 台風の詳細が開く：地図（海岸線）と見るもの3つ", pg.locator(".typhoon-sheet").count() == 1 and pg.evaluate("(document.querySelector('.ty-land')?.getAttribute('d') || '').length") > 1000 and pg.locator(".typhoon-sheet .seg button").count() == 3)
        pg.locator(".typhoon-sheet .seg button").nth(2).click(); calm()
        check("TY10 「今」：気象庁の今の発表を重ねる（強風域の円）", pg.locator(".typhoon-sheet .ty-gale").count() >= 1 and "960" in txt(".ty-say"), txt(".ty-say"))
        if os.environ.get("WN_SHOT"): pg.locator(".typhoon-sheet").screenshot(path=os.environ["WN_SHOT"] + "-now.png")
        pg.locator(".typhoon-sheet .seg button").nth(0).click(); calm()
        if os.environ.get("WN_SHOT"): pg.locator(".typhoon-sheet").screenshot(path=os.environ["WN_SHOT"] + "-real.png")
        layout_ok("TY11", "台風の詳細")
        st = small_text(); check("TY12 11px より小さい文字がない（台風の詳細）", not st, str(st))
        pg.click(".typhoon-sheet .icon-btn.close"); calm()
        pg.click(".day-summary-sheet .icon-btn.close"); calm()
        # A past typhoon day (the made-up 99号 crossing on 10/20) from the calendar: the track and its areas.
        pg.locator(".side-target .date-button").click(); calm()
        pg.locator(".calendar-head .icon-btn").first.click(); calm()
        check("TY13 カレンダーの日にも台", pg.locator(".calendar-grid .typhoon-tag").count() >= 1, str(pg.locator(".calendar-grid .typhoon-tag").count()))
        loc = pg.locator(".calendar-grid [data-summary^='2026-10-20']").first
        loc.scroll_into_view_if_needed(); bx = loc.bounding_box()
        pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); pg.mouse.down(); wait(700); pg.mouse.up(); calm()
        pg.click(".day-summary-sheet .ds-typhoon"); calm(1500)
        check("TY14 過去の台風：進路と、高知が入った域（暴風域）", pg.locator(".typhoon-sheet .ty-track").count() == 1 and "暴風域" in txt(".typhoon-sheet .ty-row.real"), txt(".typhoon-sheet .ty-row.real") if pg.locator(".ty-row.real").count() else "")
        if os.environ.get("WN_SHOT"): pg.locator(".typhoon-sheet").screenshot(path=os.environ["WN_SHOT"] + "-past.png")
        pg.click(".typhoon-sheet .icon-btn.close"); calm()
        pg.click(".day-summary-sheet .icon-btn.close"); calm()
        pg.click(".msheet.calendar .icon-btn.close"); calm()
        pg.get_by_text("前の台風の日と比べる").click(); calm(4500)
        check("TY4 条件から選ぶが台風の日で開く（気温・雨は問わない、通年）", pg.locator(".msheet.cond-sheet").count() == 1 and "台風の日" in txt(".cond-line[data-cond=typhoon] .cond-value") and "問わない" in txt(".cond-line[data-cond=max] .cond-value") and "通年" in txt(".cond-line[data-cond=period] .cond-value"))
        pg.click(".msheet .icon-btn.close"); calm()
        TYPHOON_ON["on"] = False
        TYPHOON_ON["fail"] = True
        reload()
        check("TY5 取得に失敗したら「取得できませんでした」（台風なしと区別）", pg.locator(".typhoon-failed").count() == 1 and pg.locator(".typhoon-card").count() == 0)
        TYPHOON_ON["fail"] = False
        reload()
        check("TY6 取れて台風なしなら何も出ない", pg.locator(".typhoon-failed").count() == 0 and pg.locator(".typhoon-card").count() == 0)
        TYPHOON_ON["old"] = True
        reload()
        check("TY7 古い情報で台風なしでも「更新できていません」（カードの有無と別）", pg.locator(".typhoon-failed").count() == 1 and "更新できていません" in txt(".typhoon-failed"))
        TYPHOON_ON["old"] = False
        reload()
    step("TY", ty)

    if os.environ.get("WN_SEEN"):
        with open(os.environ["WN_SEEN"], "w") as f: f.write("\n".join(sorted(SMALL_SEEN)))

    # The 500s step FS asks for on purpose are not errors of the app.
    errors = [e for e in errors if not (FAILED_ON_PURPOSE and "status of 500" in e)]
    # So are the tiles RN answers 404 (取れなかったこま).
    errors = [e for e in errors if not (TILES_404 and "status of 404" in e)]
    check("Z コンソールのエラーなし", not errors, "; ".join(errors[:5]))
    b.close()
srv.shutdown()
ok = sum(r[0] for r in results)
print(f"WIDTH {W}: {ok}/{len(results)} passed")
# Where the time goes (#CI): the slowest steps, so a slow run can be read from its log.
print("STEPS " + " ".join(f"{n}={t:.1f}s" for n, t in sorted(TIMES, key=lambda x: -x[1])[:12]) + f" (all {sum(t for _, t in TIMES):.0f}s)")
for r in results:
    if not r[0] or os.environ.get("WN_ALL"): print("  NG" if not r[0] else "  ok", r[1], r[2][:80])
sys.exit(0 if ok == len(results) else 1)
