"""cloud_data.py で集めた日ごとの応答を、日の入り前後の時系列にして並べる（#537、11/27）。
python3 research/sky-beta2/tools/cloud_data_view.py <cloud-data フォルダ> <出力 png> [出力 json]

- 晴天指数 k ＝ 全天日射 ÷ 晴天の全天日射。晴天の全天日射は Haurwitz の式 1098·cosZ·exp(−0.057/cosZ)（W/m²）を、
  11/13 の 12〜15 時の衛星の値（高知）に合わせて 1 つの倍率で校正した（**晴天の基準の仮置き**。エアロゾル・水蒸気の日ごとの差は入らない）
- 衛星の時刻の印が「その 10 分の始まり」か「終わり」かを、11/13 の k が平らになる方で選ぶ（両方を出して比べる）
- 太陽の高さ 10° 未満（MIN_ALT）は k を描かない（Haurwitz の式は低い太陽で合わず、11/18 の地上で k 1.6 などありえない値が出た）
- 晴天の基準は点ごとの太陽の高さで（西の点は高知より太陽が高い）
- 地上：気象庁の高知の 1 時間ごとの全天日射量（MJ/m² → 直前 1 時間の平均 W/m²）と日照時間、10 分ごとの日照時間
- 予報の雲：Open-Meteo Historical Forecast（各回の初めの数時間をつないだもの。前日の予報ではない）の下層・中層・上層の雲量
太陽の位置は NOAA の簡易式（大気の屈折なし）。"""
import json, math, os, re, sys, datetime as dt
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

for f in font_manager.findSystemFonts():
    if "NotoSansCJK-Regular" in f:
        font_manager.fontManager.addfont(f)
plt.rcParams["font.family"] = "Noto Sans CJK JP"

root, out_png = sys.argv[1], sys.argv[2]
out_json = sys.argv[3] if len(sys.argv) > 3 else None
LAT, LON = 33.5667, 133.5483
MIN_ALT = float(os.environ.get("MIN_ALT", "10"))  # これより低い太陽では k を描かない（晴天の式が低い太陽で合わない）


def sun_alt(t: dt.datetime, lat=LAT, lon=LON) -> float:
    """t は日本時間の naive datetime。NOAA の簡易式。"""
    u = t - dt.timedelta(hours=9)
    jd = (u - dt.datetime(2000, 1, 1, 12)).total_seconds() / 86400 + 2451545.0
    T = (jd - 2451545.0) / 36525
    L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    C = (1.914602 - T * (0.004817 + 0.000014 * T)) * math.sin(math.radians(M)) + (0.019993 - 0.000101 * T) * math.sin(math.radians(2 * M)) + 0.000289 * math.sin(math.radians(3 * M))
    lam = L0 + C - 0.00569 - 0.00478 * math.sin(math.radians(125.04 - 1934.136 * T))
    eps = 23.439291 - 0.0130042 * T + 0.00256 * math.cos(math.radians(125.04 - 1934.136 * T))
    dec = math.asin(math.sin(math.radians(eps)) * math.sin(math.radians(lam)))
    y = math.tan(math.radians(eps / 2)) ** 2
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    L0r, Mr = math.radians(L0), math.radians(M)
    eot = 4 * math.degrees(y * math.sin(2 * L0r) - 2 * e * math.sin(Mr) + 4 * e * y * math.sin(Mr) * math.cos(2 * L0r) - 0.5 * y * y * math.sin(4 * L0r) - 1.25 * e * e * math.sin(2 * Mr))
    tst = (u.hour * 60 + u.minute + u.second / 60 + eot + 4 * lon) % 1440
    ha = math.radians(tst / 4 - 180)
    cz = math.sin(math.radians(lat)) * math.sin(dec) + math.cos(math.radians(lat)) * math.cos(dec) * math.cos(ha)
    return math.degrees(math.asin(max(-1, min(1, cz))))


def clear_ghi(t, scale, lat=LAT, lon=LON):
    h = sun_alt(t, lat, lon)
    cz = math.sin(math.radians(h))
    return scale * 1098 * cz * math.exp(-0.057 / cz) if h > 0 else 0.0


def mean_clear(t_end, minutes, scale):
    """t_end までの minutes 分の晴天の全天日射の平均（1 分刻み）。"""
    return float(np.mean([clear_ghi(t_end - dt.timedelta(minutes=m + 0.5), scale) for m in range(minutes)]))


def jma_table(html):
    rows = []
    for r in re.findall(r"<tr class=\"mtx\"[^>]*>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        if cells:
            rows.append(cells)
    head = re.findall(r"<th[^>]*>(.*?)</th>", html, re.S)
    return rows, [re.sub(r"<[^>]+>", "", h).strip() for h in head]


def num(s):
    try:
        return float(re.sub(r"[)\]\s]", "", s))
    except ValueError:
        return None


days = sorted(d for d in os.listdir(root) if re.match(r"\d{4}-\d\d-\d\d$", d))
LABEL = {"2026-11-13": "11/13 晴れ（基準）", "2026-11-04": "11/04 曇り", "2026-11-17": "11/17 雨", "2026-11-18": "11/18 薄曇り候補", "2026-11-15": "11/15 西だけ晴れ候補"}
order = [d for d in ["2026-11-13", "2026-11-04", "2026-11-18", "2026-11-15", "2026-11-17"] if d in days] + [d for d in days if d not in LABEL]


def load(d, name):
    return json.load(open(os.path.join(root, d, name)))


# 晴天の倍率と、衛星の時刻の印の取り方を 11/13 で決める
def sat_series(d, pt, shift_min):
    s = load(d, f"satellite-{pt}.json")["hourly"]
    out = []
    for t, v in zip(s["time"], s["shortwave_radiation"]):
        tt = dt.datetime.fromisoformat(t)
        mid = tt + dt.timedelta(minutes=shift_min)  # この 10 分の真ん中
        out.append((tt, mid, v))
    return out


base = "2026-11-13"
fits = {}
for name, shift in [("印＝10 分の終わり", -5), ("印＝10 分の始まり", +5)]:
    ser = [(mid, v) for _, mid, v in sat_series(base, "kochi", shift) if v is not None and 12 <= mid.hour < 15]
    sc = np.median([v / clear_ghi(mid, 1.0) for mid, v in ser])
    ks = [v / clear_ghi(mid, sc) for _, mid, v in sat_series(base, "kochi", shift) if v is not None and sun_alt(mid) >= 5]
    late = [v / clear_ghi(mid, sc) for _, mid, v in sat_series(base, "kochi", shift) if v is not None and 5 <= sun_alt(mid) < 15]
    fits[name] = {"scale": float(sc), "shift": shift, "k_sd_all": float(np.std(ks)), "k_mean_low_sun": float(np.mean(late)) if late else None}
best = min(fits, key=lambda n: abs((fits[n]["k_mean_low_sun"] or 9) - 1))
SC, SHIFT = fits[best]["scale"], fits[best]["shift"]

fig, axes = plt.subplots(len(order), 1, figsize=(11, 3.3 * len(order)), sharex=False)
summary = {"clear_sky_fit": fits, "chosen": best, "days": {}}
colors = {"kochi": "#d33", "west25": "#e80", "west50": "#bb0", "west100": "#3a3", "west200": "#36c"}
for ax, d in zip(axes, order):
    man = load(d, "manifest.json")
    day = dt.date.fromisoformat(d)
    t0, t1 = dt.datetime.combine(day, dt.time(12)), dt.datetime.combine(day, dt.time(18, 30))
    # 日の入り（高さ 0°、屈折なし）
    ss = next(t0 + dt.timedelta(minutes=m) for m in range(0, 400) if sun_alt(t0 + dt.timedelta(minutes=m)) <= 0)
    t5 = next(t0 + dt.timedelta(minutes=m) for m in range(0, 400) if sun_alt(t0 + dt.timedelta(minutes=m)) <= MIN_ALT)
    ds = {"sunset_geometric": ss.strftime("%H:%M"), "sun5": t5.strftime("%H:%M"), "points": {}}
    for p in man["points"]:
        pt = p["name"]
        xs, ks = [], []
        miss = 0
        for tt, mid, v in sat_series(d, pt, SHIFT):
            if not (t0 <= mid <= t1):
                continue
            if v is None:
                miss += 1
                continue
            # 晴天の基準は、その点の太陽の高さで（西 200 km では太陽が約 8 分遅く沈む）
            if sun_alt(mid, p["lat"], p["lon"]) < MIN_ALT:
                continue
            xs.append(mid)
            ks.append(v / clear_ghi(mid, SC, p["lat"], p["lon"]))
        ax.plot(xs, ks, "-o", ms=2.5, lw=1.2, color=colors.get(pt, "k"), label=("高知" if pt == "kochi" else pt.replace("west", "西 ") + " km") + "（衛星）")
        last = [k for x, k in zip(xs, ks) if x >= t5 - dt.timedelta(minutes=60)]
        ds["points"][pt] = {"k_last_hour_before_min_alt": round(float(np.mean(last)), 2) if last else None, "missing_12_1830": miss}
    # 地上 1 時間
    html = open(os.path.join(root, d, "jma-hourly-kochi.html"), encoding="utf-8").read()
    rows, head = jma_table(html)
    gx, gk, sun_h = [], [], {}
    for r in rows:
        h = num(r[0])
        if h is None:
            continue
        rad = num(r[11]) if len(r) > 11 else None
        sunv = num(r[10]) if len(r) > 10 else None
        sun_h[int(h)] = sunv
        te = dt.datetime.combine(day, dt.time(0)) + dt.timedelta(hours=h)
        mid = te - dt.timedelta(minutes=30)
        if rad is not None and t0 <= mid <= t1 and sun_alt(mid) >= MIN_ALT:
            gx.append(mid)
            gk.append(rad * 1e6 / 3600 / mean_clear(te, 60, SC))
    ax.plot(gx, gk, "s", ms=7, mfc="none", mec="k", label="高知（地上 1 時間）")
    ds["ground_k"] = {x.strftime("%H:%M"): round(k, 2) for x, k in zip(gx, gk)}
    ds["ground_sunshine_h"] = {k: v for k, v in sun_h.items() if 12 <= k <= 19}
    # 10 分の日照（高知）：上端に印
    h10 = open(os.path.join(root, d, "jma-10min-kochi.html"), encoding="utf-8").read()
    r10, _ = jma_table(h10)
    sx = []
    for r in r10:
        m = re.match(r"(\d+):(\d+)", r[0])
        if not m:
            continue
        te = dt.datetime.combine(day, dt.time(0)) + dt.timedelta(hours=int(m.group(1)), minutes=int(m.group(2)))
        s = num(r[-1])
        if s is not None and s > 0 and t0 <= te <= t1:
            sx.append((te - dt.timedelta(minutes=5), s))
    for x, s in sx:
        ax.plot([x], [1.32], "v", color="#f90", ms=3 + s * 0.6)
    ds["sunshine_10min_count"] = len(sx)
    # 予報の雲（高知）：下の帯
    f = load(d, "forecast-clouds-kochi.json")["hourly"]
    for t, lo, mi, hi in zip(f["time"], f["cloud_cover_low"], f["cloud_cover_mid"], f["cloud_cover_high"]):
        tt = dt.datetime.fromisoformat(t)
        if t0 <= tt <= t1:
            for j, (v, c) in enumerate([(lo, "#555"), (mi, "#888"), (hi, "#bbb")]):
                if v is not None:
                    ax.bar(tt, v / 100 * 0.12, width=0.03, bottom=-0.45 + j * 0.13, color=c, align="center")
    ds["forecast_cloud_kochi_17"] = {k: f[k][17] for k in ("cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high")}
    ax.axvline(t5, color="#999", ls=":", lw=1)
    ax.axvline(ss, color="#555", ls="--", lw=1)
    ax.axhline(1, color="#ccc", lw=0.8)
    ax.set_xlim(t0, t1)
    ax.set_ylim(-0.5, 1.4)
    ax.set_title(f"{LABEL.get(d, d)}　日の入りの方位 {man['sunset_azimuth_deg']}°　（点線：太陽 {MIN_ALT:.0f}°、破線：日の入り）", fontsize=11, loc="left")
    ax.set_ylabel("晴天指数 k")
    ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%H:%M"))
    ax.text(t0, -0.47, "予報の雲量（高知）下・中・上層", fontsize=7, va="bottom", color="#444")
    ax.text(t0, 1.34, "▼ 高知の 10 分日照", fontsize=7, color="#c70")
    summary["days"][d] = ds
axes[0].legend(fontsize=7, ncol=4, loc="lower left", bbox_to_anchor=(0.0, 0.05))
fig.suptitle(f"高知と日の入りの方位の 4 点の晴天指数（衛星 10 分・地上 1 時間）　晴天の基準：Haurwitz × {SC:.3f}（11/13 で校正、{best}）", fontsize=10)
fig.tight_layout()
fig.savefig(out_png, dpi=110)
if out_json:
    json.dump(summary, open(out_json, "w"), ensure_ascii=False, indent=1, default=str)
print(json.dumps({"fits": fits, "chosen": best}, ensure_ascii=False))
for d, v in summary["days"].items():
    print(d, v["sunset_geometric"], "k(1h before MIN_ALT):", {p: x["k_last_hour_before_min_alt"] for p, x in v["points"].items()}, "ground:", v["ground_k"], "10min sun:", v["sunshine_10min_count"], "fc17:", v["forecast_cloud_kochi_17"])
