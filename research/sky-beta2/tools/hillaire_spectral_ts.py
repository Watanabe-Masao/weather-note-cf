"""webgl/hillaire_spectral.ts を作る（#537、11/27）：Hillaire を 15 波長（3 波長ずつ 5 回）で動かすための大気の定数と、CIE の等色関数の重み。
python3 research/sky-beta2/tools/hillaire_spectral_ts.py <kochi_ref.cc> <constants.h> > research/sky-beta2/webgl/hillaire_spectral.ts
定数は kochi_ref の spectral（spec.sh の 5 回）と同じ作り方：Rayleigh は λ^−4、ほかは 10 nm の表を線形補間。重みは tools/spectral.py と同じ。"""
import re, sys
import numpy as np

cc, consts = open(sys.argv[1]).read(), open(sys.argv[2]).read()
arr = lambda name: [float(x) for x in re.search(name + r"\[48\] = \{(.*?)\};", cc, re.S).group(1).replace("\n", " ").split(",") if x.strip()]
sol, ozx = arr("kSolarIrradiance"), arr("kOzoneCrossSection")
wl = np.arange(360, 831, 10)
DU = 2.687e20
ozmax = 300 * DU / 15000.0
mie = 5.328e-3 / 1200.0  # /m（α 0・尺度高 1.2 km。kochi_ref の既定）
D = 470 / 15
L = [360 + (i + 0.5) * D for i in range(15)]
cmf = np.array([float(x) for x in re.search(r"CIE_2_DEG_COLOR_MATCHING_FUNCTIONS\[380\] = \{(.*?)\};", consts, re.S).group(1).replace("\n", " ").split(",") if x.strip()]).reshape(-1, 4)
W = [[float(np.interp(l, cmf[:, 0], cmf[:, k])) for k in (1, 2, 3)] for l in L]
groups = []
for g in range(5):
    lams = [L[3 * g + 2], L[3 * g + 1], L[3 * g]]  # R・G・B の枠
    km = lambda v: [round(x * 1000, 9) for x in v]
    groups.append({
        "lambdas": [round(x, 2) for x in lams],
        "rayleighScattering": km([1.24062e-6 * (x * 1e-3) ** -4 for x in lams]),
        "mieScattering": km([mie * 0.9] * 3),
        "mieExtinction": km([mie] * 3),
        "ozoneAbsorption": km([ozmax * float(np.interp(x, wl, ozx)) for x in lams]),
        "solarIrradiance": [round(float(np.interp(x, wl, sol)), 6) for x in lams],
    })
import json
print("// tools/hillaire_spectral_ts.py が作る（手で直さない）。Hillaire を 15 波長（3 波長ずつ 5 回）で動かすための定数（#537、11/27）。")
print("// 各回の R・G・B の枠に 15 波長を 3 つずつ（g0 の R＝438.33、G＝407、B＝375.67 nm …。spec.sh と同じ順）。単位：/km、W/m²/nm。")
print("export const SPECTRAL_GROUPS = " + json.dumps(groups) + ";")
print("/** 15 波長の CIE 1931 2° の等色関数（x̄・ȳ・z̄）。tools/spectral.py と同じ。 */")
print("export const SPECTRAL_CMF: number[][] = " + json.dumps([[round(v, 7) for v in r] for r in W]) + ";")
print(f"export const SPECTRAL_STEP_NM = {D!r};")
