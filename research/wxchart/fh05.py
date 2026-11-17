# FH-05 (#250 P2-B): the 05時 府県天気予報 of 高知 and JMA's forecast JSON beside it, to read
# shiromatz's columns (a flattening of that JSON) the way the telegrams are read. Log only.
import re, json, gzip, base64, urllib.request
UA = {"User-Agent": "weather-note research (#250)"}
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as r:
        return r.read()
feed = get("https://www.data.jma.go.jp/developer/xml/feed/regular_l.xml").decode()
urls = re.findall(r'href="([^"]+_VPFD51_390000\.xml)"', feed)
for u in sorted(urls, reverse=True):
    x = get(u)
    rep = re.search(rb"<ReportDateTime>([^<]+)<", x).group(1).decode()
    if "T05:00" in rep:
        print("== XML", rep, u)
        print("B64GZ " + base64.b64encode(gzip.compress(x, 9)).decode())
        break
j = get("https://www.jma.go.jp/bosai/forecast/data/forecast/390000.json")
print("== JSON")
print("B64GZ " + base64.b64encode(gzip.compress(j, 9)).decode())
