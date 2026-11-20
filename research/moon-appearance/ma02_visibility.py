"""MA-02：月の見え方（明るさと背景）。物理の量 → 背景との比 → 見え方 の順で計算する。標準ライブラリだけ。
  python3 research/moon-appearance/ma02_visibility.py [/tmp/ma02_pos.json]
MA-01 の moon_color.py（月の光のスペクトル・大気の透過・色の変換）を使う。値の出どころと「推測」は README（MA-02 の節）。
"""
import json
import math
import sys

import moon_color as mc

RAD = math.pi / 180

# ---- 1. 月の表面の輝度（cd/m²）------------------------------------------------------------
def moon_vmag(phase_angle, dist_km=384400.0):
    """月全体の V 等級（Krisciunas & Schaefer 1991 の位相の式）。距離の2乗で直す。"""
    a = abs(phase_angle)
    return -12.73 + 0.026 * a + 4e-9 * a ** 4 + 5 * math.log10(dist_km / 384400.0)

def moon_luminance0(phase_angle, fraction, dist_km=384400.0):
    """大気の外での、光っている部分の平均の輝度（cd/m²）。
    照度 E = 2.54e-6 × 10^(−0.4 m) lx（0 等星の照度。推測：よく使われる換算）を、光っている部分の立体角で割る。"""
    E = 2.54e-6 * 10 ** (-0.4 * moon_vmag(phase_angle, dist_km))
    omega = math.pi * (1737.4 / dist_km) ** 2
    return E / (omega * max(fraction, 1e-3)), E

def transmission_Y(h, beta=0.05):
    """大気を通ったあとの明るさの割合（MA-01 の大気、目の感度で重み付け）。"""
    above = mc.xyz(lambda l: mc.planck(l) * mc.moon_reflect(l))[1]
    return mc.xyz(mc.moon_spec(max(h, 0.0), beta, 300.0))[1] / above

# ---- 2. 空の背景の輝度（cd/m²）------------------------------------------------------------
CIE = {12: (-1.0, -0.32, 10.0, -3.0, 0.45), 1: (4.0, -0.70, 0.0, -1.0, 0.0)}  # CIE 標準一般天空 12（晴れ）・1（曇り）

def cie_rel(Z, chi, Zs, t):
    a, b, c, d, e = CIE[t]
    phi = lambda z: 1 + a * math.exp(b / max(math.cos(z), 1e-3))
    f = lambda x: 1 + c * (math.exp(d * x) - math.exp(d * math.pi / 2)) + e * math.cos(x) ** 2
    return f(chi) * phi(Z) / (f(Zs) * phi(0.0))

def angle_between(alt1, az1, alt2, az2):
    v = lambda h, a: (math.cos(h * RAD) * math.sin(a * RAD), math.cos(h * RAD) * math.cos(a * RAD), math.sin(h * RAD))
    p, q = v(alt1, az1), v(alt2, az2)
    return math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(p, q)))))

def diffuse_clear(hs):
    """晴れた空の、空だけからの水平面照度（lx）。推測の式：日の出入り 400 lx、高い太陽で 1〜2 万 lx に合わせた。"""
    return 400.0 + 15000.0 * max(math.sin(hs * RAD), 0.0) ** 0.6

def sky_day(hs, sun_az, h, az, t=12):
    """太陽が地平線より上：CIE の分布を、水平面照度が diffuse_clear になるように絶対値にする。"""
    Zs = (90 - max(hs, 0.5)) * RAD
    n, E = 24, 0.0
    for i in range(n):
        Z = (i + 0.5) / n * math.pi / 2
        for j in range(2 * n):
            A = (j + 0.5) / (2 * n) * 2 * math.pi
            chi = angle_between(90 - Z / RAD, A / RAD, max(hs, 0.5), sun_az)
            E += cie_rel(Z, chi, Zs, t) * math.cos(Z) * math.sin(Z) * (math.pi / 2 / n) * (math.pi / n)
    Lz = diffuse_clear(hs) / E
    chi = angle_between(max(h, 0.5), az, max(hs, 0.5), sun_az)
    return Lz * cie_rel((90 - max(h, 0.5)) * RAD, chi, Zs, t)

TWILIGHT = [(0, 400.0), (-6, 3.4), (-12, 0.008), (-18, 6e-4)]  # 水平面照度（lx）

def sky_twilight(hs):
    """薄明：水平面照度を対数で補間し、空を一様と見て L = E/π（推測）。"""
    for (h1, e1), (h2, e2) in zip(TWILIGHT, TWILIGHT[1:]):
        if h2 <= hs <= h1:
            w = (hs - h1) / (h2 - h1)
            return 10 ** (math.log10(e1) + w * (math.log10(e2) - math.log10(e1))) / math.pi
    return 0.0

def sky_night(phase_angle):
    """夜：街の明かりの空（高知市を 18.5 等/平方秒角と仮定）＋ 月の光が散った分（満月で 18 等/平方秒角、位相で弱める）。"""
    city = 10.8e4 * 10 ** (-0.4 * 18.5)
    a = abs(phase_angle)
    moon = 10.8e4 * 10 ** (-0.4 * 18.0) * 10 ** (-0.4 * (0.026 * a + 4e-9 * a ** 4))
    return city + moon

def sky_luminance(hs, sun_az, h, az, phase_angle):
    day = sky_day(hs, sun_az, h, az) if hs >= 0 else 0.0
    tw = sky_twilight(hs) if -18 <= hs < 0 else 0.0
    return max(day, tw) + sky_night(phase_angle)

# ---- 3. 見え方 ----------------------------------------------------------------------------
# 空の色（xy、推測）：昼の晴れ空（青白、約 8000K）・薄明（中間）・夜の街の空（少し黄）
SKY_XY = {"day": (0.290, 0.300), "twilight": (0.300, 0.300), "night": (0.360, 0.360)}

def xy_to_XYZ(x, y, Y):
    return [x / y * Y, Y, (1 - x - y) / y * Y]

def uv(XYZ):
    X, Y, Z = XYZ
    d = X + 15 * Y + 3 * Z
    return (4 * X / d, 9 * Y / d)

def chroma_uv(XYZ, white):
    (u, v), (uw, vw) = uv(XYZ), uv(white)
    return math.hypot(u - uw, v - vw)

def appearance(sunAlt, sunAz, moonAlt, moonAz, phaseAngle, fraction, moonKm, beta=0.05, cloud="clear"):
    L0, E0 = moon_luminance0(phaseAngle, fraction, moonKm)
    T = transmission_Y(moonAlt, beta) if moonAlt > -0.5 else 0.0
    Lm = L0 * T
    Lb = sky_luminance(sunAlt, sunAz, moonAlt, moonAz, phaseAngle)
    if cloud == "overcast":
        Lm, Lb = 0.0, Lb * 0.3  # 厚い雲：月は見えない（推測）
    C = Lm / Lb
    # 色の濃さ：見分けの境（ウェーバー比 約 0.02、推測）より下は 0。C/(C+1) で 0〜1。
    strength = 0.0 if C < 0.02 else C / (C + 1)
    # 明るさ（背景に対して）：スティーブンスの明るさの指数 1/3（推測：よく引かれる値）
    bright = (1 + C) ** (1 / 3)
    # 赤み：月の光（MA-01 の色）と手前の空の光（Lb）を足した色が、白から「赤い向き」へどれだけ離れているか（u'v'）。
    # 赤い向き・物差し：夜の目（白＝天頂の月）で見た、高さ 5° の月の色（＝ 1）。青い側へずれた分は 0。
    X, Y, Z = mc.xyz(mc.moon_spec(max(moonAlt, 0.0), beta, 300.0))
    moon_xyz = [X / Y * Lm, Lm, Z / Y * Lm] if Y > 0 else [0, 0, 0]
    key = "day" if sunAlt >= 0 else ("twilight" if sunAlt >= -12 else "night")
    sky_xyz = xy_to_XYZ(*SKY_XY[key], Lb)
    mix = [a + b for a, b in zip(moon_xyz, sky_xyz)]
    Wz = mc.xyz(mc.moon_spec(90, beta, 300.0))
    wn = [Wz[0] / Wz[1], 1.0, Wz[2] / Wz[1]]
    # 目の白：昼（太陽 0° 以上）は D65、夜（−6° 以下）は天頂の月、その間は直線でつなぐ（推測）
    w = min(1.0, max(0.0, -sunAlt / 6.0))
    white = [mc.D65[i] * (1 - w) + wn[i] * w for i in range(3)]
    R5 = mc.xyz(mc.moon_spec(5, beta, 300.0))
    (ur, vr), (uw0, vw0) = uv(R5), uv(wn)
    dr = (ur - uw0, vr - vw0)
    ref = math.hypot(*dr)
    (um, vm), (uw, vw) = uv(mix), uv(white)
    red = max(0.0, ((um - uw) * dr[0] + (vm - vw) * dr[1]) / ref / ref)
    return dict(L0=L0, E0=E0, T=T, Lm=Lm, Lb=Lb, C=C, strength=strength, bright=bright, red=red,
                regime="明所" if Lb >= 5 else ("薄明視" if Lb >= 0.005 else "暗所"))

def fmt(v):
    return f"{v:.3g}" if v < 1e4 else f"{v:.2e}"

if __name__ == "__main__":
    pos = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ma02_pos.json"))
    print("## 代表例（高知、2026-11-20、晴れ β 0.05）\n")
    print("| 時刻 | 太陽の高さ | 月の高さ | 離角 | 輝面比 | 月の輝度（大気の外） | 透過 | 月の輝度（地上） | 背景の輝度 | 目の状態（背景） | C | 色の濃さ | 明るさ | 赤み |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for p in pos:
        r = appearance(p["sunAlt"], p["sunAz"], p["moonAlt"], p["moonAz"], p["phaseAngle"], p["fraction"], p["moonKm"])
        print(f"| {p['label']} | {p['sunAlt']}° | {p['moonAlt']}° | {p['sep']}° | {p['fraction']:.2f} | {fmt(r['L0'])} | {r['T']:.3g} | {fmt(r['Lm'])} | {fmt(r['Lb'])} | {r['regime']} | {fmt(r['C'])} | {r['strength']:.2f} | {r['bright']:.2f} | {r['red']:.2f} |")
    print("\n## 表（離角 120°、輝面比 0.77〔位相角 57°〕、距離 38万km、晴れ β 0.05）：色の濃さ / 赤み\n")
    moons = [0, 2, 5, 10, 20, 30, 60]
    print("| 太陽の高さ＼月の高さ | " + " | ".join(f"{m}°" for m in moons) + " |")
    print("|---|" + "---|" * len(moons))
    for hs in [40, 20, 10, 5, 0, -3, -6, -9, -12, -18]:
        cells = []
        for hm in moons:
            # 太陽は西（方位 245°）、月は東寄りで離角がほぼ 120° になる方位に置く
            az = 245 - 180 + 60
            r = appearance(hs, 245, hm, az, 57, 0.77, 380000)
            cells.append(f"{r['strength']:.2f} / {r['red']:.2f}")
        print(f"| {hs}° | " + " | ".join(cells) + " |")
    print("\n## 離角による違い（太陽 30°・月 30°、晴れ）\n")
    print("| 離角 | 背景の輝度 | C | 色の濃さ |\n|---|---|---|---|")
    for sep in [30, 60, 90, 120, 150, 180]:
        # 同じ高さ 30° で方位を変えて離角を作る
        best = min(range(0, 360), key=lambda d: abs(angle_between(30, 180, 30, 180 + d) / RAD - sep))
        r = appearance(30, 180, 30, 180 + best, 180 - sep, (1 + math.cos((180 - sep) * RAD)) / 2, 380000)
        print(f"| {sep}° | {fmt(r['Lb'])} | {fmt(r['C'])} | {r['strength']:.2f} |")
