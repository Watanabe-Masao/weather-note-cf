"""多波長の色（CPU で積分）：opengl/kochi_ref の spectral の 5 回（15 波長、各回 3 波長の放射輝度）を、CIE 1931 2° の等色関数で
積分して XYZ → 線形 sRGB の輝度（cd/m²）にする。Bruneton の 15 波長の事前計算（luminance）と独立に色を確かめるため。
python3 research/sky-beta2/tools/spectral.py <spec フォルダ> <cases.json> <constants.h> <出力 json> [帯の出力フォルダ]
spec フォルダの g0〜g4 は、spec.sh のとおり R・G・B の枠に 15 波長を 3 つずつ（g0 の R＝438.33、G＝407、B＝375.67 nm …）。"""
import json, os, re, sys
import numpy as np

spec, cases_path, constants_h, out_json = sys.argv[1:5]
pano_out = sys.argv[5] if len(sys.argv) > 5 else None
D = 470 / 15
LAMBDAS = [360 + (i + 0.5) * D for i in range(15)]
src = open(constants_h).read()
cmf = np.array([float(x) for x in re.search(r"CIE_2_DEG_COLOR_MATCHING_FUNCTIONS\[380\] = \{(.*?)\};", src, re.S).group(1).replace("\n", " ").split(",") if x.strip()]).reshape(-1, 4)
XYZ_TO_SRGB = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
W = np.array([[np.interp(l, cmf[:, 0], cmf[:, k]) for k in (1, 2, 3)] for l in LAMBDAS])  # 15×3（x̄ ȳ z̄）


def lam_index(group, channel):
    # g0：R＝λ[2]、G＝λ[1]、B＝λ[0]
    return 3 * group + (2 - channel)


def integrate(spectra):  # spectra: (..., 15) W/m²/sr/nm → (..., 3) 線形 sRGB の cd/m²
    xyz = 683.0 * D * spectra @ W
    return xyz @ XYZ_TO_SRGB.T


cases = json.load(open(cases_path))
res = {"lambdas_nm": LAMBDAS, "cases": {}}
for c in cases["cases"]:
    sp = {}
    for g in range(5):
        for line in open(os.path.join(spec, f"g{g}", c["id"] + ".views.txt")):
            p = line.split()
            arr = sp.setdefault(p[0], [0.0] * 15)
            for ch in range(3):
                arr[lam_index(g, ch)] = float(p[1 + ch])
    res["cases"][c["id"]] = {k: [round(float(x), 4) for x in integrate(np.array(v))] for k, v in sp.items()}
    if pano_out:
        stack = None
        for g in range(5):
            a = np.fromfile(os.path.join(spec, f"g{g}", c["id"] + ".pano.lum.f32"), dtype="<f4").reshape(-1, 3)
            if stack is None:
                stack = np.zeros((a.shape[0], 15))
            for ch in range(3):
                stack[:, lam_index(g, ch)] = a[:, ch]
        rgb = integrate(stack).astype("<f4")
        os.makedirs(pano_out, exist_ok=True)
        rgb.tofile(os.path.join(pano_out, c["id"] + ".pano.lum.f32"))
json.dump(res, open(out_json, "w"), indent=1)
print("ok", out_json)
