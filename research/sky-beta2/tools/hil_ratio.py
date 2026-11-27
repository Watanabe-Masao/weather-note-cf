"""Hillaire ÷ Bruneton（550 nm の放射輝度）を、太陽側・横・反対側（高さ 3°）・反対側 20°・天頂で並べる（#537、11/27 外部レビューの切り分け）。
python3 research/sky-beta2/tools/hil_ratio.py <cases.json> <Bruneton の radiance フォルダ> <比較ページの json>...
Bruneton の radiance フォルダは kochi_ref の radiance の出力（散乱の次数を KOCHI_ORDERS で変えたものを渡せる）。
比較ページの json は tools/check_web.py の出力（?ms= で多重散乱の表の大きさを変えたもの）。"""
import json, os, sys

cases = json.load(open(sys.argv[1]))
rad_dir = sys.argv[2]
webs = [(os.path.basename(p), json.load(open(p))) for p in sys.argv[3:]]
KEYS = ["d0-a3", "d90-a3", "d180-a3", "d180-a20", "zenith"]


def views(cid):
    rows = {}
    for line in open(os.path.join(rad_dir, cid + ".views.txt")):
        x = line.split()
        rows[x[0]] = [float(v) for v in x[1:]]
    return rows


for c in cases["cases"]:
    R = views(c["id"])
    ids = [v["id"] for v in c["views"]]
    for name, w in webs:
        res = next(r for r in w["results"] if r["id"] == c["id"])
        h = res["hillaire"]
        ratio = [h[ids.index(k) * 3 + 1] / R[k][1] for k in KEYS]
        print(f"{c['id']:12s} {name:28s} " + " ".join(f"{v:5.2f}" for v in ratio))
