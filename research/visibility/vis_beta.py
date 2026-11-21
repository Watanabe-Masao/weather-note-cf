# 視程 → 空気の濁り（β）→ 月の色と明るさ、の計算の見本（2026-11-21、画面には使っていない）。
#
# 1. 視程 V（km）から、地上の光の弱まり方 σ（1/km）：Koschmieder の式 σ = 3.912 / V（コントラスト 2% の目）。
# 2. 空気の分子の分（550nm、海面で約 0.0116 /km）を引いた残りを、ちり（エアロゾル）の分 σa とする。
# 3. ちりが地上から高さ H（仮に 1.2 km）まで同じ濃さで続くとみて、空全体の厚さ τ550 = σa × H。
# 4. β = τ550 × 0.55^α（Ångström、α 1.3）。月の色は MA-01 の moon_color.py（同じ大気の式）で。
# どれも仮定を含む（H、α、雨や霧の水滴もちりとして数えてしまう）。CAMS の AOD（直接の τ550）と比べるための見本。
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "moon-appearance"))
import moon_color as mc

RAYLEIGH_550 = 0.0116  # /km、海面
H_KM = 1.2
ALPHA = 1.3

def beta_from_visibility(v_km):
    sigma = 3.912 / v_km
    sa = max(0.0, sigma - RAYLEIGH_550)
    tau = sa * H_KM
    return sigma, tau, tau * 0.55 ** ALPHA

print("視程 km | σ /km | τ550 | β")
rows = []
for v in (20, 15, 10, 8, 6):
    s, t, b = beta_from_visibility(v)
    rows.append((v, b))
    print(f"{v:>5} | {s:.3f} | {t:.2f} | {b:.3f}")

print("\n月の色（白の基準：天頂の月・β 0.05、明るさをそろえて色だけ）と、大気の外を 1 とした明るさ：高さ 10°・30°")
W = mc.xyz(mc.moon_spec(90, 0.05, 300.0))
W = [v / W[1] for v in W]
above = mc.xyz(lambda l: mc.planck(l) * mc.moon_reflect(l))[1]
for label, b in [("いまの固定 β 0.05", 0.05)] + [(f"視程 {v} km", b) for v, b in rows]:
    out = []
    for h in (10, 30):
        X, Y, Z = mc.xyz(mc.moon_spec(h, b, 300.0))
        rgb = mc.srgb(mc.adapt([X / Y, 1.0, Z / Y], W))
        m = max(rgb)
        hexc = "".join(f"{max(0, min(255, round(c / m * 255))):02x}" for c in rgb)
        out.append(f"{h}°: #{hexc} 明るさ {Y / above:.2f}")
    print(f"{label:<14} | " + " | ".join(out))
