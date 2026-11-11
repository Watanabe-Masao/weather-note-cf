"""How the previous day and week carry into the feeling — a Bayesian regression and an index.

Reads the CSV from 設定 > 最近との差 β > CSVを書き出す. Each report has the felt sensation (−3…+3),
the place (日なた/日かげ/半々), the wind felt, the sky seen, the station's values at that hour, the
60 daily means before (history_60d) and the 7 days before in detail (d1_… d7_: humidity, sunshine,
radiation, rain, weather).

Model (Bayesian linear regression, conjugate normal-inverse-gamma prior):

    y = X b + e,   e ~ N(0, s2)
    b | s2 ~ N(0, s2 * tau2 * I)      (intercept: wide prior)
    s2 ~ InvGamma(a0, b0)

Features are standardised, so tau (the prior's spread) means the same for each; tau is chosen by
the marginal likelihood (empirical Bayes). The posterior gives each feature's effect with a 95%
credible interval: an effect whose interval spans 0 is not shown by the data yet.

The index is the posterior mean of the linear part: each report's predicted sensation, split into
the contribution of each feature group (the place now / recent temperature / the day before /
the week before / wind / sky). Coefficients are written to --out (JSON) for a later app version.

Out-of-time check: fit on the earliest 70%, predict the latest 30%, against the place-only model.
Model comparison also by log marginal likelihood (higher is better; it already pays for complexity).

    python3 research/bayes_index.py reports.csv --out index.json
    python3 research/bayes_index.py --simulate 240          # made-up reports with lag effects
    python3 research/bayes_index.py reports.csv --sky       # forecast vs seen sky (a separate check)

numpy and scipy only.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys

import numpy as np
from scipy.special import gammaln
from scipy.stats import t as student_t

ALPHA_DEFAULT = 0.8


def running_mean(history, alpha):
    total = have = s = 0.0
    for k, v in enumerate(history):
        w = (1 - alpha) * alpha**k
        total += w
        if v is None:
            continue
        have += w
        s += w * v
    if not total or have / total < 0.8 or not history or history[0] is None:
        return None
    return s / have


def fnum(v):
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def nanmean(vs):
    xs = [v for v in vs if v is not None]
    return sum(xs) / len(xs) if xs else None


SUNNY = ("快晴", "晴")
RAINY = ("雨", "雪", "霧雨")

# Feature groups: name -> list of (feature, how to read it from a parsed report)
GROUPS = {
    "その場（今）": ["place_temp"],
    "最近の気温": ["dep"],
    "前日": ["d1_humidity", "d1_sun", "d1_rain", "d1_sunny"],
    "直近1週間": ["w_humidity", "w_sun", "w_rain"],
    "風（申告）": ["wind_strong", "wind_none"],
    "空（申告）": ["sky_cloudy", "sky_wet"],
}
BASE_FEATURES = ["place_temp"]


def parse(r: dict, alpha: float) -> dict | None:
    sun, shade = fnum(r.get("sun_temp")), fnum(r.get("shade_temp"))
    exp = r.get("exposure")
    place = sun if exp == "sun" else shade if exp == "shade" else (None if sun is None or shade is None else (sun + shade) / 2)
    temp = fnum(r.get("temp"))
    hist = [fnum(v) for v in (r.get("history_60d") or "").split(";")] if r.get("history_60d") else []
    base = running_mean(hist, alpha) if hist else None
    if place is None or temp is None or base is None:
        return None
    day = lambda k, f: fnum(r.get(f"d{k}_{f}"))  # noqa: E731
    week = lambda f: nanmean([day(k, f) for k in range(1, 8)])  # noqa: E731
    sun_or_rad = lambda k: day(k, "sun_h")  # noqa: E731
    w1 = r.get("d1_weather") or ""
    sky = r.get("sky_reported") or ""
    x = {
        "place_temp": place,
        "dep": temp - base,
        "d1_humidity": day(1, "humidity"),
        "d1_sun": sun_or_rad(1),
        "d1_rain": day(1, "rain_mm"),
        "d1_sunny": 1.0 if any(w1.startswith(s) for s in SUNNY) and not any(s in w1 for s in RAINY) else 0.0,
        "w_humidity": week("humidity"),
        "w_sun": nanmean([sun_or_rad(k) for k in range(1, 8)]),
        "w_rain": nanmean([day(k, "rain_mm") for k in range(1, 8)]),
        "wind_strong": 1.0 if r.get("wind_felt") == "strong" else 0.0,
        "wind_none": 1.0 if r.get("wind_felt") == "none" else 0.0,
        "sky_cloudy": 1.0 if sky in ("thin", "cloudy") else 0.0,
        "sky_wet": 1.0 if sky in ("rain", "snow") else 0.0,
    }
    return {"at": r.get("at_jst", ""), "y": float(r["sensation"]), "x": x, "sky": sky, "sky_forecast": r.get("sky_forecast") or ""}


def load(path, alpha):
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    out = [p for p in (parse(r, alpha) for r in rows) if p]
    out.sort(key=lambda p: p["at"])
    return out


def design(reports, features, stats=None):
    """Matrix with an intercept; missing values take the training mean (then 0 after standardising)."""
    raw = np.array([[np.nan if p["x"][f] is None else p["x"][f] for f in features] for p in reports], dtype=float)
    if stats is None:
        mu = np.nanmean(raw, axis=0)
        sd = np.nanstd(raw, axis=0)
        sd[~np.isfinite(sd) | (sd == 0)] = 1.0
        mu[~np.isfinite(mu)] = 0.0
        stats = (mu, sd)
    mu, sd = stats
    z = (np.where(np.isnan(raw), mu, raw) - mu) / sd
    return np.column_stack([np.ones(len(reports)), z]), stats


class Posterior:
    def __init__(self, X, y, tau, a0=2.0, b0=1.0):
        k = X.shape[1]
        prior_prec = np.diag([1e-4] + [1 / tau**2] * (k - 1))
        self.V = np.linalg.inv(X.T @ X + prior_prec)
        self.m = self.V @ X.T @ y
        n = len(y)
        self.a = a0 + n / 2
        self.b = b0 + 0.5 * float(y @ y - self.m @ np.linalg.solve(self.V, self.m))
        # log marginal likelihood
        sign0, logdet0 = np.linalg.slogdet(prior_prec)
        sign1, logdetV = np.linalg.slogdet(self.V)
        self.log_ml = (
            -0.5 * n * math.log(2 * math.pi)
            + 0.5 * (logdetV + logdet0)
            + a0 * math.log(b0)
            - self.a * math.log(self.b)
            + gammaln(self.a)
            - gammaln(a0)
        )

    def interval(self, level=0.95):
        scale = np.sqrt(np.diag(self.V) * self.b / self.a)
        q = student_t.ppf(0.5 + level / 2, 2 * self.a)
        return self.m - q * scale, self.m + q * scale

    def predict(self, X):
        return X @ self.m


def fit_best_tau(X, y):
    best = None
    for tau in [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0]:
        p = Posterior(X, y, tau)
        if best is None or p.log_ml > best[1].log_ml:
            best = (tau, p)
    return best


def all_features():
    return [f for fs in GROUPS.values() for f in fs]


def analyse(reports, out_path=None):
    feats = all_features()
    n = len(reports)
    cut = int(n * 0.7)
    train, test = reports[:cut], reports[cut:]

    # Out of time: full vs place-only.
    Xtr, stats = design(train, feats)
    Xte, _ = design(test, feats, stats)
    ytr = np.array([p["y"] for p in train])
    yte = np.array([p["y"] for p in test])
    _, post = fit_best_tau(Xtr, ytr)
    Btr, bstats = design(train, BASE_FEATURES)
    Bte, _ = design(test, BASE_FEATURES, bstats)
    _, base = fit_best_tau(Btr, ytr)
    rmse = lambda e: float(np.sqrt(np.mean(e**2)))  # noqa: E731
    print(f"reports {n} (fit on {len(train)}, check on the latest {len(test)})")
    print(f"  RMSE later period   place only {rmse(base.predict(Bte) - yte):.3f}   with past days {rmse(post.predict(Xte) - yte):.3f}")

    # Effects, on all reports.
    X, stats = design(reports, feats)
    y = np.array([p["y"] for p in reports])
    tau, post = fit_best_tau(X, y)
    B, _ = design(reports, BASE_FEATURES)
    _, base = fit_best_tau(B, y)
    print(f"  log marginal likelihood   place only {base.log_ml:.1f}   with past days {post.log_ml:.1f}   (higher is better)")
    lo, hi = post.interval()
    print(f"\neffect per 1 standard deviation (sensation steps), 95% credible interval  [tau={tau}]")
    for g, fs in GROUPS.items():
        print(f"  {g}")
        for f in fs:
            i = feats.index(f) + 1
            shown = "" if lo[i] > 0 or hi[i] < 0 else "   (interval spans 0)"
            print(f"    {f:<13} {post.m[i]:+.3f}  [{lo[i]:+.3f}, {hi[i]:+.3f}]  sd={stats[1][i-1]:.2f}{shown}")

    # The index for the latest report, by group.
    z = X[-1]
    print("\nindex for the latest report, by group (sensation steps)")
    print(f"  base {post.m[0]:+.2f}")
    for g, fs in GROUPS.items():
        c = sum(post.m[feats.index(f) + 1] * z[feats.index(f) + 1] for f in fs)
        print(f"  {g:<10} {c:+.2f}")
    print(f"  = {float(z @ post.m):+.2f}   (reported {reports[-1]['y']:+.0f})")

    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "features": feats,
                    "groups": GROUPS,
                    "mean": stats[0].tolist(),
                    "sd": stats[1].tolist(),
                    "coef": post.m.tolist(),
                    "ci95": [lo.tolist(), hi.tolist()],
                    "tau": tau,
                    "n": n,
                    "note": "index = coef[0] + sum(coef[j+1] * (x_j - mean_j) / sd_j); research only",
                },
                f,
                ensure_ascii=False,
                indent=1,
            )
        print(f"\nwrote {out_path}")


def sky_check(reports):
    """Forecast sky vs the sky seen: a table of counts (the reconciliation is its own analysis)."""
    seen_names = {"clear": "快晴", "sunny": "晴れ", "thin": "薄曇り", "cloudy": "曇り", "rain": "雨", "snow": "雪"}
    table = {}
    for p in reports:
        if not p["sky"]:
            continue
        key = (p["sky_forecast"] or "—", seen_names.get(p["sky"], p["sky"]))
        table[key] = table.get(key, 0) + 1
    print("forecast sky -> seen sky: count")
    for (fc, seen), c in sorted(table.items(), key=lambda kv: -kv[1]):
        print(f"  {fc:<10} -> {seen:<6} {c}")


def simulate(n_days, seed=2):
    """Made-up reports where yesterday's humidity and the week's sunshine do matter."""
    rng = np.random.default_rng(seed)
    days = n_days + 70
    temp = 15 + 9 * np.sin(np.arange(days) / 25) + rng.normal(0, 2, days)
    hum = np.clip(65 + 15 * np.sin(np.arange(days) / 11) + rng.normal(0, 8, days), 25, 100)
    sun = np.clip(5 + 3 * np.cos(np.arange(days) / 7) + rng.normal(0, 2, days), 0, 11)
    out = []
    for i in range(70, days):
        hist = [float(v) for v in temp[i - 1 :: -1][:60]]
        base = running_mean(hist, ALPHA_DEFAULT)
        t = temp[i] + rng.normal(0, 2)
        exposure = rng.choice(["sun", "shade"])
        place = t + (4 if exposure == "sun" else 0)
        felt = 0.22 * (place - 20) + 0.15 * (t - base) - 0.012 * (hum[i - 1] - 65) + 0.08 * (np.mean(sun[i - 7 : i]) - 5) + rng.normal(0, 0.45)
        r = {
            "at_jst": f"{i:04d}",
            "sensation": str(float(np.clip(np.round(felt), -3, 3))),
            "exposure": exposure,
            "wind_felt": rng.choice(["strong", "weak", "none"]),
            "sky_reported": rng.choice(["sunny", "cloudy", "rain"]),
            "sky_forecast": rng.choice(["晴れ時々曇り", "曇り", "雨"]),
            "temp": str(t),
            "sun_temp": str(t + 4),
            "shade_temp": str(t),
            "history_60d": ";".join(str(v) for v in hist),
        }
        for k in range(1, 8):
            r[f"d{k}_humidity"] = str(hum[i - k])
            r[f"d{k}_sun_h"] = str(sun[i - k])
            r[f"d{k}_rain_mm"] = "0"
            r[f"d{k}_weather"] = "晴"
        out.append(parse(r, ALPHA_DEFAULT))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="?")
    ap.add_argument("--alpha", type=float, default=ALPHA_DEFAULT, help="baseline alpha (EN direction; default 0.8)")
    ap.add_argument("--out", help="write the index coefficients (JSON)")
    ap.add_argument("--sky", action="store_true", help="forecast sky vs seen sky")
    ap.add_argument("--simulate", type=int, metavar="DAYS")
    args = ap.parse_args()
    if args.simulate:
        reports = simulate(args.simulate)
    elif args.csv:
        reports = load(args.csv, args.alpha)
    else:
        ap.print_help()
        return 1
    if args.sky:
        sky_check(reports)
        return 0
    if len(reports) < 40:
        print(f"reports usable: {len(reports)}. 40 or more (over several weeks) are needed for this many effects.")
        return 0
    analyse(reports, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
