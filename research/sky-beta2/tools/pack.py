"""OpenGL 参照（opengl/kochi_ref）の出力 → WebGL 2 の比較ページが読むデータ（webgl/data/）。
python3 research/sky-beta2/tools/pack.py <luminance の出力> <radiance の出力> <cases.json> <webgl/data>
- 事前計算の表（radiance のもの）を半精度（float16）に：iPhone の WebGL 2 で RGBA16F のまま線形補間できる
- 視線ごとの値：輝度（luminance、cd/m²、線形 sRGB）、放射輝度と透過率（radiance、680・550・440 nm）→ ref.json
- 帯（パノラマ）の放射輝度 → <case>.pano.f16（幅×高さ×3）
"""
import json, os, shutil, sys
import numpy as np

lum_dir, rad_dir, cases_path, out = sys.argv[1:5]
# 11/27：表・帯・視線の値は radiance（3 波長）の計算を使う。luminance（15 波長）の事前計算は、この環境（Mesa llvmpipe）で
# 波長の組を足し合わせる所が正しく動かず（半精度で青緑、全精度で灰色）、色の比較に使えなかった（results.md）。
os.makedirs(out, exist_ok=True)
for name in ["transmittance", "scattering", "single_mie_scattering", "irradiance"]:
    a = np.fromfile(os.path.join(rad_dir, name + ".dat"), dtype="<f4")
    a.astype("<f2").tofile(os.path.join(out, name + ".f16"))
shutil.copy(os.path.join(rad_dir, "atmosphere_shader.glsl"), os.path.join(out, "atmosphere_shader.glsl"))
shutil.copy(cases_path, os.path.join(out, "cases.json"))
cases = json.load(open(cases_path))


def views(d, cid):
    rows = {}
    for line in open(os.path.join(d, cid + ".views.txt")):
        p = line.split()
        rows[p[0]] = [float(x) for x in p[1:]]
    return rows


def meta(d):
    m = {}
    for line in open(os.path.join(d, "meta.txt")):
        k, _, v = line.strip().partition(" ")
        m.setdefault(k, []).append(v)
    return m


ref = {"meta": {"luminance": meta(lum_dir), "radiance": meta(rad_dir)}, "cases": {}}
for c in cases["cases"]:
    L, R = views(lum_dir, c["id"]), views(rad_dir, c["id"])
    ref["cases"][c["id"]] = {
        v["id"]: {"radiance": [round(x, 7) for x in R[v["id"]][:3]], "transmittance": [round(x, 6) for x in R[v["id"]][3:]], "luminance15_unverified": [round(x, 3) for x in L[v["id"]][:3]]}
        for v in c["views"]
    }
    p = np.fromfile(os.path.join(rad_dir, c["id"] + ".pano.lum.f32"), dtype="<f4")
    np.clip(p, -65504, 65504).astype("<f2").tofile(os.path.join(out, c["id"] + ".pano.f16"))  # 太陽のすぐそばは半精度の上限を超える
json.dump(ref, open(os.path.join(out, "ref.json"), "w"), ensure_ascii=False, indent=1)
# 非公開のページ（artifact）は任意の 2 進のファイルを配らないので、半精度の表・帯は base64 の文字（.f16.txt）にもする
import base64
for f in os.listdir(out):
    if f.endswith(".f16"):
        open(os.path.join(out, f + ".txt"), "w").write(base64.b64encode(open(os.path.join(out, f), "rb").read()).decode())
print("ok", out)
