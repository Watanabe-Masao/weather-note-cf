"""地球と太陽の距離（太陽の放射照度の倍率 k）が、空の色・明るさ・表示に効くかの比較（#537、11/27）。
python3 research/sky-beta2/tools/sun_distance_check.py <cases.json> <基準 k=1 の json> <比べる json>...（tools/check_web.py の ?sun= の出力）
Hillaire 15 波長の視線ごとの輝度（線形 sRGB、cd/m²）で、(1) 明るさの比、(2) 暖かさ（統一の定義）、(3) 表示の色（1 − exp(−E·L) → sRGB、0〜255）を、
固定の露出（E＝1e-4）・場面ごとの露出（ページと同じ、Bruneton から決めた E＝倍率によらない）・自分に合わせた露出（E/k）の 3 通りで比べる。"""
import json, sys

cases = json.load(open(sys.argv[1]))
base = json.load(open(sys.argv[2]))
others = [(p, json.load(open(p))) for p in sys.argv[3:]]


def warm(c):
    c = [max(0, x) for x in c]
    s = sum(c)
    return (c[0] - c[2]) / s if s > 0 else 0


def srgb(v):
    return 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055


def tone(c, e):
    import math
    return [round(255 * min(1, max(0, srgb(1 - math.exp(-max(0, x) * e))))) for x in c]


for p, o in others:
    k = o["info"]["hillaire"]["sunScale"]
    print(f"\n## 倍率 k = {k}")
    worst = {"ratio": 0, "warm": 0, "fixed": 0, "scene": 0, "own": 0}
    for c in cases["cases"]:
        b = next(r for r in base["results"] if r["id"] == c["id"])
        x = next(r for r in o["results"] if r["id"] == c["id"])
        eS = b["eScene"]
        for i, v in enumerate(c["views"]):
            L0 = b["hillaireSpectral"][i * 3 : i * 3 + 3]
            L1 = x["hillaireSpectral"][i * 3 : i * 3 + 3]
            if L0[1] <= 0:
                continue
            worst["ratio"] = max(worst["ratio"], max(abs(L1[q] / L0[q] - k) for q in range(3) if L0[q] > 1e-6))
            worst["warm"] = max(worst["warm"], abs(warm(L1) - warm(L0)))
            d = lambda e1, e2: max(abs(a - b2) for a, b2 in zip(tone(L1, e1), tone(L0, e2)))
            worst["fixed"] = max(worst["fixed"], d(1e-4, 1e-4))
            worst["scene"] = max(worst["scene"], d(eS, eS))
            worst["own"] = max(worst["own"], d(eS / k, eS))
    print(f"- 輝度 ÷ 基準 と k のずれ（R・G・B の最大）：{worst['ratio']:.2e}")
    print(f"- 暖かさの差の最大：{worst['warm']:.4f}")
    print(f"- 表示の色の差の最大（0〜255 の段）：固定の露出 {worst['fixed']}・場面ごとの露出（ページ）{worst['scene']}・自分に合わせた露出 {worst['own']}")
