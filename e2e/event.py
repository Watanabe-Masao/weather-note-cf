# イベントの日の見出し（docs/event-banner.md 6章）。`vite build` のあとに：python3 e2e/event.py 390|360
# 時計を満月の日（2026-11-24 ビーバームーン）に合わせ、3テーマで：絵の帯がアイコンと文字の場所に1枚、見出しの高さは
# ふだんの日と同じ、「比較｜1日」と重ならない、押すと説明が開き閉じると消える。絵が読めないと手描きの帯（アイコンつき）。
# ふだんの日は絵を読まず、前日は翌日の絵を読んでおく。
import time
import functools, http.server, json, threading, os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.environ.get("WN_DIST") or os.path.join(HERE, "..", "dist", "client")
PORT = int(os.environ.get("WN_PORT", "8812"))
SHOTS = os.environ.get("WN_SHOTS")
W = int(sys.argv[1]) if len(sys.argv) > 1 else 390
ADMIN = {"on": False}  # 確認ページの段だけ、/api/auth/me が管理者を返す

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith("/api/auth/me") and ADMIN["on"]:
            body = json.dumps({"user": {"id": "u1", "loginId": "masao", "name": "渡辺", "role": "admin", "research": {"granted": False, "version": None, "at": None}, "consentVersion": 1}, "setup": False}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body); return
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

def until(pg, cond, timeout=5.0):
    """Waits until cond() is true (or the time is up), instead of a fixed sleep (#371). Waits with the page's
    own timer so the page's events (requests) keep coming in meanwhile (time.sleep would hold them)."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond(): return True
        pg.wait_for_timeout(100)
    return cond()

# 物語のスクロールが止まるまで（0.4秒ごとに見て、動いていなければ）。
settle_js = "new Promise((res) => { const s = document.querySelector('.moon-story'); let p = -1; const t = () => { const c = s.scrollTop; if (Math.abs(c - p) < 0.5) res(c); else { p = c; setTimeout(t, 400); } }; setTimeout(t, 400); })"

def page(b, iso, theme, block=False):
    ctx = b.new_context(viewport={"width": W, "height": 844}, device_scale_factor=2 if SHOTS else 1, is_mobile=True, has_touch=True, locale="ja-JP", timezone_id="Asia/Tokyo", service_workers="block")
    ctx.add_init_script(clock(iso))
    ctx.add_init_script(f"try {{ localStorage.setItem('weather-note-theme', '{theme}') }} catch {{}}")
    asked = []
    ctx.on("request", lambda r: "/event/" in r.url and asked.append(r.url))
    if block: ctx.route("**/event/**", lambda r: r.fulfill(status=404, body="none"))
    pg = ctx.new_page()
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_selector(".app-head .brand")
    return ctx, pg, asked

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    print(f"イベントの日の見出し {W}px")
    for theme in ("navy", "warm", "mist"):
        ctx, pg, asked = page(b, "2026-11-10T03:00:00Z", theme)
        # 読まないことを確かめるので、前の日の先読み（数秒後）より長く待つ（わざと固定の待ち）。
        base = pg.evaluate(HEAD); pg.wait_for_timeout(3600)
        check(f"[{theme}] ふだんの日：アイコンと文字、絵は読まない", base["icon"] == 1 and base["art"] is None and base["hand"] == 0 and not asked, (base, asked))
        ctx.close()
        # 出す期間は「イベントの夜」の前日と当日（11/21 渡辺さん）。その前の日に、翌日から出す絵を読んでおく。
        ctx, pg, asked = page(b, "2026-11-22T03:00:00Z", theme)
        until(pg, lambda: any(f"/event/beaver-{theme}.webp?v=" in u for u in asked), 8.0)
        check(f"[{theme}] 出す前の日：翌日から出す絵を読んでおく", any(f"/event/beaver-{theme}.webp?v=" in u for u in asked), asked)
        ctx.close()
        ctx, pg, asked = page(b, "2026-11-23T03:00:00Z", theme)
        check(f"[{theme}] 前日：予告として絵の帯を出す", pg.locator(".brand-art").count() == 1, None)
        ctx.close()
        ctx, pg, asked = page(b, "2026-11-24T03:00:00Z", theme)
        pg.wait_for_function("(document.querySelector('.brand-art img') || {}).naturalWidth > 0", timeout=5000)
        ev = pg.evaluate(HEAD)
        if SHOTS: pg.locator(".app-head").screenshot(path=f"{SHOTS}-event-{theme}-{W}.png")
        check(f"[{theme}] 満月の日：絵の帯が1枚（アイコンなし）、横4：縦1、見出しの高さはふだんと同じ、右の操作と重ならない",
              ev["img"] > 0 and ev["icon"] == 0 and ev["hand"] == 0 and abs(ev["art"]["w"] / ev["art"]["h"] - 4) < 0.15 and ev["head"] == base["head"] and (ev["left"] is None or ev["art"]["right"] <= ev["left"]), (ev, base["head"]))
        pg.locator(".brand-tap").click(); pg.wait_for_selector(".event-sheet")
        sheet = pg.locator(".event-sheet").inner_text() if pg.locator(".event-sheet").count() else ""
        pic = pg.evaluate("(() => { const i = document.querySelector('.event-sheet img.event-pic'); return i ? { src: i.getAttribute('src'), w: i.naturalWidth } : null })()")
        # 説明の主役は文字の無い四角い絵（11/20 渡辺さん「ロゴ入りをそのまま使うのは下品」）と、名前を大きく。
        check(f"[{theme}] 説明：主役は文字の無い四角い絵と名前（ロゴ入りの帯は出さない）、満月の時刻とあと何時間、月の出入り",
              pic and "/event/beaver-icon.webp" in pic["src"] and pic["w"] > 0 and pg.locator(".event-sheet .event-stage-text b", has_text="ビーバームーン").count() == 1
              and pg.locator(".event-sheet img[src*='-navy.webp'], .event-sheet img[src*='-warm.webp'], .event-sheet img[src*='-mist.webp']").count() == 0
              and "23:54" in sheet and "あと" in sheet and "月の出" in sheet and pg.locator(".event-sheet svg.event-path .event-path-line").count() >= 1 and pg.locator(".event-sheet .event-path-peak").count() == 1, (pic, sheet[:60]))
        # 満月の物語（11/20、全画面のスクロール、GSAP）：説明のボタンで開き、本の表紙 → 絵本の場面（一文が一コマ）→ 章が並ぶ。最後までスクロールでき、閉じると説明に戻る。
        if theme == "navy":
            pg.locator(".event-sheet .fm-book-btn").click(); pg.wait_for_selector(".moon-story.ready", timeout=10000)
            st = pg.evaluate("""() => { const s = document.querySelector('.moon-story'); if (!s) return null;
              return { h2: (s.querySelector('.bk-front h2') || {}).textContent, info: s.querySelectorAll('.ms-info .event-moment-card, .ms-info .event-night').length, chapters: s.querySelectorAll('.ms-chapter').length, caps: s.querySelectorAll('.ms-world .ms-cap').length, svg: s.querySelectorAll('.ms-world svg.bw .bw-stick').length,
                       text: s.querySelector('.bk-tag')?.textContent === 'いっぽん。また、いっぽん。' && s.textContent.includes('名前のひみつ') && s.textContent.includes('自然と科学') && s.textContent.includes('はらり、はらり。') && !s.querySelector('.ms-epilogue') && s.textContent.includes('満月の物語の本棚') && s.querySelectorAll('.ms-shelf .ms-spine').length === 13 && s.querySelectorAll('.ms-shelf .ms-spine-gap').length === 1,
                       scroll: s.scrollHeight - s.clientHeight, gsap: !!document.querySelector('.moon-story.ready') } }""")
            # 絵本の形（11/21 承認C の PR-3）：順番は 絵本 → あとがき → 自然と科学 → 今夜の月 → 本棚。物語の終わり（ページ送りの
            # 最後の区切り）はあとがき。物語の月は今夜の情報へ移さない。「物語をとばす」はあとがきへ、そこから↑で絵本へ戻れる。
            order = pg.evaluate("""() => { const s = document.querySelector('.moon-story'); const at = (q) => { const e = s.querySelector(q); return e ? [...s.querySelectorAll('section')].indexOf(e.closest('section')) : -1 };
              const texts = [...s.querySelectorAll('.ms-text')].map((e) => [...s.querySelectorAll('section')].indexOf(e));
              return { after: texts[0], science: texts[1], info: at('.ms-info'), shelf: at('.ms-tonight'), end: at('[data-story-end]'), fly: s.querySelectorAll('.ms-flymoon').length, kicker: (s.querySelector('.ms-paper-kicker') || {}).textContent } }""")
            check("満月の物語（絵本の形）：あとがき → 自然と科学 → 今夜の月 → 本棚、物語の終わりはあとがき、物語の月は移さない",
                  order["after"] >= 0 and order["after"] < order["science"] < order["info"] < order["shelf"] and order["end"] == order["after"] and order["fly"] == 0 and order["kicker"] == "物語のあとがき", order)
            pg.locator(".moon-story .ms-skip .btn").click()
            pg.wait_for_function("(() => { const s = document.querySelector('.moon-story'); const e = s.querySelector('[data-story-end]'); return Math.abs(s.scrollTop - e.offsetTop) < 4 })()", timeout=45000)
            pg.evaluate(settle_js)
            top0 = pg.evaluate("document.querySelector('.moon-story').scrollTop")
            pg.keyboard.press("ArrowUp")
            # 朗読の速さで一つ前の区切りへ運ぶ（数秒）。動き終わるまで待つ。
            pg.wait_for_function(f"document.querySelector('.moon-story').scrollTop < {top0} - 100", timeout=15000); pg.evaluate(settle_js)
            top1 = pg.evaluate("document.querySelector('.moon-story').scrollTop")
            check("満月の物語（絵本の形）：「物語をとばす」であとがきの頭へ、↑で絵本の最後のページへ戻る", top1 < top0 - 100, (top0, top1))
            # 横に払う（11/21 渡辺さん）：縦書きの本と同じく、右から左で前、左から右で次。画面の端から始めた払いは受けない。
            swipe = """([x0, x1]) => new Promise((res) => { const el = document.querySelector('.moon-story'); const mk = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 500 });
              const fire = (t, x) => el.dispatchEvent(new TouchEvent(t, { touches: t === 'touchend' ? [] : [mk(x)], changedTouches: [mk(x)], cancelable: true, bubbles: true }));
              fire('touchstart', x0); let i = 1; const tick = () => { fire('touchmove', x0 + (x1 - x0) * i / 8); if (++i <= 8) setTimeout(tick, 16); else { fire('touchend', x1); res(); } }; setTimeout(tick, 16); })"""
            settle = "new Promise((res) => { const s = document.querySelector('.moon-story'); let p = -1; const t = () => { const c = s.scrollTop; if (Math.abs(c - p) < 0.5) res(c); else { p = c; setTimeout(t, 400); } }; setTimeout(t, 400); })"
            pg.evaluate(swipe, [W - 80, 80]); back = pg.evaluate(settle)
            pg.evaluate(swipe, [8, W - 80]); edge = pg.evaluate(settle)
            pg.evaluate(swipe, [80, W - 80]); fwd = pg.evaluate(settle)
            check("満月の物語（絵本の形）：横に払っても一つ戻る・進む（右から左で前、左から右で次、端から始めた払いは受けない）",
                  back < top1 - 100 and abs(edge - back) < 3 and abs(fwd - top1) < 4, (top1, back, edge, fwd))
            pg.evaluate("document.querySelector('.moon-story').scrollTo(0, 1e6)"); pg.wait_for_selector(".moon-story .ms-end .btn")
            end = pg.locator(".moon-story .ms-end .btn", has_text="閉じる").count()
            pg.locator(".moon-story .ms-close .icon-btn").click(); pg.wait_for_selector(".moon-story", state="detached")
            check("満月の物語：本の表紙の名前・絵本の場面（9コマ・住みかの枝）・今夜の情報（瞬間とその夜の空のカード）・由来・自然・本棚（13冊と読んでいる本の空き）・最後まで動く、閉じると説明に戻る",
                  st and st["h2"] == "ビーバームーン" and st["caps"] == 9 and st["svg"] > 20 and st["info"] == 2 and st["chapters"] >= 4 and st["text"] and st["scroll"] > 2000 and st["gsap"] and end == 1 and pg.locator(".moon-story").count() == 0 and pg.locator(".event-sheet").count() == 1, st)
        pg.locator(".event-sheet .icon-btn.close").click(); pg.wait_for_selector(".event-sheet", state="detached")
        check(f"[{theme}] 押すと説明（ビーバームーン）、閉じると消える", "ビーバームーン" in sheet and pg.locator(".event-sheet").count() == 0, sheet[:40])
        ctx.close()
        ctx, pg, asked = page(b, "2026-11-24T03:00:00Z", theme, block=True)
        pg.wait_for_selector(".brand-event")
        fb = pg.evaluate(HEAD)
        check(f"[{theme}] 絵が読めないと手描きの帯（アイコンつき）、見出しの高さは同じ", fb["art"] is None and fb["hand"] == 1 and fb["icon"] == 1 and fb["head"] == base["head"], fb)
        ctx.close()
    # コールドムーンの場面（11/22 PR-2、実装計画 v0.2）：12/23 の夜に物語を開くと、雪の森の場面（9コマ）・穴のある幹・
    # 表紙の絵・閉じた本の型押し。「物語をとばす」はあとがきへ。ビーバームーンの場面は出ない。
    ctx, pg, asked = page(b, "2026-12-23T11:00:00Z", "navy")
    pg.locator(".brand-tap").click(); pg.wait_for_selector(".event-sheet")
    pg.locator(".event-sheet .fm-book-btn").click(); pg.wait_for_selector(".moon-story.ready", timeout=10000)
    cw = pg.evaluate("""() => { const s = document.querySelector('.moon-story'); return {
        h2: s.querySelector('h2')?.textContent, cw: s.querySelectorAll('svg.cw').length, bw: s.querySelectorAll('svg.bw').length,
        trunk: s.querySelectorAll('svg.cw .cw-trunk').length, caps: s.querySelectorAll('.ms-cap').length, beats: s.querySelectorAll('.ms-beat').length,
        cover: s.querySelectorAll('.bk-cover svg.bca').length, medal: !!s.querySelector('img.ms-endbook-art[src*="/cold/emboss-medal"]'),
        moon: s.querySelectorAll('svg.cw [data-story-moon]').length } }""")
    pg.locator(".moon-story .ms-skip .btn").click()
    pg.wait_for_function("(() => { const s = document.querySelector('.moon-story'); const e = s.querySelector('[data-story-end]'); return Math.abs(s.scrollTop - e.offsetTop) < 4 })()", timeout=45000)
    after = pg.evaluate("(() => { const s = document.querySelector('.moon-story'); return (s.querySelector('[data-story-end] .ms-paper-kicker') || {}).textContent })()")
    check("コールドムーン：雪の森の場面（9コマ・9ページ・穴のある幹・月は一つ）、表紙の絵と閉じた本の型押し、「物語をとばす」はあとがきへ",
          cw["h2"] == "コールドムーン" and cw["cw"] == 1 and cw["bw"] == 0 and cw["trunk"] == 1 and cw["caps"] == 9 and cw["beats"] == 9 and cw["cover"] == 1 and cw["medal"] and cw["moon"] == 1 and after == "物語のあとがき", (cw, after))
    ctx.close()
    # 確認ページ（管理者だけ、docs/event-banner.md 5章）：全部の種類の帯（見出しと同じ物）と台帳の状態、これからの1年。
    # 「この日として見出しを表示」で、ふだんの日（11/10）の見出しが 2026/11/24 のビーバームーンの帯になり、元に戻すと戻る。
    ADMIN["on"] = True
    ctx, pg, asked = page(b, "2026-11-10T03:00:00Z", "navy")
    pg.locator("button[aria-label='設定']").click(); pg.wait_for_selector(".msheet.settings")
    pg.locator(".msheet.settings .btn", has_text="帯の一覧と、この日として表示").click(); pg.wait_for_selector(".ev-preview")
    pg.wait_for_function("document.querySelectorAll('.ev-year li').length > 0", timeout=10000)
    kinds = pg.locator(".ev-kinds li").count(); arts = pg.locator(".ev-kinds .brand-art").count(); hands = pg.locator(".ev-kinds .brand-event").count(); words = pg.locator(".ev-kinds .brand-art-word").count()
    year = pg.locator(".ev-year").inner_text(); meta = pg.locator(".ev-kinds").inner_text()
    if SHOTS: pg.locator(".ev-kinds").screenshot(path=f"{SHOTS}-preview-{W}.png")
    check("確認ページ：20種類すべて絵の帯（コーンムーンと食6種類は文字なしの絵にアプリの文字を重ねる）、これからの1年に 11/24 ビーバームーン、次の日付つき", kinds == 20 and arts == 20 and hands == 0 and words == 7 and "2026/11/24" in year and "ビーバームーン" in year and "次は 2027/7/19" in meta, (kinds, arts, hands, words, year[:80]))
    pg.locator(".ev-kinds li", has_text="ウルフムーン").locator(".brand-art").click(); pg.wait_for_selector(".event-sheet")
    t = pg.locator(".event-sheet").inner_text() if pg.locator(".event-sheet").count() else ""
    pg.locator(".event-sheet .icon-btn.close").click(); pg.wait_for_selector(".event-sheet", state="detached")
    check("確認ページ：帯を押すと、その日（次の日付）の説明", "1/22 の空" in t and "ウルフムーン" in t, t[:40])
    pg.locator(".ev-year .btn", has_text="2026/11/24").click(); pg.wait_for_selector(".ev-year button[aria-pressed=true]")
    pg.locator(".ev-preview .icon-btn.close").click(); pg.wait_for_selector(".ev-preview", state="detached")
    pg.locator(".msheet.settings .icon-btn.close").click(); pg.wait_for_selector(".msheet.settings", state="detached")
    on = pg.evaluate(HEAD)
    pg.locator("button[aria-label='設定']").click(); pg.wait_for_selector(".msheet.settings")
    pg.locator(".msheet.settings .btn", has_text="帯の一覧と、この日として表示").click(); pg.wait_for_selector(".ev-preview")
    pg.locator(".ev-day .btn", has_text="元に戻す").click(); pg.wait_for_function("document.querySelector('.ev-preview [role=status]')?.textContent.includes('今日のまま')")
    pg.locator(".ev-preview .icon-btn.close").click(); pg.wait_for_selector(".ev-preview", state="detached")
    pg.locator(".msheet.settings .icon-btn.close").click(); pg.wait_for_selector(".msheet.settings", state="detached")
    off = pg.evaluate(HEAD)
    check("この日として見出しを表示：11/10 の見出しが 11/24 の帯になり、元に戻すとアイコンと文字", on["art"] is not None and on["icon"] == 0 and off["art"] is None and off["icon"] == 1 and off["hand"] == 0, (on, off))
    ctx.close()
    b.close()
srv.shutdown()
print("ALL OK" if ok else "SOME NG")
sys.exit(0 if ok else 1)
