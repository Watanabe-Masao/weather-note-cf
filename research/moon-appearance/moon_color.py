"""月の色（高さで変わる赤・黄・白）の計算。標準ライブラリだけ。
  python3 research/moon-appearance/moon_color.py
晴れた日の典型の大気で、月の高さごとの見える色（sRGB）を出す。値の出どころは README.md。
"""
import math

# --- 波長（nm）：380〜780 を 5nm ごと
L = [380 + 5 * i for i in range(81)]

def g(l, mu, s1, s2):
    t = (l - mu) / (s1 if l < mu else s2)
    return math.exp(-0.5 * t * t)

def cmf(l):
    """CIE 1931 等色関数の近似（Wyman, Sloan & Shirley 2013、複数の山の式）。"""
    x = 0.362 * math.exp(-0.5 * ((l - 442.0) * (0.0624 if l < 442.0 else 0.0374)) ** 2) \
        + 1.056 * math.exp(-0.5 * ((l - 599.8) * (0.0264 if l < 599.8 else 0.0323)) ** 2) \
        - 0.065 * math.exp(-0.5 * ((l - 501.1) * (0.0490 if l < 501.1 else 0.0382)) ** 2)
    y = 0.821 * math.exp(-0.5 * ((l - 568.8) * (0.0213 if l < 568.8 else 0.0247)) ** 2) \
        + 0.286 * math.exp(-0.5 * ((l - 530.9) * (0.0613 if l < 530.9 else 0.0322)) ** 2)
    z = 1.217 * math.exp(-0.5 * ((l - 437.0) * (0.0845 if l < 437.0 else 0.0278)) ** 2) \
        + 0.681 * math.exp(-0.5 * ((l - 459.0) * (0.0385 if l < 459.0 else 0.0725)) ** 2)
    return x, y, z

def planck(l, T=5772.0):
    """太陽の光の近似：温度 5772K の黒体（吸収線は入れない）。"""
    lm = l * 1e-9
    return 1.0 / (lm ** 5 * (math.exp(1.4387769e-2 / (lm * T)) - 1.0))

def rayleigh_tau(l, p_hpa=1013.25):
    """空気の分子による散乱の光学的厚さ（Bodhaine et al. 1999 の式 30、海面・乾燥空気、CO2 360ppm）。"""
    u = l / 1000.0
    t = 0.0021520 * (1.0455996 - 341.29061 * u ** -2 - 0.90230850 * u ** 2) / (1 + 0.0027059889 * u ** -2 - 85.968563 * u ** 2)
    return t * p_hpa / 1013.25

# オゾンの吸収断面積（cm²、×1e-21、室温付近、Chappuis 帯）。山 603nm で 5.23（Wikipedia の値）。ほかは近似（測定の表から写したものではない、README）。
O3 = {380: 0.0, 400: 0.01, 420: 0.03, 440: 0.10, 460: 0.20, 480: 0.45, 500: 1.0, 520: 1.8, 540: 3.0, 560: 3.9, 575: 4.7,
      590: 4.8, 603: 5.23, 620: 4.4, 640: 3.0, 660: 2.0, 680: 1.4, 700: 0.85, 720: 0.6, 740: 0.45, 760: 0.35, 780: 0.3}
def o3_sigma(l):
    ks = sorted(O3)
    for a, b in zip(ks, ks[1:]):
        if a <= l <= b:
            return (O3[a] + (O3[b] - O3[a]) * (l - a) / (b - a)) * 1e-21
    return 0.0

def ozone_tau(l, du=300.0):
    return o3_sigma(l) * du * 2.6867e16

def aerosol_tau(l, beta=0.05, alpha=1.3):
    """晴れた日のちり（Ångström の式：τ = β λ^−α、λ は µm）。β 0.05（澄んだ日）。"""
    return beta * (l / 1000.0) ** -alpha

def airmass(h_deg):
    """大気を通る道のりの長さ（Kasten & Young 1989、見かけの高さ h）。"""
    return 1.0 / (math.sin(math.radians(h_deg)) + 0.50572 * (h_deg + 6.07995) ** -1.6364)

# 月の反射の割合：波長にほぼ比例して増える（Thejll ほか 2014 が引く GOME の結果）。傾き k は、太陽より B−V が 0.25 等赤い
# ように決める（下の fit_k）。B・V の通り道は中心 445・551nm、σ 40・37nm のガウスで近似。
def band(l, c, s):
    return math.exp(-0.5 * ((l - c) / s) ** 2)

def bv(spec):
    b = sum(spec(l) * band(l, 445, 40) for l in L)
    v = sum(spec(l) * band(l, 551, 37) for l in L)
    return -2.5 * math.log10(b / v)

def fit_k(target=0.25):
    lo, hi = 0.0, 5.0
    sun = bv(planck)
    for _ in range(60):
        k = (lo + hi) / 2
        d = bv(lambda l: planck(l) * (1 + k * (l - 550) / 550)) - sun
        lo, hi = (k, hi) if d < target else (lo, k)
    return (lo + hi) / 2

K = fit_k()
def moon_reflect(l):
    return 1 + K * (l - 550) / 550

def xyz(spec):
    X = Y = Z = 0.0
    for l in L:
        s = spec(l)
        x, y, z = cmf(l)
        X += s * x; Y += s * y; Z += s * z
    return X, Y, Z

M_SRGB = [[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]]
BRAD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]]
D65 = (0.95047, 1.0, 1.08883)
def mul(m, v):
    return [sum(m[i][j] * v[j] for j in range(3)) for i in range(3)]
def inv3(m):
    a, b, c = m[0]; d, e, f = m[1]; g_, h, i = m[2]
    det = a * (e * i - f * h) - b * (d * i - f * g_) + c * (d * h - e * g_)
    return [[(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
            [(f * g_ - d * i) / det, (a * i - c * g_) / det, (c * d - a * f) / det],
            [(d * h - e * g_) / det, (b * g_ - a * h) / det, (a * e - b * d) / det]]
BRAD_I = inv3(BRAD)

def adapt(XYZ, white):
    """Bradford の色順応：white（XYZ）を D65 の白にそろえる。"""
    s, d = mul(BRAD, white), mul(BRAD, D65)
    c = mul(BRAD, XYZ)
    return mul(BRAD_I, [c[i] * d[i] / s[i] for i in range(3)])

def gamma(c):
    c = max(0.0, c)
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

def srgb(XYZ):
    lin = mul(M_SRGB, XYZ)
    m = max(lin)
    lin = [max(0.0, v) / m for v in lin]  # 明るさは別に扱う：いちばん強い成分を 1 にそろえる（色合いだけ）
    return [round(255 * gamma(v)) for v in lin]

def moon_spec(h, beta, du):
    m = airmass(h)
    return lambda l: planck(l) * moon_reflect(l) * math.exp(-m * (rayleigh_tau(l) + ozone_tau(l, du) + aerosol_tau(l, beta)))

def table(beta=0.05, du=300.0, white="sun"):
    """white：sun＝大気の外の太陽の光を白に（昼の目）、moon90＝天頂の月の光を白に（月の光に慣れた目）。"""
    above = xyz(lambda l: planck(l) * moon_reflect(l))
    Yw = above[1]
    W = xyz(planck) if white == "sun" else xyz(moon_spec(90, beta, du))
    W = [v / W[1] for v in W]
    rows = []
    for h in [0, 2, 5, 10, 20, 30, 60, 90]:
        m = airmass(h)
        X, Y, Z = xyz(moon_spec(h, beta, du))
        rel = Y / Yw
        XYZ = adapt([X / Yw, Y / Yw, Z / Yw], W)
        s = XYZ[0] + XYZ[1] + XYZ[2]
        rows.append((h, m, XYZ[0] / s, XYZ[1] / s, srgb(XYZ), rel))
    return rows

if __name__ == "__main__":
    print(f"月の反射の傾き k = {K:.3f}（λ 550nm で 1、700nm で {moon_reflect(700):.3f}、400nm で {moon_reflect(400):.3f}）")
    print(f"太陽（5772K の黒体）の B−V（近似の通り道） = {bv(planck):.3f}")
    for white, beta in (("moon90", 0.05), ("moon90", 0.10), ("sun", 0.05)):
        name = "天頂の月を白に" if white == "moon90" else "大気の外の太陽の光を白に"
        print(f"\n### 白の基準：{name}、β = {beta}（オゾン 300 DU、海面）")
        print("| 高さ | 道のり（大気の厚さの何倍） | x | y | sRGB | 16進 | 明るさ（大気の外＝1） |")
        print("|---|---|---|---|---|---|---|")
        for h, m, x, y, rgb, rel in table(beta, white=white):
            print(f"| {h}° | {m:.2f} | {x:.4f} | {y:.4f} | {rgb[0]}, {rgb[1]}, {rgb[2]} | #{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x} | {rel:.3f} |")
