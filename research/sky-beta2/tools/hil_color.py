"""Hillaire と Bruneton の色の向き（暖かさ）を、同じ定義で比べる（#537、11/27）。
python3 research/sky-beta2/tools/hil_color.py <cases.json> <ref.json> <比較ページの json>
- Hillaire は 3 波長（680・550・440 nm）しか持たないので、両方とも「3 波長の放射輝度を太陽の白で割った (R − B)/(R + G + B)」で比べる（方式の違いだけを見る）
- 参考に、Bruneton の統一の定義（15 波長の輝度、白で割らない）も並べる（3 波長の近似の分のずれの目安）"""
import json, sys

cases = json.load(open(sys.argv[1]))
ref = json.load(open(sys.argv[2]))
web = json.load(open(sys.argv[3]))
WHITE = [float(x) for x in ref["meta"]["radiance"]["white_point"][0].split()]


def warm(c):
    c = [max(0.0, v) for v in c]
    s = sum(c)
    return (c[0] - c[2]) / s if s > 0 else 0.0


wb = lambda c: [c[i] / WHITE[i] for i in range(3)]
print("| 事例 | 視線 | Hillaire（3 波長・白で割る） | Bruneton（同じ定義） | 差 | Bruneton（統一の定義、15 波長） |")
print("|---|---|---|---|---|---|")
worst = 0.0
for c in cases["cases"]:
    res = next(r for r in web["results"] if r["id"] == c["id"])
    ids = [v["id"] for v in c["views"]]
    for k in ["d0-a3", "d30-a3", "d60-a3", "d90-a3", "d120-a3", "d150-a3", "d180-a3", "d0-a20", "d90-a20", "d180-a20", "zenith"]:
        if k not in ids:
            continue
        i = ids.index(k)
        h = warm(wb(res["hillaire"][i * 3 : i * 3 + 3]))
        b = warm(wb(ref["cases"][c["id"]][k]["radiance"]))
        u = warm(ref["cases"][c["id"]][k]["luminance"])
        worst = max(worst, abs(h - b))
        print(f"| {c['id']} | {k} | {h:+.2f} | {b:+.2f} | {h - b:+.2f} | {u:+.2f} |")
print(f"\n最大の差 {worst:.2f}")
