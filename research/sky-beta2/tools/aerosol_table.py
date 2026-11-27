"""エアロゾルの感度の比較の表（#537、11/27）：同じ時刻・同じ視線で、大気の条件だけを変えた Bruneton の計算を並べる。
python3 research/sky-beta2/tools/aerosol_table.py <基準の lum> <基準の rad> <aer フォルダ> <cases.json>
- 放射輝度（550 nm、3 波長の計算）：太陽側・横・反対側（高さ 3°）と天頂、太陽側 / 反対側
- 色（15 波長の輝度）：暖かさ (R − B)/(R + G + B)（線形 sRGB）と、明るさ（G、cd/m²）"""
import json, os, sys

base_lum, base_rad, aer, cases_path = sys.argv[1:5]
cases = json.load(open(cases_path))
VARIANTS = [("A", "標準（Bruneton、AOD≈0.005）", base_lum, base_rad)] + [
    (n, label, os.path.join(aer, n + "-lum"), os.path.join(aer, n + "-rad"))
    for n, label in [
        ("B", "AOD 0.1・α 0・H 1.2 km"),
        ("C", "AOD 0.3・α 0・H 1.2 km（量）"),
        ("D", "AOD 0.3・α 1.3・H 1.2 km（色）"),
        ("E", "AOD 0.3・α 1.3・H 0.5 km（地表寄り）"),
        ("F", "AOD 0.3・α 1.3・H 3 km（上空寄り）"),
    ]
]


def views(d, cid):
    rows = {}
    p = os.path.join(d, cid + ".views.txt")
    if not os.path.exists(p):
        return None
    for line in open(p):
        x = line.split()
        rows[x[0]] = [float(v) for v in x[1:]]
    return rows


def warm(c):
    c = [max(0.0, v) for v in c[:3]]
    s = sum(c)
    return (c[0] - c[2]) / s if s > 0 else 0.0


for c in cases["cases"]:
    print(f"\n### {c['id']}（太陽 {c['sunAlt']:.1f}°）\n")
    print("| 条件 | 550 nm mW/m²/sr/nm 太陽側・横・反対側（3°）・天頂 | 太陽側/反対側 | 暖かさ 太陽側・横・反対側（3°）・反対側 20° | 明るさ G cd/m² 太陽側・反対側（3°） |")
    print("|---|---|---|---|---|")
    for n, label, ld, rd in VARIANTS:
        L, R = views(ld, c["id"]), views(rd, c["id"])
        if not L or not R:
            print(f"| {label} | （未計算） | | | |")
            continue
        r = [R[k][1] * 1000 for k in ("d0-a3", "d90-a3", "d180-a3", "zenith")]
        w = [warm(L[k]) for k in ("d0-a3", "d90-a3", "d180-a3", "d180-a20")]
        print(
            f"| {label} | {' · '.join(f'{v:.3g}' for v in r)} | {r[0] / r[2]:.1f} 倍 | {' · '.join(f'{v:+.2f}' for v in w)} | {L['d0-a3'][1]:.3g} · {L['d180-a3'][1]:.3g} |"
        )
