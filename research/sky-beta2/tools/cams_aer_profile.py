"""CAMS のエアロゾルの高度分布（532 nm の消散係数 aerext532）→ β2 の Bruneton に入れる高さの分布（#537、11/27）。

使い方（ADS のアカウントと鍵が要る。この作業環境からは ADS に届かないので、手元の PC で）：
  pip install cdsapi eccodes numpy
  # ~/.cdsapirc に ADS の url と key（https://ads.atmosphere.copernicus.eu/how-to-api）
  python3 cams_aer_profile.py fetch 2026-11-13 out.grib          # 00 UTC の予報、6・9 時間先（15・18 時 JST）
  python3 cams_aer_profile.py profile out.grib 33.56 133.53 > profile.json
  python3 cams_aer_profile.py blend profile.json 17:10 17:35 > blend.json   # 15 時と 18 時を同じ高さにそろえて時刻で補間

fetch：cams-global-atmospheric-composition-forecasts から、高知のまわり（33.25〜33.75°N、133.25〜133.75°E）の
  aerext532（モデル 137 層）と、高さを出すための気温・比湿（同じ層）・地上気圧の対数（lnsp、モデル層 1 だけ）を GRIB で取る。
  配布条件（11/27 渡辺さんが ADS のカタログで照合）：変数名は aerosol_extinction_coefficient_532nm、この日の高度別は 3 時間ごと
  （8 時間先は無い）→ 6・9 時間先（15・18 時 JST）。lnsp は別の取得（層 1）にして、2 つの GRIB をつなぐ。
profile：いちばん近い格子の列で、層ごとの高さ（静力学の式で、半層の気圧 p = a + b·ps から）と消散係数から、
  - 532 nm の光学的厚さ（層の消散係数 × 層の厚さの和）
  - 地表〜1 km、1〜3 km、3 km より上の寄与の割合
  - Bruneton の 2 層の形（高さ W で最大、下は exp((h−W)/S1)、上は exp(−(h−W)/S2)）に合わせた W・S1・S2（km）
  を JSON で出す。取得した時刻（予報の初期時刻と何時間先か）・格子・高さの基準（地表からの高さ）も書く。
  消散係数はモデルの推定で、観測ではない。
"""
import json, math, sys

import numpy as np

AREA = [33.75, 133.25, 33.25, 133.75]  # N, W, S, E


def fetch(date: str, out: str):
    import cdsapi

    c = cdsapi.Client()
    base = {"date": f"{date}/{date}", "type": "forecast", "time": "00:00", "leadtime_hour": ["6", "9"], "area": AREA, "data_format": "grib"}  # 06・09 UTC ＝ 15・18 時 JST
    c.retrieve(
        "cams-global-atmospheric-composition-forecasts",
        {**base, "variable": ["aerosol_extinction_coefficient_532nm", "temperature", "specific_humidity"], "model_level": [str(i) for i in range(1, 138)]},
        out + ".ml",
    )
    c.retrieve("cams-global-atmospheric-composition-forecasts", {**base, "variable": ["logarithm_of_surface_pressure"], "model_level": ["1"]}, out + ".lnsp")
    with open(out, "wb") as o:  # GRIB はつなげても読める
        for part in (out + ".ml", out + ".lnsp"):
            o.write(open(part, "rb").read())


def heights(a, b, ps, t, q):
    """半層の係数 a・b（138 個）、地上気圧 ps（Pa）、層の気温 t・比湿 q（上から 137 層）→ 層の中心の地表からの高さ（m、上から）と層の厚さ（m）。"""
    Rd, g = 287.06, 9.80665
    ph = a + b * ps  # 半層の気圧（上から）
    tv = t * (1 + 0.609133 * q)
    z_half = np.zeros(len(ph))
    for k in range(len(t) - 1, -1, -1):  # 下から積み上げる
        lo, hi = ph[k + 1], max(ph[k], 0.1)
        z_half[k] = z_half[k + 1] + Rd * tv[k] / g * math.log(lo / hi)
    dz = z_half[:-1] - z_half[1:]
    zc = 0.5 * (z_half[:-1] + z_half[1:])
    return zc, dz


def fit_two_layer(zc, ext, dz):
    """消散係数の縦の分布に、Bruneton の 2 層の形（高さ W で 1、下 exp((h−W)/S1)、上 exp(−(h−W)/S2)）を合わせる。
    合わせ方：地表〜6 km の 100 m ごとの分布（全体の光学的厚さで割ったもの）の二乗誤差がいちばん小さい W・S1・S2 を、格子で探す。"""
    grid = np.arange(50, 6000, 100.0)
    obs = np.interp(grid, zc[::-1], ext[::-1])
    obs = obs / max(obs.sum(), 1e-12)
    best = None
    for W in np.arange(0, 4001, 100.0):
        for S1 in [200, 400, 700, 1000, 1500, 2500]:
            for S2 in [300, 500, 700, 1000, 1300, 1700, 2200, 3000, 4000, 6000]:
                m = np.where(grid < W, np.exp((grid - W) / S1), np.exp(-(grid - W) / S2))
                m = m / m.sum()
                e = float(((m - obs) ** 2).sum())
                if best is None or e < best[0]:
                    best = (e, W, S1, S2)
    return {"W_km": best[1] / 1000, "S1_km": best[2] / 1000, "S2_km": best[3] / 1000, "fit_error": best[0]}


def two_layer(z, W, S1, S2):
    return np.where(z < W, np.exp((z - W) / S1), np.exp(-(z - W) / S2))


def fit_fractions(fit):
    z = np.arange(5, 60000, 10.0)
    d = two_layer(z, fit["W_km"] * 1000, fit["S1_km"] * 1000, fit["S2_km"] * 1000)
    s = d.sum()
    return {"0-1km": round(float(d[z < 1000].sum() / s), 3), "1-3km": round(float(d[(z >= 1000) & (z < 3000)].sum() / s), 3), "3km+": round(float(d[z >= 3000].sum() / s), 3)}


def blend(path: str, times):
    """15 時（6 時間先）と 18 時（9 時間先）の分布を、同じ高さ（10 m ごと）にそろえてから時刻で線形補間し、2 層の形に合わせる。
    17:10 は 18 時側に 130/180 ≈ 0.72、17:35 は 155/180 ≈ 0.86 の重み。総 AOD は描くときに別に決める（17:10 は 0.17、17:35 の時刻別は 0.176）。"""
    d = json.load(open(path))
    s = {x["lead_hours"]: x for x in d["steps"]}
    a, b = s[6], s[9]
    grid = np.arange(5, 8000, 10.0)
    prof = lambda x: np.interp(grid, [p["z_m"] for p in x["profile"]], [p["ext_per_km"] for p in x["profile"]])
    res = {"source": d["source"], "grid": d.get("grid"), "from": "6・9 時間先（15・18 時 JST）を同じ高さで線形補間", "times": []}
    for t in times:
        hh, mm = map(int, t.split(":"))
        w = ((hh * 60 + mm) - 15 * 60) / 180
        e = (1 - w) * prof(a) + w * prof(b)
        dz = np.full(len(grid), 10.0)
        fit = fit_two_layer(grid[::-1], e[::-1] / 1000, dz)
        tau = e / 1000 * 10
        fr = {"0-1km": float(tau[grid < 1000].sum() / tau.sum()), "1-3km": float(tau[(grid >= 1000) & (grid < 3000)].sum() / tau.sum()), "3km+": float(tau[grid >= 3000].sum() / tau.sum())}
        res["times"].append({"time": t, "weight_18h": round(w, 3), "fraction_below_8km": {k: round(v, 3) for k, v in fr.items()}, "fit": fit, "fit_fraction": fit_fractions(fit),
                             "kochi_ref_profile_arg": f"{fit['W_km']},{fit['S1_km']},{fit['S2_km']}"})
    print(json.dumps(res, ensure_ascii=False, indent=1))


def profile(path: str, lat: float, lon: float):
    import eccodes

    fields = {}
    meta = {}
    with open(path, "rb") as f:
        while True:
            h = eccodes.codes_grib_new_from_file(f)
            if h is None:
                break
            try:
                name = eccodes.codes_get(h, "shortName")
                lev = eccodes.codes_get(h, "level")
                step = eccodes.codes_get(h, "step")
                lats = eccodes.codes_get_array(h, "latitudes")
                lons = eccodes.codes_get_array(h, "longitudes")
                vals = eccodes.codes_get_values(h)
                i = int(np.argmin((lats - lat) ** 2 + (lons - lon) ** 2))
                fields[(name, step, lev)] = float(vals[i])
                meta.setdefault("grid", [float(lats[i]), float(lons[i])])
                meta.setdefault("dataDate", eccodes.codes_get(h, "dataDate"))
                meta.setdefault("dataTime", eccodes.codes_get(h, "dataTime"))
                if "pv" not in meta and eccodes.codes_get(h, "PVPresent"):
                    meta["pv"] = list(eccodes.codes_get_array(h, "pv"))
            finally:
                eccodes.codes_release(h)
    pv = np.array(meta.pop("pv"))
    n = len(pv) // 2
    a, b = pv[:n], pv[n:]
    out = {"source": "CAMS global forecasts（ADS）aerext532・t・q・lnsp、モデル 137 層。モデルの推定値", "requested": [lat, lon], **meta, "steps": []}
    names = {k[0] for k in fields}
    ext_name = next((x for x in names if "aerext" in x or x == "aerext532"), None)
    for step in sorted({k[1] for k in fields}):
        ps = math.exp(fields[("lnsp", step, 1)])
        levels = range(1, 138)
        t = np.array([fields[("t", step, l)] for l in levels])
        q = np.array([fields[("q", step, l)] for l in levels])
        ext = np.array([fields[(ext_name, step, l)] for l in levels])  # 1/m
        zc, dz = heights(a, b, ps, t, q)
        if not (dz > 0).all():
            raise SystemExit(f"層の厚さが正でない（{step} 時間先）：高さの計算を確かめる")
        tau = ext * dz
        total = float(tau.sum())
        part = lambda lo, hi: float(tau[(zc >= lo) & (zc < hi)].sum() / total) if total > 0 else 0.0
        fit = fit_two_layer(zc, ext, dz)
        fr = {"0-1km": round(part(0, 1000), 3), "1-3km": round(part(1000, 3000), 3), "3km+": round(part(3000, 1e9), 3)}
        out["steps"].append(
            {
                "lead_hours": step,
                "aod532": round(total, 4),
                "fraction": fr,
                "fraction_sum": round(sum(fr.values()), 4),  # 1 になること
                "fit": fit,
                "fit_fraction": fit_fractions(fit),  # 2 層の形で、上空（3 km より上）の寄与が保たれているか
                "column_m": round(float(dz.sum()), 1),
                "profile": [{"z_m": round(float(z), 1), "ext_per_km": round(float(e) * 1000, 5)} for z, e in zip(zc[::-1], ext[::-1]) if z < 8000],
            }
        )
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    if sys.argv[1] == "fetch":
        fetch(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "blend":
        blend(sys.argv[2], sys.argv[3:])
    else:
        profile(sys.argv[2], float(sys.argv[3]), float(sys.argv[4]))
