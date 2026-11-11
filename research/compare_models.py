"""Compare how "recent temperature history" enters the felt sensation, on the app's CSV.

Reads the CSV from 設定 > 最近との差 β > CSVを書き出す and compares, on the same reports:

    M0  y = b0 + b1*E                       (no history: the place's 日なた/日かげ温度 only)
    M1  y = b0 + b1*E + g(d),  d = T - A(alpha)

with g(d) one of
    linear      g = c*d
    log         g = a*sgn(d)*ln(1 + b|d|)
    power       g = a*sgn(d)*|d|**p             (p < 1: sensitivity falls off, without being a log)
    asym-log    g = a+ ln(1 + b+ d)  (d >= 0),  -a- ln(1 + b- |d|)  (d < 0)

A(alpha) is recomputed from each report's history_60d for every alpha on a grid (EN 16798-1's
running mean; alpha = weight on the previous baseline, 1 - alpha = the notes' 更新率).

Evaluation is out of time: fit on the earliest 70% of reports, score on the latest 30% (RMSE, MAE),
plus BIC on the training part. With the 7-point scale treated as numbers this is a first look; an
ordered logit (--ordinal) gives the log loss on the same split for the linear form.

    python3 research/compare_models.py weather-note-reports-2026-12-01.csv
    python3 research/compare_models.py --simulate 180      # try it on made-up reports

Needs numpy and scipy only. Nothing here decides for the app: the app keeps the linear form until
a shape wins clearly and stays ahead as reports accumulate.
"""

from __future__ import annotations

import argparse
import csv
import math
import sys

import numpy as np
from scipy.optimize import least_squares, minimize

ALPHAS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
MIN_COVERAGE = 0.8


def running_mean(history: list[float | None], alpha: float) -> float | None:
    """Same rule as src/beta/adaptation.ts: normalised weights, yesterday and 80% of weight required."""
    total = have = s = 0.0
    for k, v in enumerate(history):
        w = (1 - alpha) * alpha**k
        total += w
        if v is None:
            continue
        have += w
        s += w * v
    if not total or have / total < MIN_COVERAGE or not history or history[0] is None:
        return None
    return s / have


def place_temp(row: dict) -> float | None:
    sun, shade = row.get("sun_temp"), row.get("shade_temp")
    sun = float(sun) if sun not in (None, "") else None
    shade = float(shade) if shade not in (None, "") else None
    if row["exposure"] == "sun":
        return sun
    if row["exposure"] == "shade":
        return shade
    return None if sun is None or shade is None else (sun + shade) / 2


def load(path: str) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        e = place_temp(r)
        t = r.get("temp")
        hist = r.get("history_60d") or r.get("history_30d") or ""
        if e is None or t in (None, "") or not hist:
            continue
        out.append(
            {
                "at": r["at_jst"],
                "y": float(r["sensation"]),
                "e": e,
                "t": float(t),
                "history": [float(v) if v != "" else None for v in hist.split(";")],
            }
        )
    out.sort(key=lambda r: r["at"])
    return out


# ---- shapes of g(d) ------------------------------------------------------------------------------

def g_linear(d, p):
    return p[0] * d


def g_log(d, p):
    return p[0] * np.sign(d) * np.log1p(p[1] * np.abs(d))


def g_power(d, p):
    return p[0] * np.sign(d) * np.abs(d) ** p[1]


def g_asym(d, p):
    return np.where(d >= 0, p[0] * np.log1p(p[1] * np.maximum(d, 0)), -p[2] * np.log1p(p[3] * np.maximum(-d, 0)))


SHAPES = {
    # name: (g, initial extra params, lower bounds, upper bounds)
    "linear": (g_linear, [0.1], [-np.inf], [np.inf]),
    "log": (g_log, [0.5, 0.3], [-np.inf, 1e-4], [np.inf, 50]),
    "power": (g_power, [0.2, 0.8], [-np.inf, 0.05], [np.inf, 2.0]),
    "asym-log": (g_asym, [0.5, 0.3, 0.5, 0.3], [-np.inf, 1e-4, -np.inf, 1e-4], [np.inf, 50, np.inf, 50]),
}


def fit(shape: str | None, e, d, y):
    """Least squares of y on b0 + b1*e (+ g(d)). Returns (params, predict)."""
    if shape is None:
        X = np.column_stack([np.ones_like(e), e])
        b, *_ = np.linalg.lstsq(X, y, rcond=None)
        return b, lambda e2, d2: b[0] + b[1] * e2
    g, p0, lo, hi = SHAPES[shape]
    res = least_squares(
        lambda p: p[0] + p[1] * e + g(d, p[2:]) - y,
        x0=[0.0, 0.2, *p0],
        bounds=([-np.inf, -np.inf, *lo], [np.inf, np.inf, *hi]),
    )
    p = res.x
    return p, lambda e2, d2: p[0] + p[1] * e2 + g(d2, p[2:])


def bic(sse: float, n: int, k: int) -> float:
    return n * math.log(max(sse, 1e-9) / n) + k * math.log(n)


def features(reports, alpha):
    keep = [(r, running_mean(r["history"], alpha)) for r in reports]
    keep = [(r, a) for r, a in keep if a is not None]
    y = np.array([r["y"] for r, _ in keep])
    e = np.array([r["e"] for r, _ in keep])
    d = np.array([r["t"] - a for r, a in keep])
    return y, e, d


def compare(reports, train_share=0.7):
    n_train = int(len(reports) * train_share)
    train, test = reports[:n_train], reports[n_train:]
    results = []
    for shape in [None, *SHAPES]:
        best = None
        for alpha in ALPHAS if shape else [None]:
            ytr, etr, dtr = features(train, alpha or 0.8)
            yte, ete, dte = features(test, alpha or 0.8)
            if len(ytr) < 10 or len(yte) < 5:
                continue
            p, predict = fit(shape, etr, dtr, ytr)
            sse = float(np.sum((predict(etr, dtr) - ytr) ** 2))
            k = len(p) + (1 if shape else 0)  # alpha counts as a parameter
            err = predict(ete, dte) - yte
            row = {
                "model": "M0 (no history)" if shape is None else f"M1 {shape}",
                "alpha": alpha,
                "bic": bic(sse, len(ytr), k),
                "rmse": float(np.sqrt(np.mean(err**2))),
                "mae": float(np.mean(np.abs(err))),
                "n_train": len(ytr),
                "n_test": len(yte),
            }
            if best is None or row["bic"] < best["bic"]:
                best = row
        if best:
            results.append(best)
    return results


# ---- ordered logit (linear form) -----------------------------------------------------------------

def ordinal_logloss(reports, alpha, train_share=0.7, with_history=True):
    """Ordered logit P(Y <= k) = sigmoid(theta_k - z), z = b1*E (+ c*d); log loss on the later part."""
    n_train = int(len(reports) * train_share)
    ytr, etr, dtr = features(reports[:n_train], alpha)
    yte, ete, dte = features(reports[n_train:], alpha)
    levels = np.arange(-3, 4)

    def unpack(p):
        cuts = p[0] + np.concatenate([[0], np.cumsum(np.exp(p[1:6]))])  # increasing thresholds
        return cuts, p[6], (p[7] if with_history else 0.0)

    def probs(p, e, d):
        cuts, b1, c = unpack(p)
        z = b1 * e + c * d
        cdf = 1 / (1 + np.exp(-(cuts[None, :] - z[:, None])))
        cdf = np.column_stack([np.zeros(len(z)), cdf, np.ones(len(z))])
        return np.clip(np.diff(cdf, axis=1), 1e-9, 1)

    def nll(p, y, e, d):
        pr = probs(p, e, d)
        idx = (y - levels[0]).astype(int)
        return -np.sum(np.log(pr[np.arange(len(y)), idx]))

    p0 = np.array([-2.5, 0, 0, 0, 0, 0, 0.2, 0.1 if with_history else 0.0])
    res = minimize(lambda p: nll(p, ytr, etr, dtr), p0, method="L-BFGS-B")
    return nll(res.x, yte, ete, dte) / max(len(yte), 1)


# ---- made-up reports, to try the script ----------------------------------------------------------

def simulate(n_days: int, alpha=0.7, gamma=0.3, seed=1) -> list[dict]:
    rng = np.random.default_rng(seed)
    days = n_days + 60
    series = 15 + 9 * np.sin(np.arange(days) / 25) + rng.normal(0, 2, days)
    out = []
    for i in range(60, days):
        hist = [float(v) for v in series[i - 1 :: -1][:60]]
        a = running_mean(hist, alpha)
        t = series[i] + rng.normal(0, 3)
        e = t + rng.choice([4.0, 0.0])
        felt = 0.25 * (e - 20) + gamma * np.sign(t - a) * np.log1p(0.5 * abs(t - a)) * 3 + rng.normal(0, 0.4)
        out.append({"at": f"{i:04d}", "y": float(np.clip(np.round(felt), -3, 3)), "e": e, "t": t, "history": hist})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="?")
    ap.add_argument("--simulate", type=int, metavar="DAYS")
    ap.add_argument("--ordinal", action="store_true", help="also the ordered-logit log loss (linear form)")
    args = ap.parse_args()
    if args.simulate:
        reports = simulate(args.simulate)
    elif args.csv:
        reports = load(args.csv)
    else:
        ap.print_help()
        return 1
    print(f"reports usable: {len(reports)}")
    if len(reports) < 30:
        print("Too few reports to compare (30 or more, over two weeks or more).")
        return 0
    res = compare(reports)
    print(f"{'model':<18}{'alpha':>6}{'BIC(train)':>12}{'RMSE(test)':>12}{'MAE(test)':>11}")
    for r in sorted(res, key=lambda r: r["bic"]):
        a = "" if r["alpha"] is None else f"{r['alpha']:.2f}"
        print(f"{r['model']:<18}{a:>6}{r['bic']:>12.1f}{r['rmse']:>12.3f}{r['mae']:>11.3f}")
    if args.ordinal:
        best_alpha = min((r for r in res if r["model"] == "M1 linear"), key=lambda r: r["bic"])["alpha"]
        print(f"\nordered logit, log loss on the later 30% (alpha {best_alpha}):")
        print(f"  without history: {ordinal_logloss(reports, best_alpha, with_history=False):.3f}")
        print(f"  with history:    {ordinal_logloss(reports, best_alpha):.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
