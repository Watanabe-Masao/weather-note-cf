"""比較ページ（webgl/）を Chromium で開き、WebGL 2 の値と OpenGL 参照の差・時間を出し、画面を撮る。
python3 research/sky-beta2/tools/check_web.py research/sky-beta2/webgl <出力フォルダ>
（Chromium の WebGL 2 は画面なしではソフトウェア描画（SwiftShader）。iPhone の値はページの上の欄で読む。）"""
import functools, http.server, json, os, sys, threading
from playwright.sync_api import sync_playwright

root, out = sys.argv[1], sys.argv[2]
query = sys.argv[3] if len(sys.argv) > 3 else ""  # 例：?steps=192
widths = [(390, "phone")] if query else [(1200, "wide"), (390, "phone")]
os.makedirs(out, exist_ok=True)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
# index.html は本文だけ（artifact の形）なので、頭を足して開く
body = open(os.path.join(root, "index.html"), encoding="utf-8").read()
with open(os.path.join(root, "_local.html"), "w", encoding="utf-8") as f:
    f.write('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + body)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"])
    for w, name in widths:
        pg = b.new_page(viewport={"width": w, "height": 900}, device_scale_factor=2 if name == "phone" else 1)
        msgs = []
        pg.on("console", lambda m: msgs.append(m.text))
        pg.goto(f"http://127.0.0.1:{srv.server_port}/_local.html{query}")
        pg.wait_for_function("window.__b2 || (document.querySelector('#status')||{}).textContent.startsWith('止まりました')", timeout=180000)
        status = pg.inner_text("#status")
        info = pg.evaluate("window.__b2 && window.__b2.info")
        print(name, status, json.dumps(info, ensure_ascii=False))
        if msgs: print("console:", msgs[:5])
        pg.screenshot(path=os.path.join(out, f"compare-{name}.png"), full_page=True)
        if info: json.dump(pg.evaluate("window.__b2"), open(os.path.join(out, f"web-{name}{query.replace('?', '-').replace('=', '')}.json"), "w"))
    b.close()
os.remove(os.path.join(root, "_local.html"))
srv.shutdown()
