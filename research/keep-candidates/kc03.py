# KC-03 (#283): where the 天気分布予報 is read from — a browser (Playwright) opens the time-series page for
# 高知 and every request it makes to jma.go.jp is logged: the URL, status, size and last-modified. Nothing
# from the responses is saved. Run once by a push to research/keep-candidates. 出典：気象庁ホームページ。
import re
import time
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright

PAGES = [
    "https://www.jma.go.jp/bosai/wdist/timeseries.html#area_type=class20s&area_code=3920100",
    "https://www.jma.go.jp/bosai/wdist/timeseries.html#area_type=offices&area_code=390000",
]
STATIC = re.compile(r"\.(js|css|woff2?|ttf|ico|svg|gif)(\?|$)|/common/img/|/images/")

print("# KC-03", datetime.now(timezone.utc).isoformat())
with sync_playwright() as p:
    b = p.chromium.launch()
    for url in PAGES:
        page = b.new_page(user_agent="weather-note research (github.com/Watanabe-Masao/weather-note-cf)")
        seen = []

        def on_response(r, seen=seen):
            u = r.url
            if "jma.go.jp" not in u or STATIC.search(u):
                return
            try:
                size = len(r.body())
            except Exception as e:  # noqa: BLE001
                size = f"? ({e.__class__.__name__})"
            h = r.headers
            seen.append((u, r.status, h.get("content-type", ""), size, h.get("last-modified", ""), h.get("cache-control", "")))

        page.on("response", on_response)
        page.goto(url, wait_until="networkidle", timeout=60000)
        time.sleep(5)
        print(f"\n## {url}")
        print(f"title: {page.title()}; final url: {page.url}")
        try:
            print(f"text: {page.locator('body').inner_text(timeout=3000)[:300]!r}")
        except Exception:  # noqa: BLE001
            print("text: (none)")
        tiles = [s for s in seen if re.search(r"/jmatile/data/.*\.png", s[0])]
        others = [s for s in seen if s not in tiles]
        for u, st, ct, size, lm, cc in others:
            print(f"- {st} {ct} {size} bytes lm={lm} cc={cc} {u}")
        if tiles:
            sizes = [t[3] for t in tiles if isinstance(t[3], int)]
            print(f"tiles: {len(tiles)}, bytes {min(sizes) if sizes else '-'}-{max(sizes) if sizes else '-'}, e.g.")
            for t in tiles[:5]:
                print(f"  - {t[1]} {t[3]} bytes lm={t[4]} {t[0]}")
        page.close()
    b.close()
print("# end")
