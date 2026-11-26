# 満月の物語の品質の確認（docs/moon-story-quality.md「手順書」）。`npm run build` のあとに：
#   python3 scripts/story-qa.py layout   <満月の日（UTC の日時）> [幅=390]   … 字の配置（取り残しの字・操作ボタンとの重なり）
#   python3 scripts/story-qa.py stops    <満月の日> [幅=390]               … 再生の可逆性（↓ で最後まで、↑ で最初まで。止まる所ごとに行きと帰りが同じか）
#   python3 scripts/story-qa.py env      <満月の日>                        … 表示環境（動きを減らす設定の折り、横向き・小さな画面で字が画面の外へ出ないか）
#   python3 scripts/story-qa.py timeline <満月の日> <CSS セレクタ>...      … 時間軸（自動で読み、ページごとの字の出入りと、指定した絵の部品の不透明度の時刻）
#   例：python3 scripts/story-qa.py timeline 2026-12-23T11:00:00Z .cw-band .cw-birdlight .cw-sky-dawn .ms-world-frame
# 出力は WN_QA_OUT（既定 /tmp/story-qa）に、log.json と画面。問題があれば終了コード 1。
# 測るときの決まり：一本ずつ動かす（並べて動かすと時間が詰まって測られる）。止まった所は、スクロールが止まってから 2.5 秒待って測る。
import functools, http.server, json, os, sys, threading, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.environ.get("WN_DIST") or os.path.join(HERE, "..", "dist", "client")
PORT = int(os.environ.get("WN_PORT", "8841"))
OUT = os.environ.get("WN_QA_OUT", "/tmp/story-qa")
SIZES = {320: 568, 375: 667, 390: 844, 430: 932}
if len(sys.argv) < 3 or sys.argv[1] not in ("layout", "stops", "env", "timeline"):
    print("使い方はこのファイルの先頭のコメントを見てください。"); sys.exit(2)
MODE, AT = sys.argv[1], sys.argv[2]
ARGS = sys.argv[3:]
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
SETTLE = """new Promise((res) => { const s = document.querySelector('.moon-story'); let p = -1, still = 0;
  const t = () => { const c = s.scrollTop; if (Math.abs(c - p) < 0.5) { if (++still >= 3) return res(c); } else still = 0; p = c; setTimeout(t, 300); }; setTimeout(t, 300); })"""
errors = []


def open_book(b, w, h, rm="no-preference"):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=True, has_touch=True, locale="ja-JP",
                        timezone_id="Asia/Tokyo", service_workers="block", reduced_motion=rm)
    ctx.add_init_script(CLOCK)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_timeout(1200)
    pg.locator(".brand-tap").click(); pg.wait_for_timeout(600)
    pg.locator(".event-sheet .fm-book-btn").click()
    pg.wait_for_selector(".moon-story.ready", timeout=15000); pg.wait_for_timeout(800)
    pg.locator(".moon-story").focus()
    return ctx, pg


def width():
    return int(ARGS[0]) if ARGS else 390


def layout(b):
    # 自動で読みながら、節（ページ）の字が出そろうたびに止めて、列ごとの字数と操作ボタンとの重なりを測る。
    w = width(); ctx, pg = open_book(b, w, SIZES[w])
    state = """() => { const out = []; document.querySelectorAll('.ms-cap[data-i]').forEach(c => { if (+getComputedStyle(c).opacity < 0.98) return;
      const secs = [...c.querySelectorAll('.ms-sec')]; (secs.length ? secs : [c]).forEach((g, j) => { const ch = [...g.querySelectorAll('.ms-ch')];
      if (ch.length && ch.every(e => +getComputedStyle(e).opacity > 0.98)) out.push([+c.dataset.i, secs.length ? j : -1]); }); }); return out }"""
    cols = """([k, j]) => { const c = document.querySelector(`.ms-cap[data-i="${k}"]`); const g = j < 0 ? c : c.querySelectorAll('.ms-sec')[j];
      const cols = {}; g.querySelectorAll('.ms-ch').forEach(e => { const r = e.getBoundingClientRect(); if (r.width < 1) return; const x = Math.round(r.left / 6); (cols[x] = cols[x] || []).push(e.textContent) });
      const box = [...g.querySelectorAll('.ms-ch')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
      const bb = [Math.min(...box.map(r => r.left)), Math.min(...box.map(r => r.top)), Math.max(...box.map(r => r.right)), Math.max(...box.map(r => r.bottom))];
      const ui = ['.ms-skip', '.ms-auto', '.ms-close'].map(q => document.querySelector(q)?.getBoundingClientRect()).filter(Boolean);
      const hitUI = ui.some(u => !(u.right < bb[0] || u.left > bb[2] || u.bottom < bb[1] || u.top > bb[3]));
      const off = bb[0] < 0 || bb[2] > innerWidth || bb[1] < 0 || bb[3] > innerHeight;
      return { cols: Object.values(cols).map(v => v.join('')), hitUI, off } }"""
    seen, rep = set(), []
    btn = pg.locator(".ms-auto button"); btn.click(); t0 = time.time()
    while time.time() - t0 < 420:
        new = [tuple(x) for x in pg.evaluate(state) if tuple(x) not in seen]
        if new:
            btn.click(); pg.wait_for_timeout(300)
            for k, j in new:
                seen.add((k, j)); info = pg.evaluate(cols, [k, j])
                rep.append({"page": k + 1, "sec": j, **info, "orphan": [c for c in info["cols"] if len(c) <= 2]})
                pg.screenshot(path=f"{OUT}/layout-{w}-p{k + 1}-{j}.png")
            btn.click()
        if pg.locator(".ms-auto button").get_attribute("aria-pressed") == "false" and time.time() - t0 > 5: break
        pg.wait_for_timeout(80)
    ctx.close(); json.dump(rep, open(f"{OUT}/layout-{w}.json", "w"), ensure_ascii=False, indent=0)
    bad = 0
    for r in rep:
        flag = ("取り残し " + "・".join(r["orphan"]) if r["orphan"] else "") + (" ボタンと重なる" if r["hitUI"] else "") + (" 画面の外" if r["off"] else "")
        bad += bool(flag); print(w, f"{r['page']}P", "節" + str(r["sec"]) if r["sec"] >= 0 else "", "|".join(r["cols"]), flag)
    print(f"{len(rep)} 区切りを測った。問題 {bad} 件。")
    return bad == 0


STATE = """() => { const op = (q) => { const e = document.querySelector(q); return e ? Math.round(+getComputedStyle(e).opacity * 100) / 100 : null };
  const caps = [...document.querySelectorAll('.ms-cap[data-i]')].map(c => +getComputedStyle(c).opacity > 0.5 ? [...c.querySelectorAll('.ms-sec')].length
    ? [...c.querySelectorAll('.ms-sec')].map(g => [...g.querySelectorAll('.ms-ch')].filter(e => +getComputedStyle(e).opacity > 0.5).length).join('/')
    : String([...c.querySelectorAll('.ms-ch')].filter(e => +getComputedStyle(e).opacity > 0.5).length) : '0');
  const world = document.querySelector('.ms-world svg'); const parts = world ? [...world.querySelectorAll('[class]')].filter(e => e.getAttribute('class').split(' ').some(k => /^[a-z]+w-/.test(k))) : [];
  const ops = {}; parts.forEach(e => { const k = e.getAttribute('class').split(' ')[0]; if (!(k in ops)) ops[k] = Math.round(+getComputedStyle(e).opacity * 20) / 20 });
  const cams = [...document.querySelectorAll('[class$="-camera"], [class*="-camera "]')].map(e => e.getAttribute('transform') || getComputedStyle(e).transform);
  return { top: Math.round(document.querySelector('.moon-story').scrollTop), caps: caps.join(' '), ops, cams: cams.map(c => (c || '').replace(/(\\d+\\.\\d)\\d+/g, '$1')).join(' '),
    frame: op('.ms-world-frame'), world: (() => { const e = document.querySelector('.ms-world'); if (!e) return 0; const r = e.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight ? +getComputedStyle(e).opacity : 0 })() } }"""


def settled_state(pg):
    # 止まった所の状態。ずっとくり返す動き（月の光の呼吸など、時間で動く部品）は、0.8 秒あけて二回測って変わったものを除く。
    a = pg.evaluate(STATE); pg.wait_for_timeout(800); c = pg.evaluate(STATE)
    loops = [k for k in set(a["ops"]) | set(c["ops"]) if a["ops"].get(k) != c["ops"].get(k)]
    for k in loops: c["ops"].pop(k, None)
    c["loops"] = loops
    return c


def stops(b):
    # 再生の可逆性：↓ で最後まで、↑ で最初まで。同じ止まる所（スクロールの位置）で、字・絵の部品・視点が同じか。
    w = width(); ctx, pg = open_book(b, w, SIZES[w]); fwd, back = [], []
    for k in range(40):
        pg.keyboard.press("ArrowDown"); pg.evaluate(SETTLE); pg.wait_for_timeout(2500); st = settled_state(pg)
        if fwd and st["top"] == fwd[-1]["top"]: break
        fwd.append(st); pg.screenshot(path=f"{OUT}/stops-{w}-f{k:02d}.png")
    for k in range(len(fwd) + 1):
        pg.keyboard.press("ArrowUp"); pg.evaluate(SETTLE); pg.wait_for_timeout(2500); st = settled_state(pg)
        if back and st["top"] == back[-1]["top"]: break
        back.append(st); pg.screenshot(path=f"{OUT}/stops-{w}-b{k:02d}.png")
    ctx.close(); json.dump({"fwd": fwd, "back": back}, open(f"{OUT}/stops-{w}.json", "w"), ensure_ascii=False, indent=0)
    F = {s["top"]: s for s in fwd}; B = {s["top"]: s for s in back}; common = [t for t in F if t in B]; bad = 0
    for t in common:
        a, c = F[t], B[t]
        seen = (a["world"] or 0) > 0.05 or (c["world"] or 0) > 0.05  # 場面が画面に入っていない所（本の表紙など）は、絵の部品を比べない
        diff = [k for k in ("caps", "frame") if a[k] != c[k]] + ([k for k in ("cams",) if a[k] != c[k]] if seen else []) + [k for k in (set(a["ops"]) | set(c["ops"])) - set(a["loops"]) - set(c["loops"]) if seen and abs((a["ops"].get(k) or 0) - (c["ops"].get(k) or 0)) > 0.1]
        if diff: bad += 1; print("違う", t, diff, "| 行き", a["caps"], "| 帰り", c["caps"])
    print(f"止まる所 {len(common)} か所を行きと帰りで比べた。違う所 {bad} か所。")
    return bad == 0 and len(common) > 0


def env(b):
    ok = True
    # 動きを減らす設定：横書きなので "/" を強制の改行にしない（.ms-soft.on が無いこと）。止まった絵には代替テキスト。
    ctx, pg = open_book(b, 390, 844, "reduce")
    r = pg.evaluate("() => ({ on: document.querySelectorAll('.ms-cap .ms-soft.on').length, all: document.querySelectorAll('.ms-cap .ms-soft').length, noAlt: [...document.querySelectorAll('.ms-still')].filter(i => !i.alt).length })")
    pg.screenshot(path=f"{OUT}/env-reduce.png", full_page=True); ctx.close()
    print("動きを減らす設定：強制の改行", r["on"], "/", r["all"], "、代替テキストの無い止まった絵", r["noAlt"])
    ok &= r["on"] == 0 and r["noAlt"] == 0
    # 小さな画面と横向き：止まる所ごとに、見えている字が画面の外へ出ていないか。
    for w, h in ((320, 568), (667, 375), (844, 390)):
        ctx, pg = open_book(b, w, h); out = []; prev = None
        for k in range(40):
            pg.keyboard.press("ArrowDown"); top = pg.evaluate(SETTLE); pg.wait_for_timeout(1500)
            if top == prev: break
            prev = top
            o = pg.evaluate("""() => [...document.querySelectorAll('.ms-cap[data-i] .ms-ch')].filter(e => +getComputedStyle(e).opacity > 0.5 && +getComputedStyle(e.closest('.ms-cap')).opacity > 0.5)
              .map(e => [e.closest('.ms-cap').dataset.i, e.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight)).map(([i]) => +i + 1)""")
            if o: out.append(sorted(set(o))); pg.screenshot(path=f"{OUT}/env-{w}x{h}-{k:02d}.png")
        ctx.close(); print(f"{w}×{h}：画面の外へ出た字のあるページ", out or "なし"); ok &= not out
    return ok


def timeline(b):
    # 時間軸：自動で読み、ページごとに字が出はじめ・消えきる時刻と、指定した絵の部品の不透明度が 0.05・0.5・0.95 を越える時刻（秒）。
    ctx, pg = open_book(b, 390, 844)
    pg.evaluate("""(sel) => { window.__q = []; const t0 = performance.now();
      const f = () => { const caps = [...document.querySelectorAll('.ms-cap[data-i]')].map(c => +getComputedStyle(c).opacity > 0.05 ? Math.max(0, ...[...c.querySelectorAll('.ms-ch')].map(e => +getComputedStyle(e).opacity)) : 0);
        window.__q.push([Math.round(performance.now() - t0), caps, sel.map(q => { const e = document.querySelector(q); return e ? +getComputedStyle(e).opacity : -1 })]); requestAnimationFrame(f) }; requestAnimationFrame(f) }""", ARGS)
    pg.locator(".ms-auto button").click(); t0 = time.time()
    while time.time() - t0 < 480:
        if time.time() - t0 > 5 and pg.locator(".ms-auto button").get_attribute("aria-pressed") == "false": break
        pg.wait_for_timeout(1000)
    pg.wait_for_timeout(1500); L = pg.evaluate("() => window.__q"); ctx.close()
    json.dump({"selectors": ARGS, "frames": L}, open(f"{OUT}/timeline.json", "w"))
    s = lambda v: None if v is None else round(v / 1000, 2)
    for i in range(len(L[0][1])):
        tin = next((r[0] for r in L if r[1][i] > 0.5), None)
        tlast = max((r[0] for r in L if r[1][i] > 0.5), default=None)  # 節のあるページは、最後の節が消えきる時刻
        tout = next((r[0] for r in L if tlast is not None and r[0] > tlast and r[1][i] < 0.02), None)
        print(f"{i + 1}P 字が出はじめる {s(tin)} 秒・最後の字が消えきる {s(tout)} 秒")
    for j, q in enumerate(ARGS):
        marks = []
        for th in (0.05, 0.5, 0.95):
            t = next((r[0] for r in L if r[2][j] >= th), None); marks.append(f"{th}:{s(t)}")
        print(q, "不透明度が越える時刻（秒）", " ".join(marks))
    return True


with sync_playwright() as p:
    b = p.chromium.launch()
    ok = {"layout": layout, "stops": stops, "env": env, "timeline": timeline}[MODE](b)
    b.close()
if errors: print("ページのエラー", errors[:5])
sys.exit(0 if ok and not errors else 1)
