"""cases.json → opengl/kochi_ref の入力（行の形式）。python3 research/sky-beta2/tools/cases_txt.py cases.json > cases.txt"""
import json, sys

d = json.load(open(sys.argv[1]))
print("height", d["observerHeightM"])
p = d["panorama"]
print("pano", *p["az"], *p["alt"])
for c in d["cases"]:
    print("case", c["id"], c["sunAlt"], c["sunAz"])
    for v in c["views"]:
        print("view", v["id"], v["az"], v["alt"])
