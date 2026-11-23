"""FS-02：天気分布予報（前の発表を読めるか・天気の面の意味）と、清水の観測所の位置（GitHub Actions で1回）。

ログに出すだけ（ファイルは作らない・コミットしない）。各ホストは robots.txt を先に読む（fs01.py の allowed/get）。
"""
import io, json, re, sys, zipfile
from collections import Counter
from datetime import datetime, timedelta

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from fs01 import allowed, get  # noqa: E402

W = "https://www.jma.go.jp/bosai/jmatile/data/wdist"


def wdist():
    print("===== 5. 天気分布予報")
    tt = get(f"{W}/targetTimes.json")
    d = json.loads(tt[0])
    base = d[0]["basetime"]
    times = sorted(t["validtime"] for t in d)
    print("[今の発表] basetime(UTC)", base, "時刻", len(times), times[0], "〜", times[-1], tt[1])
    # 前の発表：発表は 5・11・17時 JST ＝ 20・02・08時 UTC。9回前（3日前）まで、同じ形の小さいファイル（r3_nd）で確かめる。
    b = datetime.strptime(base, "%Y%m%d%H%M%S")
    import math
    z = 7
    tx = int((133.55 + 180) / 360 * 2 ** z)
    lat = math.radians(33.57)
    ty = int((1 - math.log(math.tan(lat) + 1 / math.cos(lat)) / math.pi) / 2 * 2 ** z)
    prev = [b - timedelta(hours=h) for h in range(1, 73) if (b - timedelta(hours=h)).hour in (20, 2, 8)]
    for pb in prev:
        vt = (pb + timedelta(hours=10)).strftime("%Y%m%d%H%M%S")  # 発表から10時間後（どの発表にもある時刻）
        pbs = pb.strftime("%Y%m%d%H%M%S")
        out = []
        for el in ("r3_nd", "wm"):
            r = get(f"{W}/{pbs}/none/{vt}/surf/{el}/data.geojson?id={el}")
            out.append(f"{el}:" + (f"読めた{r[1]['size']}B" if r else "読めない"))
        r = get(f"{W}/{pbs}/none/{vt}/surf/wm/{z}/{tx}/{ty}.png")
        out.append("wmタイル:" + (f"読めた{r[1]['size']}B" if r else "読めない"))
        print(f"[前の発表] basetime {pbs} 時刻 {vt}", " ".join(out))
    r = get(f"{W}/{base}/none/{times[0]}/surf/wm/{z}/{tx}/{ty}.png")
    print("[今の発表のタイル]", f"{z}/{tx}/{ty}", (r[1] if r else "読めない"))
    # 天気の面の種類（全部の時刻）
    lv = Counter()
    for vt in times:
        r = get(f"{W}/{base}/none/{vt}/surf/wm/data.geojson?id=wm")
        if not r:
            continue
        for f in json.loads(r[0]).get("features", []):
            lv[(f.get("properties") or {}).get("level")] += 1
    print("[天気の面の level（全部の時刻）]", dict(lv))
    # ページの説明（凡例）：ページと読み込む JS の中の、天気の言葉と英語の名前
    page = get("https://www.jma.go.jp/bosai/wdist/")
    if page:
        srcs = re.findall(r'src="([^"]+\.js)"', page[0])
        print("[ページの JS]", srcs)
        for s in srcs:
            u = s if s.startswith("http") else "https://www.jma.go.jp/bosai/wdist/" + s.lstrip("./")
            r = get(u)
            if not r:
                continue
            js = r[0]
            for w in ("Fine", "Cloudy", "Rain", "Snow", "Sleet", "晴れ", "くもり", "雨", "雪", "みぞれ", "凡例"):
                for m in list(re.finditer(re.escape(w), js))[:3]:
                    print(f"   [{u.rsplit('/',1)[1]} {w}]", js[max(0, m.start() - 120):m.end() + 120].replace("\n", " "))
    for u in ("https://www.jma.go.jp/bosai/wdist/table/wdist.properties__c64b4660a3de3dcd4ac7.xml",):
        r = get(u)
        if r:
            x = r[0]
            i = x.find("<contents")
            print("[設定の続き]", re.sub(r"\s+", " ", x[2400:9000]))


def shimizu():
    print("\n===== 4. 清水の位置")
    r = get("https://www.data.jma.go.jp/obd/stats/etrn/select/prefecture.php?prec_no=74&block_no=&year=&month=&day=&view=")
    if r:
        for m in re.finditer(r"viewPoint\(([^)]*)\)", r[0]):
            a = m.group(1)
            if any(n in a for n in ("清水", "室戸岬", "'高知'", "足摺")):
                print("[過去の気象データの地点]", a)
    r = get("https://www.data.jma.go.jp/obd/stats/etrn/index.php?prec_no=74&block_no=47898&year=&month=&day=&view=")
    if r:
        t = re.sub(r"<[^>]+>", " ", r[0])
        t = re.sub(r"\s+", " ", t)
        i = t.find("清水")
        print("[47898 の頁]", t[i - 100:i + 600])
    r = get("https://www.jma.go.jp/jma/kishou/know/amedas/ame_master.zip", binary=True)
    if r:
        z = zipfile.ZipFile(io.BytesIO(r[0]))
        for n in z.namelist():
            raw = z.read(n)
            try:
                txt = raw.decode("cp932")
            except UnicodeDecodeError:
                txt = raw.decode("utf-8", "replace")
            lines = txt.splitlines()
            print(f"[地域気象観測所一覧] {n} {len(lines)}行 見出し {lines[0][:200]}")
            for ln in lines:
                if "清水" in ln or "74516" in ln or "74372" in ln or "74182" in ln:
                    print("   ", ln[:200])


if __name__ == "__main__":
    for f in (shimizu, wdist):
        try:
            f()
        except Exception as e:
            import traceback
            traceback.print_exc()
            print("[失敗]", f.__name__, e)
