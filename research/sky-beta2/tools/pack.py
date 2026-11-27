"""OpenGL 参照（opengl/kochi_ref）の出力 → WebGL 2 の比較ページが読むデータ（webgl/data/）。
python3 research/sky-beta2/tools/pack.py <luminance の出力> <radiance の出力> <spectral.json> <cases.json> <webgl/data>
- 事前計算の表（luminance：15 波長を CIE の等色関数で積分した輝度の表）を半精度（float16）に。iPhone の WebGL 2 で RGBA16F のまま線形補間できる
- 視線ごとの値 → ref.json：輝度（luminance、cd/m²、線形 sRGB）、多波長を CPU で積分した輝度（spectral、tools/spectral.py。色の積分の経路の確かめ）、
  3 波長の放射輝度と透過率（radiance、680・550・440 nm。今までの近似と、透過率）
- 帯（パノラマ）の輝度 → <case>.pano.f16
- 非公開のページ（artifact）は任意の 2 進のファイルを配らないので、.f16 は base64 の文字（.f16.txt）で置く
"""
import base64, json, os, shutil, sys
import numpy as np

lum_dir, rad_dir, spectral_json, cases_path, out = sys.argv[1:6]
os.makedirs(out, exist_ok=True)


def put_f16(arr, name):
    b = np.clip(arr, -65504, 65504).astype("<f2").tobytes()  # 太陽のすぐそばは半精度の上限を超える
    open(os.path.join(out, name + ".f16.txt"), "w").write(base64.b64encode(b).decode())


for name in ["transmittance", "scattering", "single_mie_scattering", "irradiance"]:
    put_f16(np.fromfile(os.path.join(lum_dir, name + ".dat"), dtype="<f4"), name)
shutil.copy(os.path.join(lum_dir, "atmosphere_shader.glsl"), os.path.join(out, "atmosphere_shader.glsl"))
shutil.copy(cases_path, os.path.join(out, "cases.json"))
cases = json.load(open(cases_path))
spectral = json.load(open(spectral_json))


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


ref = {"meta": {"luminance": meta(lum_dir), "radiance": meta(rad_dir), "spectral_lambdas_nm": spectral["lambdas_nm"]}, "cases": {}}
for c in cases["cases"]:
    L, R = views(lum_dir, c["id"]), views(rad_dir, c["id"])
    ref["cases"][c["id"]] = {
        v["id"]: {
            "luminance": [round(x, 4) for x in L[v["id"]][:3]],
            "spectral": spectral["cases"][c["id"]][v["id"]],
            "radiance": [round(x, 7) for x in R[v["id"]][:3]],
            "transmittance": [round(x, 6) for x in R[v["id"]][3:]],
        }
        for v in c["views"]
    }
    put_f16(np.fromfile(os.path.join(lum_dir, c["id"] + ".pano.lum.f32"), dtype="<f4"), c["id"] + ".pano")
    # 3 波長（680・550・440 nm）の放射輝度の帯：Hillaire と同じ表示で並べる（方式の違いだけを見る。11/27）
    put_f16(np.fromfile(os.path.join(rad_dir, c["id"] + ".pano.lum.f32"), dtype="<f4"), c["id"] + ".radpano")
json.dump(ref, open(os.path.join(out, "ref.json"), "w"), ensure_ascii=False, indent=1)
print("ok", out)
