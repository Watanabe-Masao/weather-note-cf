# 見本（予報の履歴 R6）の「実績」用：高知（47893）の 2026-10-01〜11-17 の日ごと・時間ごとの観測を、
# 気象庁「過去の気象データ」から読む。GitHub Actions でだけ動かす（作業環境から気象庁に届かないため）。
# 出典：気象庁ホームページ（過去の気象データ）。
import base64, gzip, json, re, sys, time, urllib.request
from datetime import date, timedelta
from bs4 import BeautifulSoup

BASE = "https://www.data.jma.go.jp/stats/etrn/view/"
Q = "prec_no=74&block_no=47893"

def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "weather-note research"}), timeout=30) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            print("retry", url, e, file=sys.stderr); time.sleep(3)
    raise SystemExit("fail " + url)

def num(s):
    s = re.sub(r"[\)\]\s#×]", "", s or "")
    if s in ("--",): return 0.0
    try: return float(s)
    except ValueError: return None

def rows(html, table_id):
    soup = BeautifulSoup(html, "lxml")
    t = soup.find("table", id=table_id)
    return [tr for tr in t.find_all("tr") if tr.find("td")]

out = {"source": "気象庁 過去の気象データ（高知 47893）", "days": {}}
for y, m in ((2026, 10), (2026, 11)):
    html = get(f"{BASE}daily_s1.php?{Q}&year={y}&month={m}&day=&view=")
    for tr in rows(html, "tablefix1"):
        td = [c.get_text(strip=True) for c in tr.find_all("td")]
        try: d = int(td[0])
        except ValueError: continue
        key = f"{y}-{m:02d}-{d:02d}"
        if key > "2026-11-17": continue
        out["days"][key] = {"precip": num(td[3]), "max": num(td[7]), "min": num(td[8]), "wxDay": td[-2] or None, "wxNight": td[-1] or None, "hours": []}
    time.sleep(1)

d = date(2026, 10, 1)
while d <= date(2026, 11, 17):
    key = d.isoformat()
    html = get(f"{BASE}hourly_s1.php?{Q}&year={d.year}&month={d.month}&day={d.day}&view=")
    for tr in rows(html, "tablefix1"):
        tds = tr.find_all("td")
        h = num(tds[0].get_text(strip=True))
        if h is None: continue
        img = tr.find("img")
        out["days"].setdefault(key, {"hours": []})["hours"].append({
            "h": int(h), "precip": num(tds[3].get_text(strip=True)), "temp": num(tds[4].get_text(strip=True)),
            "wx": img.get("alt") if img else None,
        })
    d += timedelta(days=1); time.sleep(1)

b = base64.b64encode(gzip.compress(json.dumps(out, ensure_ascii=False).encode())).decode()
print("ACTUALS_B64_BEGIN"); print(b); print("ACTUALS_B64_END")
print("days", len(out["days"]), "sample", json.dumps(out["days"].get("2026-10-25"), ensure_ascii=False)[:600])
