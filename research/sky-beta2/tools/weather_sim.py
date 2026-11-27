"""晴れ・曇り・雨を同じ時刻で並べるシミュレーション（#537、11/27 渡辺さん「代表的な晴・曇り・雨を同じ時刻で何パターンか」）。
python3 research/sky-beta2/tools/weather_sim.py <cases.json> <比較ページの json（?dump=1）> <hillaire_spectral.ts> <出力 png> [出力 json]

晴天は Hillaire 15 波長の帯（線形 sRGB、cd/m²）。雲は **仮の簡略モデル**（一様に空を覆う 1 枚の層、雲は色を持たない）：
- 雲の光学的厚さ τ。全体の透過（2 流近似、保存散乱）T = 1 / (1 + 0.75 (1 − g) τ)、g = 0.85
- 雲を通り抜けた晴天の光：exp(−τ / sin(高さ)) × 晴天の光（薄い雲で青空や太陽のまわりが透ける分）
- 雲の下の散った光：雲の上の水平面照度（晴天の直達＋天空、地表の値で代用）× (T − 直達の残り)。明るさの分布は CIE の標準曇天空
  L(高さ) = Lz (1 + 2 sin 高さ) / 3、E = (7/9) π Lz。色は雲の上に届く光の色のまま
- 雨は τ を大きくしただけ（雨粒・雨のかすみ・雲底の高さは入れていない）
露出は「晴天の基準」：その時刻の晴天の帯の 99 パーセンタイルで決め、同じ時刻の天気はすべて同じ露出で表示する。
比べのため、雨を「場面ごとの露出」で引き伸ばした 1 枚も足す（これが不自然になる例）。"""
import json, math, re, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

cases = json.load(open(sys.argv[1]))
web = json.load(open(sys.argv[2]))
ts = open(sys.argv[3]).read()
out_png = sys.argv[4]
out_json = sys.argv[5] if len(sys.argv) > 5 else None
groups = json.loads(re.search(r"SPECTRAL_GROUPS = (\[.*?\]);", ts, re.S).group(1))
cmf = np.array(json.loads(re.search(r"SPECTRAL_CMF: number\[\]\[\] = (\[.*?\]);", ts, re.S).group(1)))
D = float(re.search(r"SPECTRAL_STEP_NM = ([0-9.]+)", ts).group(1))
M = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.204, 1.057]])
# 15 波長（λ の小さい順）の定数
lam, ray, mie, oz, sol = [], [], [], [], []
for g in groups:
    for k in (2, 1, 0):
        lam.append(g["lambdas"][k]); ray.append(g["rayleighScattering"][k]); mie.append(g["mieExtinction"][k]); oz.append(g["ozoneAbsorption"][k]); sol.append(g["solarIrradiance"][k])
order = np.argsort(lam)
ray, mie, oz, sol = (np.array(x)[order] for x in (ray, mie, oz, sol))
TAU_V = ray * 8.0 + mie * 1.2 + oz * 15.0  # 鉛直の光学的厚さ（Rayleigh 尺度高 8 km、Mie 1.2 km、オゾンは高さ 10〜40 km の三角形の分布で面積 15 km）


def direct_horizontal(alt_deg):
    """晴天の直達の水平面照度（線形 sRGB、lx 相当）。Kasten–Young の大気路程。太陽が地平線の下なら 0。"""
    if alt_deg <= 0:
        return np.zeros(3)
    z = 90 - alt_deg
    m = 1 / (math.cos(math.radians(z)) + 0.50572 * (96.07995 - z) ** -1.6364)
    e = sol * np.exp(-TAU_V * m) * math.sin(math.radians(alt_deg))  # W/m²/nm
    xyz = 683 * D * e @ cmf
    return M @ xyz


def srgb(x):
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.maximum(x, 0), 1 / 2.4) - 0.055)


def show(L, e):
    return np.clip(np.round(255 * srgb(1 - np.exp(-np.maximum(L, 0) * e))), 0, 255).astype(np.uint8)


W, H = web["results"][0]["panoSize"]
AZ0, AZ1, AZS = cases["panorama"]["az"]
ALT0, ALT1, ALTS = cases["panorama"]["alt"]
alts = ALT0 + np.arange(H) * ALTS
G = 0.85
WEATHERS = [("晴れ", 0.0), ("薄曇り τ 3", 3.0), ("曇り τ 10", 10.0), ("厚い曇り τ 30", 30.0), ("雨（仮）τ 80", 80.0)]
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
f_t, f_l = ImageFont.truetype(FONT, 22), ImageFont.truetype(FONT, 15)
TITLES = {"sun+5": "太陽 +5°（16:34）", "sunset-1.9": "太陽 −1.9°（17:10）", "dusk-6.8": "太陽 −6.8°（17:35）"}

rows_per = len(WEATHERS) + 1
row_h = H + 21
img = Image.new("RGB", (W + 32, 16 + len(cases["cases"]) * (36 + rows_per * (row_h + 5) + 10) + 80), (24, 27, 34))
dr = ImageDraw.Draw(img)
y = 16
summary = {}
for c in cases["cases"]:
    r = next(x for x in web["results"] if x["id"] == c["id"])
    clear = np.array(r["hillaireSpectralPano"], dtype=np.float64).reshape(H, W, 3)
    ids = [v["id"] for v in c["views"]]
    zen = np.array(r["hillaireSpectral"][ids.index("zenith") * 3 : ids.index("zenith") * 3 + 3])
    # 天空の水平面照度：0〜60° は帯から、60〜90° は 60° の行の平均と天頂の間を線形に
    up = alts >= 0
    sa, ca = np.sin(np.radians(alts)), np.cos(np.radians(alts))
    dA, dZ = math.radians(ALTS), math.radians(AZS)
    E_sky = np.einsum("jic,j->c", clear[up], (sa * ca)[up]) * dA * dZ
    row60 = clear[-1].mean(axis=0)
    for a in np.arange(60.25, 90, 0.5):
        t = (a - 60) / 30
        E_sky += ((1 - t) * row60 + t * zen) * math.sin(math.radians(a)) * math.cos(math.radians(a)) * dA * 2 * math.pi
    E_dir = direct_horizontal(c["sunAlt"])
    E_top = E_sky + E_dir
    mu0 = max(math.sin(math.radians(c["sunAlt"])), 0.0)
    e_ref = 1.0 / np.percentile(clear[up][..., 1], 99)  # 晴天の基準の露出（99 パーセンタイルの G が 1 − e⁻¹）
    dr.text((16, y), f"{TITLES.get(c['id'], c['id'])}　露出は晴れの空で決め、5 枚共通", font=f_t, fill=(235, 238, 245))
    y += 36
    summary[c["id"]] = {"E_top_lux_G": float(E_top[1]), "E_direct_G": float(E_dir[1]), "weathers": {}}
    rain_L = None
    for name, tau in WEATHERS:
        if tau == 0:
            L = clear.copy()
            Tt = 1.0
        else:
            Tt = 1 / (1 + 0.75 * (1 - G) * tau)
            through = np.exp(-tau / np.maximum(sa, 0.05))[:, None, None] * clear
            Td = max(Tt - (math.exp(-tau / mu0) if mu0 > 0 else 0.0), 0.0)
            Lz = 9 * Td * E_top / (7 * math.pi)
            dome = ((1 + 2 * np.maximum(sa, 0)) / 3)[:, None, None] * Lz[None, None, :]
            L = through + np.where(up[:, None, None], dome, 0.0)
        mean_g = float(L[up][..., 1].mean())
        summary[c["id"]]["weathers"][name] = {"tau": tau, "T": Tt, "mean_G_cd": mean_g}
        img.paste(Image.fromarray(show(L, e_ref)[::-1]), (16, y))
        rel = mean_g / summary[c["id"]]["weathers"]["晴れ"]["mean_G_cd"]
        dr.text((16, y + H + 2), f"{name}　空の平均の明るさ：晴れの {rel:.2f} 倍", font=f_l, fill=(170, 178, 192))
        y += row_h + 5
        rain_L = L
    e_rain = 1.0 / np.percentile(rain_L[up][..., 1], 99)
    img.paste(Image.fromarray(show(rain_L, e_rain)[::-1]), (16, y))
    dr.text((16, y + H + 2), "参考：雨（仮）を「場面ごとの露出」で引き伸ばすと（晴れと同じ明るさに見えてしまう例）", font=f_l, fill=(220, 150, 120))
    y += row_h + 15
for k, t in enumerate(["Hillaire 15 波長・表 128×128 の晴天に、仮の簡略な雲を重ねた。", "雲は一様な 1 枚の層、明るさの分布は CIE 標準曇天空。τ は雲の光学的厚さ。", "雨は τ を大きくしただけ。左が北、方位 0〜360°、高さ −2〜60°。"]):
    dr.text((16, y + 20 * k), t, font=f_l, fill=(150, 158, 172))
img.save(out_png)
if out_json:
    json.dump(summary, open(out_json, "w"), ensure_ascii=False, indent=1)
for k, v in summary.items():
    print(k, {n: round(w["mean_G_cd"] / v["weathers"]["晴れ"]["mean_G_cd"], 3) for n, w in v["weathers"].items()}, "E_top G", round(v["E_top_lux_G"], 1), "direct", round(v["E_direct_G"], 1))
