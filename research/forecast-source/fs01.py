"""FS-01：気象庁の予報の出どころの調べ直し（GitHub Actions で1回動かす）。

結果はログに出すだけ（ファイルは作らない・コミットしない）。
各ホストは robots.txt を先に読み、禁止されていれば読まない。
"""
import csv, gzip, io, json, os, re, statistics, sys, time, zipfile
import urllib.request, urllib.robotparser, urllib.error
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
import xml.etree.ElementTree as ET

UA = "weather-note-cf research (GitHub Actions)"
ROBOTS = {}


# robots.txt が禁止でも、渡辺さんの OK で読むホスト（FS-02 の6、2026-11-23：Previous Runs だけ、
# 高知の最高・最低・1〜7日前に限って Actions で1回）。ほかの Open-Meteo の API は読まない。
PERMITTED = {"previous-runs-api.open-meteo.com"}


def allowed(url):
    host = url.split("/")[2]
    if host in PERMITTED:
        print(f"[robots] {host}: 禁止だが渡辺さんの OK（2026-11-23）で読む")
        return True
    if host not in ROBOTS:
        rp = urllib.robotparser.RobotFileParser()
        try:
            req = urllib.request.Request(f"https://{host}/robots.txt", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read().decode("utf8", "replace")
            rp.parse(body.splitlines())
            print(f"[robots] {host}: 200 {len(body)}B", " | ".join(l for l in body.splitlines() if l.strip())[:300])
        except urllib.error.HTTPError as e:
            rp.parse([])  # 置かれていない＝禁止なし
            print(f"[robots] {host}: {e.code}")
        except Exception as e:
            rp = None
            print(f"[robots] {host}: 読めない {type(e).__name__}")
        ROBOTS[host] = rp
    rp = ROBOTS[host]
    return rp is not None and rp.can_fetch(UA, url)


def get(url, binary=False):
    if not allowed(url):
        print("[skip robots]", url)
        return None
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            b = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                b = gzip.decompress(b)
            meta = {"status": r.status, "lm": r.headers.get("Last-Modified"), "cc": r.headers.get("Cache-Control"), "size": len(b)}
    except urllib.error.HTTPError as e:
        print(f"[http {e.code}]", url)
        return None
    time.sleep(0.5)
    return (b if binary else b.decode("utf8", "replace")), meta


def tag(e):
    return e.tag.split("}")[-1]


# ---------------------------------------------------------------- 1. 電文
def feed_entries(name):
    res = get(f"https://www.data.jma.go.jp/developer/xml/feed/{name}.xml")
    if not res:
        return []
    root = ET.fromstring(res[0])
    out = []
    for en in root:
        if tag(en) != "entry":
            continue
        d = {tag(c): (c.text or c.get("href") or "") for c in en}
        link = [c.get("href") for c in en if tag(c) == "link"]
        d["link"] = link[0] if link else ""
        out.append(d)
    return out


def summarize_telegram(xml):
    root = ET.fromstring(xml)
    head = {tag(e): (e.text or "") for e in root.iter() if tag(e) in ("Title", "ReportDateTime", "InfoType", "TargetDateTime", "TargetDuration")}
    print("   head:", head)
    for mis in root.iter():
        if tag(mis) != "MeteorologicalInfos":
            continue
        for tsi in mis:
            if tag(tsi) == "TimeSeriesInfo":
                tds = [t for t in tsi.iter() if tag(t) == "TimeDefine"]
                times = [(t.find("./*").text or "")[5:16] for t in tds]
                durs = sorted({(c.text or "") for t in tds for c in t if tag(c) == "Duration"})
                for it in [i for i in tsi if tag(i) == "Item"]:
                    names = [e.text for e in it.iter() if tag(e) == "Name"][:1]
                    kinds = sorted({e.text for e in it.iter() if tag(e) == "Type"})
                    print(f"   [{mis.get('type')}] {names} {len(tds)}本 {times[0]}〜{times[-1]} 長さ{durs} 項目{kinds}")
            elif tag(tsi) == "MeteorologicalInfo":
                kinds = sorted({e.text for e in tsi.iter() if tag(e) == "Type"})
                names = sorted({e.text for e in tsi.iter() if tag(e) == "Name"})[:5]
                dt = tsi.find("./*").text if tsi.find("./*") is not None else ""
                print(f"   [{mis.get('type')}] 1本 {dt} {names} 項目{kinds}")


def part_telegrams():
    print("\n===== 1. 電文（高知 390000 と全国）")
    kinds = defaultdict(list)
    for feed in ("regular_l", "extra_l", "other_l"):
        es = feed_entries(feed)
        times = sorted(e.get("updated", "") for e in es)
        print(f"[feed] {feed}: {len(es)}件 {times[0] if times else ''} 〜 {times[-1] if times else ''}")
        for e in es:
            m = re.search(r"_(V[A-Z]{3}\d\d)_(\d{6})\.xml$", e["link"])
            if not m:
                continue
            code, office = m.groups()
            if office == "390000" or code in ("VPCK70", "VPZK70", "VPFT50", "VZSA50", "VPZW50"):
                kinds[(code, office)].append((e.get("updated", ""), e.get("title", ""), e["link"], feed))
    for (code, office), lst in sorted(kinds.items()):
        lst = sorted(set(lst))
        # 発表の時刻（JST、分まで）
        hours = Counter()
        for u, *_ in lst:
            t = datetime.fromisoformat(u.replace("Z", "+00:00")) + timedelta(hours=9)
            hours[t.strftime("%H:%M")[:4] + "x"] += 1
        print(f"[種類] {code} {office} {lst[0][1]}: {len(lst)}件 {lst[0][0]}〜{lst[-1][0]} 時刻(JST,10分単位) {dict(sorted(hours.items()))}")
    # 予報の電文の中身（最新の 05/11/17 時台を1つずつ）
    for code in ("VPFD51", "VPFW50", "VPFG50", "VPFT50"):
        lst = sorted(set(kinds.get((code, "390000"), [])))
        seen = set()
        for u, title, link, _ in reversed(lst):
            t = datetime.fromisoformat(u.replace("Z", "+00:00")) + timedelta(hours=9)
            if t.hour in seen:
                continue
            seen.add(t.hour)
            res = get(link)
            if not res:
                continue
            print(f"[電文] {code} {t:%m-%d %H:%M} {res[1]['size']}B")
            summarize_telegram(res[0])
    # ２週間気温予報（全国1通）から高知 74182
    lst = sorted(set(kinds.get(("VPCK70", "010000"), [])))
    if lst:
        res = get(lst[-1][2])
        if res:
            print(f"[電文] VPCK70 {lst[-1][0]} {res[1]['size']}B")
            root = ET.fromstring(res[0])
            for mis in root.iter():
                if tag(mis) != "MeteorologicalInfos":
                    continue
                for tsi in mis:
                    for it in [i for i in tsi.iter() if tag(i) == "Item"]:
                        codes = [e.text for e in it.iter() if tag(e) == "Code"]
                        if "74182" not in codes and "010800" not in codes:
                            continue
                        tds = [t for t in tsi.iter() if tag(t) == "TimeDefine"]
                        tt = [((t.find("./*").text or "")[5:10], [c.text for c in t if tag(c) == "Duration"]) for t in tds]
                        vals = [(e.get("type"), e.text) for e in it.iter() if e.text and e.text.strip() and tag(e) not in ("Name", "Code", "Type")][:24]
                        kinds_ = sorted({e.text for e in it.iter() if tag(e) == "Type"})
                        print(f"   [{mis.get('type')}] {codes[:2]} 時刻{tt} 項目{kinds_}")
                        print("     値:", vals)


# ---------------------------------------------------------------- 1b. ホームページの JSON
def part_bosai():
    print("\n===== 1b. ホームページの JSON")
    for u in (
        "https://www.jma.go.jp/bosai/forecast/data/forecast/390000.json",
        "https://www.jma.go.jp/bosai/forecast/data/overview_forecast/390000.json",
        "https://www.jma.go.jp/bosai/forecast/data/overview_week/390000.json",
        "https://www.jma.go.jp/bosai/jmatile/data/wdist/VPFD/390010.json",
    ):
        res = get(u)
        if not res:
            continue
        print(f"[json] {u.split('/data/')[1]} {res[1]}")
        d = json.loads(res[0])
        blocks = d if isinstance(d, list) else [d]
        for b in blocks:
            if not isinstance(b, dict):
                continue
            print("   keys:", list(b.keys()), b.get("reportDatetime"))
            for ts in b.get("timeSeries", []) or []:
                td = ts.get("timeDefines", [])
                areas = ts.get("areas", [])
                areas = areas if isinstance(areas, list) else [areas]
                for a in areas[:2]:
                    ks = {k: (v[:12] if isinstance(v, list) else v) for k, v in a.items() if k != "area"}
                    print(f"   {len(td)}本 {td[:1]}〜{td[-1:]} {a.get('area')} {ks}")
            for k, v in b.items():
                if k not in ("timeSeries", "publishingOffice", "reportDatetime"):
                    print(f"   {k}: {str(v)[:400]}")


# ---------------------------------------------------------------- 2. ページが読む先（Playwright）
def part_pages():
    print("\n===== 2. ページが読みに行く先（気象庁のホストだけ記録）")
    from playwright.sync_api import sync_playwright
    pages = [
        "https://www.jma.go.jp/bosai/wdist/#area_type=offices&area_code=390000",
        "https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=390000",
        "https://www.data.jma.go.jp/cpd/twoweek/?fuk=74",
    ]
    with sync_playwright() as p:
        br = p.chromium.launch()
        for url in pages:
            if not allowed(url):
                print("[skip robots]", url)
                continue
            ctx = br.new_context(user_agent=UA)
            pg = ctx.new_page()
            seen = []

            def on_resp(r, seen=seen):
                host = r.url.split("/")[2]
                if host.endswith("jma.go.jp"):
                    try:
                        n = len(r.body())
                    except Exception:
                        n = -1
                    seen.append((r.status, n, r.headers.get("last-modified", ""), r.url))

            pg.on("response", on_resp)
            try:
                pg.goto(url, wait_until="networkidle", timeout=60000)
                pg.wait_for_timeout(4000)
            except Exception as e:
                print("  開けない", type(e).__name__)
            print(f"[page] {url} 読んだ数 {len(seen)} 題 {pg.title()!r}")
            # タイルは型にまとめる
            pat = Counter()
            for st, n, lm, u in seen:
                if re.search(r"\.(js|css|png|svg|woff2?|ico|gif)(\?|$)", u) and "/data/" not in u:
                    continue
                key = re.sub(r"/\d+/\d+/\d+\.png", "/{z}/{x}/{y}.png", u)
                key = re.sub(r"\d{14}", "{日時}", key)
                pat[key] += 1
                if pat[key] <= 2:
                    print(f"   {st} {n}B lm={lm} {u}")
            for k, c in pat.items():
                if c > 2:
                    print(f"   …ほか同じ型 {c}件 {k}")
            if "wdist" in url:
                try:
                    txt = pg.inner_text("body")[:600].replace("\n", " ")
                    print("   画面の文字:", txt)
                except Exception:
                    pass
            ctx.close()
        br.close()


# ---------------------------------------------------------------- 2b. 天気分布予報・２週間・地点・robots
def part_more():
    print("\n===== 2b. 天気分布予報の中身、２週間気温予報の JSON、予報の地点、robots")
    for host in ("api.open-meteo.com", "ensemble-api.open-meteo.com", "historical-forecast-api.open-meteo.com",
                 "archive-api.open-meteo.com", "air-quality-api.open-meteo.com", "open-meteo.com"):
        allowed(f"https://{host}/v1/x")
    res = get("https://www.jma.go.jp/bosai/wdist/table/wdist.properties__c64b4660a3de3dcd4ac7.xml")
    if res:
        x = res[0]
        print("[wdist 設定] ", re.sub(r"\s+", " ", x)[:2500])
    tt = get("https://www.jma.go.jp/bosai/jmatile/data/wdist/targetTimes.json")
    if tt:
        d = json.loads(tt[0])
        print(f"[wdist targetTimes] {len(d)}件", d[:3], "…", d[-2:])
        els = sorted({e for t in d for e in t.get("elements", [])})
        print("   要素:", els)
        base = d[0]["basetime"]
        times = [t["validtime"] for t in d]
        print("   予報の時刻:", times[:1], "〜", times[-1:], len(times))
        # 高知（74182、33.5667,133.5483 付近）にいちばん近い格子の値（geojson がある要素だけ）
        for el in els:
            for vt in (times[0], times[-1]):
                u = f"https://www.jma.go.jp/bosai/jmatile/data/wdist/{base}/none/{vt}/surf/{el}/data.geojson?id={el}"
                r = get(u)
                if not r:
                    continue
                g = json.loads(r[0])
                feats = g.get("features", [])
                best = None
                for f in feats:
                    geo = f.get("geometry") or {}
                    c = geo.get("coordinates")
                    if geo.get("type") == "Point" and c:
                        dd = (c[0] - 133.548) ** 2 + (c[1] - 33.567) ** 2
                        if best is None or dd < best[0]:
                            best = (dd, c, f.get("properties"))
                print(f"   [{el} {vt}] {r[1]['size']}B 地物{len(feats)} 型{Counter((f.get('geometry') or {}).get('type') for f in feats)} 高知に最も近い {best[1:] if best else None}")
                if feats and not best:
                    print("     例:", str(feats[0])[:300])
    # ２週間気温予報（ホームページの JSON）
    for u in ("https://www.data.jma.go.jp/cpd/twoweek/data/Latest/data_47893.json",
              "https://www.data.jma.go.jp/cpd/twoweek/data/Latest/data_29.json"):
        r = get(u)
        if r:
            print(f"[２週間 JSON] {u.rsplit('/',1)[1]} {r[1]}")
            print("   ", re.sub(r"\s+", " ", r[0])[:1800])
    # 予報の地点（アメダスの表）
    r = get("https://www.jma.go.jp/bosai/amedas/const/amedastable.json")
    if r:
        t = json.loads(r[0])
        for code in ("74182", "74372", "74516"):
            a = t.get(code)
            print(f"[アメダス] {code} {a.get('kjName')} 緯度{a.get('lat')} 経度{a.get('lon')} 高さ{a.get('alt')}m 種類{a.get('type')} 要素{a.get('elems')}")
    r = get("https://www.jma.go.jp/bosai/forecast/const/forecast_area.json")
    if r:
        print("[予報の地点の表] 390000:", json.loads(r[0]).get("390000"))
    r = get("https://www.jma.go.jp/bosai/forecast/const/week_area.json")
    if r:
        print("[週間の地点の表] 390000:", json.loads(r[0]).get("390000"))
    # 地域時系列予報の JSON と電文（VPFD51）の3時間ごとの気温を並べる
    r = get("https://www.jma.go.jp/bosai/jmatile/data/wdist/VPFD/390010.json")
    if r:
        d = json.loads(r[0])
        p = d["pointTimeSeries"]
        print("[地域時系列 390010]", d.get("reportDateTime"), "気温", p.get("temperature"), "最高", p.get("maxTemperature"), "最低", p.get("minTemperature"))
        a = d["areaTimeSeries"]
        print("   区域の項目", list(a.keys()), "天気", a.get("weather"), "風", str(a.get("wind"))[:300])
    es = [e for e in feed_entries("regular") if e["link"].endswith("_VPFD51_390000.xml")]
    if es:
        e = max(es, key=lambda e: e.get("updated", ""))
        r = get(e["link"])
        if r:
            root = ET.fromstring(r[0])
            rt = [x.text for x in root.iter() if tag(x) == "ReportDateTime"][0]
            for tsi in root.iter():
                if tag(tsi) != "TimeSeriesInfo":
                    continue
                for it in [i for i in tsi if tag(i) == "Item"]:
                    nm = [x.text for x in it.iter() if tag(x) == "Name"][:1]
                    ty = [x.text for x in it.iter() if tag(x) == "Type"][:1]
                    if nm == ["高知"] and ty == ["３時間毎気温"]:
                        print("[電文 VPFD51]", rt, "高知 ３時間毎気温", [x.text for x in it.iter() if tag(x) == "Temperature"])
                    if nm == ["中部"] and ty and ty[0].startswith("３時間"):
                        print("[電文 VPFD51] 中部", sorted({x.get("type") for x in it.iter() if x.get("type")}), [x.text for x in it.iter() if tag(x) == "WindSpeedLevel"][:12])


def inside(pt, ring):
    x, y = pt
    c = False
    for i in range(len(ring)):
        x1, y1 = ring[i][:2]
        x2, y2 = ring[i - 1][:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
            c = not c
    return c


def polys(geo):
    t, c = geo.get("type"), geo.get("coordinates") or []
    if t == "Polygon":
        return [c]
    if t == "MultiPolygon":
        return c
    return []


def part_wdist():
    print("\n===== 2c. 天気分布予報（5km）の値を、高知・室戸岬・清水の場所で読む")
    pts = {"高知": (133.5483, 33.5667), "室戸岬": (134.1767, 33.2517), "清水": (133.01, 32.7217)}
    tt = get("https://www.jma.go.jp/bosai/jmatile/data/wdist/targetTimes.json")
    if not tt:
        return
    d = sorted(json.loads(tt[0]), key=lambda t: t["validtime"])
    base = d[0]["basetime"]
    print("[wdist] basetime", base, "時刻", [t["validtime"][6:10] for t in d])
    rows = defaultdict(dict)
    for t in d:
        vt = t["validtime"]
        for el in t["elements"]:
            if el.endswith("_nd"):
                continue
            if el in ("temp", "max_temp", "min_temp"):
                continue  # 色分けの面（_point に数値がある）
            if el in ("r3", "s3") and vt not in (d[1]["validtime"], d[len(d) // 2]["validtime"]):
                continue  # 面は2つの時刻だけ
            r = get(f"https://www.jma.go.jp/bosai/jmatile/data/wdist/{base}/none/{vt}/surf/{el}/data.geojson?id={el}")
            if not r:
                continue
            feats = json.loads(r[0]).get("features", [])
            for name, (lon, lat) in pts.items():
                if el.endswith("_point"):
                    best = min(((f["geometry"]["coordinates"][0] - lon) ** 2 + (f["geometry"]["coordinates"][1] - lat) ** 2, f) for f in feats if (f.get("geometry") or {}).get("type") == "Point")
                    c = best[1]["geometry"]["coordinates"]
                    km = ((c[0] - lon) * 92.6) ** 2 + ((c[1] - lat) * 111) ** 2
                    rows[name][(vt, el)] = f"{best[1]['properties'].get('value')}({km**0.5:.1f}km)"
                else:
                    hit = [f["properties"] for f in feats for poly in polys(f.get("geometry") or {}) if poly and inside((lon, lat), poly[0]) and not any(inside((lon, lat), h) for h in poly[1:])]
                    rows[name][(vt, el)] = str(hit[-1]) if hit else "（どの面にも入らない＝なし）"
            print(f"   {el} {vt[6:10]} {r[1]['size']}B")
    for name, v in rows.items():
        print(f"[wdist {name}]")
        for (vt, el), x in sorted(v.items()):
            print(f"   {vt[6:8]}日{vt[8:10]}時 {el}: {x}")
    r = get("https://www.data.jma.go.jp/cpd/twoweek/data/Latest/data_47893.json")
    if r:
        j = json.loads(r[0])
        for k, v in j.items():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                print(f"[２週間 JSON] {k}: {len(v)}件 項目{sorted(v[0].keys())} 最初{v[0]} 最後{v[-1]}")
                print("    要素ごと", Counter(x.get("elem") for x in v), "日付", sorted({f"{x.get('mm')}-{x.get('dd')}" for x in v})[:20])
            else:
                print(f"[２週間 JSON] {k}: {v}")


# ---------------------------------------------------------------- 6. 当たり具合
def etrn_month(y, m):
    u = f"https://www.data.jma.go.jp/obd/stats/etrn/view/daily_s1.php?prec_no=74&block_no=47893&year={y}&month={m}&day=&view="
    res = get(u)
    if not res:
        return {}
    html = res[0]
    out = {}
    for row in re.findall(r"<tr class=\"mtx\"[^>]*>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if not cells or not cells[0].isdigit():
            continue
        # daily_s1：0日 1-2気圧 3-5降水 6平均 7最高 8最低 …（最初の行を表示して確かめる）
        def num(s):
            s = re.sub(r"[)\]#×/ ]", "", s)
            try:
                return float(s)
            except ValueError:
                return None
        if not out and y == 2024 and m == 2:
            print('[etrn 1行目]', cells[:12])
        out[date(y, m, int(cells[0]))] = (num(cells[7]), num(cells[8]))
    return out


def stats(errs):
    if not errs:
        return "n=0"
    n = len(errs)
    me = sum(errs) / n
    mae = sum(abs(e) for e in errs) / n
    rmse = (sum(e * e for e in errs) / n) ** 0.5
    w2 = sum(1 for e in errs if abs(e) <= 2) / n
    return f"n={n} 平均{me:+.2f} MAE {mae:.2f} RMSE {rmse:.2f} ±2℃以内{w2*100:.0f}%"


def part_accuracy():
    print("\n===== 6. 当たり具合（高知 47893／予報 74182）")
    start, end = date(2024, 2, 1), date(2026, 10, 31)
    # 実際（アメダス、気象庁の過去の気象データ 日ごとの値）
    obs = {}
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        obs.update(etrn_month(y, m))
        m += 1
        if m > 12:
            y, m = y + 1, 1
    print(f"[実際] {len(obs)}日 例 {sorted(obs.items())[:2]}")

    # 気象庁（shiromatz の CSV、元は forecast/390000.json）
    jma = defaultdict(dict)  # (target, lead) -> {"max":, "min":, "rep":}
    hours_used = Counter()
    zdir = "shiromatz/forecast"
    per_rep = defaultdict(dict)  # report -> target -> {max,min}
    def find_csv(zbytes, name):
        with zipfile.ZipFile(io.BytesIO(zbytes)) as z:
            names = z.namelist()
            if name in names:
                return z.read(name)
            for n in names:
                if n.endswith(".zip"):
                    r = find_csv(z.read(n), name)
                    if r:
                        return r
        return None

    for fn in sorted(os.listdir(zdir)):
        ym = fn[9:15]
        if not (f"{start:%Y%m}" <= ym <= f"{end:%Y%m}"):
            continue
        raw = find_csv(open(os.path.join(zdir, fn), "rb").read(), f"forecast_{ym}_390000.csv")
        if raw is None:
            print("  なし", fn)
            continue
        for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
            if r["areaCode"] != "74182":
                continue
            rep = r["reportDatetime"]
            td = r["timeDefine"]
            tdate = td[:10]
            # 2024 年の CSV は列の名前が単数（tempMax など）
            tmax = r.get("tempsMax", r.get("tempMax"))
            tmin = r.get("tempsMin", r.get("tempMin"))
            temps = r.get("temps", r.get("temp"))
            if tmax:
                per_rep[rep].setdefault(tdate, {})["max"] = float(tmax)
            if tmin:
                per_rep[rep].setdefault(tdate, {})["min"] = float(tmin)
            if temps and tdate > rep[:10]:
                key = "min" if td[11:13] == "00" else ("max" if td[11:13] == "09" else None)
                if key:
                    per_rep[rep].setdefault(tdate, {}).setdefault(key, float(temps))
    # 予報した日（発表の日付）ごとに、値のある中でいちばん遅い発表を使う（臨時の発表には週間の値が無いため）
    for rep in sorted(per_rep):
        d = date.fromisoformat(rep[:10])
        for tdate, v in per_rep[rep].items():
            lead = (date.fromisoformat(tdate) - d).days
            if 1 <= lead <= 7:
                slot = jma.setdefault((date.fromisoformat(tdate), lead), {})
                for k, x in v.items():
                    slot[k] = x
                    slot["rep_" + k] = rep[11:13]
    for (t, lead), v in jma.items():
        hours_used[(lead, v.get("rep_max"), v.get("rep_min"))] += 1
    print(f"[気象庁] 発表 {len(per_rep)}本、（何日前, 最高の発表の時, 最低の発表の時）の数 {sorted(hours_used.items(), key=lambda x: (x[0][0], -x[1]))[:30]}")

    # Open-Meteo（Previous Runs API、既定のモデル、1時間ごと → 1時〜24時の最高・最低）
    om = {}
    vars_ = ["temperature_2m"] + [f"temperature_2m_previous_day{i}" for i in range(1, 8)]
    s = start - timedelta(days=1)
    while s <= end:
        e = min(date(s.year, 12, 31), end + timedelta(days=1))
        u = ("https://previous-runs-api.open-meteo.com/v1/forecast?latitude=33.5633&longitude=133.5517"
             f"&hourly={','.join(vars_)}&timezone=Asia%2FTokyo&start_date={s}&end_date={e}")
        res = get(u)
        if res:
            d = json.loads(res[0])
            h = d["hourly"]
            print(f"[Open-Meteo] {s}〜{e} {len(h['time'])}時間 {res[1]['size']}B 標高{d.get('elevation')}")
            for i, t in enumerate(h["time"]):
                dt = datetime.fromisoformat(t)
                day = (dt - timedelta(hours=1)).date()  # 1時〜24時を1日に
                for lead in range(1, 8):
                    v = h[f"temperature_2m_previous_day{lead}"][i]
                    if v is not None:
                        om.setdefault((day, lead), []).append(v)
        s = e + timedelta(days=1)
    omd = {k: {"max": max(v), "min": min(v)} for k, v in om.items() if len(v) == 24}
    print("[Open-Meteo] 24時間そろった日の数（何日前ごと）", {l: sum(1 for (d, x) in omd if x == l) for l in range(1, 8)},
          "最初の日", {l: min((d for (d, x) in omd if x == l), default=None) for l in range(1, 8)})

    def table(label, src, days=None):
        print(f"[比べ] {label}")
        for lead in range(1, 8):
            line = []
            for key, idx in (("max", 0), ("min", 1)):
                errs = []
                for (d, l), v in src.items():
                    if l != lead or key not in v or (days is not None and d not in days):
                        continue
                    o = obs.get(d)
                    if o and o[idx] is not None:
                        errs.append(v[key] - o[idx])
                line.append(f"{'最高' if key=='max' else '最低'} {stats(errs)}")
            print(f"   {lead}日前： " + " ／ ".join(line))

    table("気象庁（全部の日）", jma)
    if omd:
        table("Open-Meteo（全部の日）", omd)
    # 同じ日だけで比べる（両方そろった日）
    common = {d for (d, l) in jma if l == 7} & {d for (d, l) in omd if l == 7} & set(obs)
    common_all = set()
    if omd:
        for d in common:
            if all((d, l) in jma and (d, l) in omd for l in range(1, 8)):
                common_all.add(d)
    else:
        print("[比べ] Open-Meteo の値が無い（読まなかった）ので、気象庁だけで分ける")
        common_all = {d for (d, l) in jma if all((d, k) in jma and {"max", "min"} <= set(jma[(d, k)]) for k in range(1, 8))} & set(obs)
    print(f"[比べ] 1〜7日前の全部がそろった日 {len(common_all)}日")
    table("気象庁（そろった日）", jma, common_all)
    if omd:
        table("Open-Meteo（そろった日）", omd, common_all)
    for name, months in (("寒い半年 11〜4月", {11, 12, 1, 2, 3, 4}), ("暖かい半年 5〜10月", {5, 6, 7, 8, 9, 10})):
        ds = {d for d in common_all if d.month in months}
        table(f"気象庁 {name}", jma, ds)
        if omd:
            table(f"Open-Meteo {name}", omd, ds)
    # 年ごと（1日前・3日前・5日前の最高）
    for yr in (2024, 2025, 2026):
        ds = {d for d in common_all if d.year == yr}
        print(f"[年] {yr} {len(ds)}日")
        table(f"気象庁 {yr}", jma, ds)
        if omd:
            table(f"Open-Meteo {yr}", omd, ds)


if __name__ == "__main__":
    which = sys.argv[1:] or ["tel", "json", "pages", "more", "acc"]
    for w, f in (("tel", part_telegrams), ("json", part_bosai), ("pages", part_pages), ("more", part_more), ("wdist", part_wdist), ("acc", part_accuracy)):
        if w in which:
            try:
                f()
            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"[失敗] {w} {type(e).__name__}: {e}")
