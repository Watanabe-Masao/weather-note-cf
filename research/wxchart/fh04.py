# FH-04 (#250 P2): real forecast telegrams for the parser, JMA's issue delays for the watch (R5-3),
# and one month of shiromatz for the trial import (R2-11). Prints to the log; nothing is kept.
import io, re, sys, gzip, base64, zipfile, csv, urllib.request, collections, datetime as dt

UA = {"User-Agent": "weather-note research (#250)"}
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as r:
        return r.read()

feed = get("https://www.data.jma.go.jp/developer/xml/feed/regular_l.xml").decode()
entries = re.findall(r"<entry>(.*?)</entry>", feed, re.S)
rows = []
for e in entries:
    url = re.search(r'<link[^>]*href="([^"]+)"', e).group(1)
    upd = re.search(r"<updated>([^<]+)</updated>", e).group(1)
    title = re.search(r"<title>([^<]*)</title>", e).group(1)
    m = re.search(r"_(VP[A-Z]{2}\d\d)_(\d{6})\.xml$", url)
    if m and m.group(1) in ("VPFD51", "VPFW50", "VPFG50"):
        rows.append((m.group(1), m.group(2), upd, url, title))
print("== FEED", len(entries), "entries;", len(rows), "forecast telegrams")

def dump(tag, url):
    x = get(url)
    print(f"== XML {tag} {url} bytes={len(x)}")
    print("B64GZ " + base64.b64encode(gzip.compress(x, 9)).decode())
    print(f"== END {tag}")
    return x.decode()

# 1. samples: Kochi VPFD51 at three issue hours, VPFW50, VPFG50; one multi-area office (東京), 札幌, 沖縄本島; any 訂正.
k = sorted([r for r in rows if r[1] == "390000"], key=lambda r: r[2], reverse=True)
seen = collections.Counter()
for kind, office, upd, url, title in k:
    want = {"VPFD51": 3, "VPFW50": 1, "VPFG50": 1}[kind]
    if seen[kind] < want:
        seen[kind] += 1
        dump(f"{kind}-390000-{seen[kind]}", url)
for office in ("130000", "016000", "471000"):
    for kind in ("VPFD51", "VPFW50"):
        r = max((r for r in rows if r[0] == kind and r[1] == office), key=lambda r: r[2], default=None)
        if r: dump(f"{kind}-{office}", r[3])
fix = [r for r in rows if "訂正" in r[4]]
print("== CORRECTIONS in feed:", len(fix))
for r in fix[:2]:
    dump(f"FIX-{r[0]}-{r[1]}", r[3])

# 2. delays: for Kochi, ReportDateTime vs the feed's updated, and the issue hours over 7 days.
print("== DELAYS kind reportDateTime updated delay_min")
for kind, office, upd, url, title in sorted(k, key=lambda r: r[2]):
    x = get(url).decode()
    rep = re.search(r"<ReportDateTime>([^<]+)</ReportDateTime>", x).group(1)
    info = re.search(r"<InfoType>([^<]+)</InfoType>", x).group(1)
    d = (dt.datetime.fromisoformat(upd.replace("Z", "+00:00")) - dt.datetime.fromisoformat(rep)).total_seconds() / 60
    print("DELAY", kind, rep, upd, round(d, 1), info)

# 3. shiromatz: one month of Kochi (2025-01) and the newest month.
base = "https://github.com/shiromatz/Japan-Meteorological-Agency-Weather-Forecast/raw/main/forecast/"
for month in ("202501", "202610"):
    try:
        z = zipfile.ZipFile(io.BytesIO(get(f"{base}forecast_{month}.zip")))
    except Exception as ex:
        print("== SHIRO", month, "ERROR", ex); continue
    names = z.namelist()
    name = next((n for n in names if n.endswith("_390000.csv")), None)
    print("== SHIRO", month, "files", len(names), "kochi", name)
    if not name: continue
    raw = z.read(name)
    print("SHIRO_B64GZ " + base64.b64encode(gzip.compress(raw, 9)).decode())
    rd = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    print("columns", list(rd[0].keys()) if rd else None, "rows", len(rd))
    times = sorted({r.get("reportDatetime") for r in rd})
    print("issues", len(times))
    days = collections.Counter(t[:10] for t in times)
    print("per day", sorted(collections.Counter(days.values()).items()))
    print("hours", sorted(collections.Counter(t[11:16] for t in times).items()))
    print("first", times[:3], "last", times[-3:])
