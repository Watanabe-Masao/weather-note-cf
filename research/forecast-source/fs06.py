"""Offline FS-06. Run python3 -I fs06.py FORECAST_ZIP_DIR OUTPUT_DIR."""

import argparse
import csv
import json
import math
import re
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import BadZipFile

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import scipy
import sklearn
import threadpoolctl
from scipy.cluster.hierarchy import cut_tree, linkage
from scipy.spatial.distance import cdist, squareform
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from threadpoolctl import threadpool_limits

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fs03 import END, SEASON, START, TRAIN_END, find_csv, load_forecasts, load_obs
from fs04_rain import load_rain
from fs04_season import load_wx_pop


ITEM_NAMES = {"max": "最高", "min": "最低", "miss": "雨の見逃し", "false": "雨の空振り"}
WEATHER = ("晴", "くもり", "雨", "雪")
METHODS = ("k-means", "hierarchical", "DTW-medoid")
BOOTSTRAPS = 5000
BLOCK = 7


@dataclass
class Sample:
    days: np.ndarray
    sequence: np.ndarray
    codes: np.ndarray | None
    event: np.ndarray
    error: np.ndarray
    eligible: np.ndarray
    fs05: dict


def needed_months():
    start = (START - timedelta(days=7)).replace(day=1)
    return [f"{year}{month:02d}" for year in range(start.year, END.year + 1)
            for month in range(1, 13) if start <= date(year, month, 1) <= END]


def load_inputs(folder):
    months = {}
    required = needed_months()
    for path in sorted(folder.glob("forecast_*.zip")):
        match = re.fullmatch(r"forecast_(\d{6})(?:_390000)?\.zip", path.name)
        if match is None or match[1] not in required:
            continue
        if match[1] in months:
            raise ValueError(f"Duplicate archive month {match[1]}")
        months[match[1]] = path
    missing = [month for month in required if month not in months]
    if missing:
        raise ValueError("Missing local JMA forecast ZIP months: " + ", ".join(missing))
    with TemporaryDirectory() as directory:
        for month, path in months.items():
            name = f"forecast_{month}_390000.csv"
            if not find_csv(path.read_bytes(), name):
                raise ValueError(f"{path.name} does not contain {name}")
            (Path(directory) / f"forecast_{month}.zip").symlink_to(path.resolve())
        return load_forecasts(directory), load_wx_pop(directory), load_obs(), load_rain()


def fs05_hits(t, lead, item, fc, wp):
    """README FS-05 A-J at the requested leads, with the research variants."""
    f = fc.get((t, lead), {})
    w = wp.get((t, lead), {})
    p = w.get("pop")
    wx = w.get("wx")
    old = fc.get((t, 7), {})
    previous = fc.get((t, lead + 1), {})
    if item in ("max", "min"):
        key = item
        complete = all(key in fc.get((t, l), {}) for l in range(lead, 8))
        net = f[key] - old[key] if complete else None
        if item == "min":
            return {"A": complete and net >= 2} if lead == 1 else {}
        if lead == 3:
            moved = complete and 1 < abs(f[key] - previous[key]) <= 3
            return {
                "B": p is not None and p >= 70,
                "B'": p is not None and 50 <= p <= 60,
                "C": moved,
                # FS-05 uses each lead's training 75th percentile. Added in sample().
                "D": complete and net <= -2 and wx == "くもり",
            }
        return {}
    if item == "miss":
        if lead == 1:
            return {"H": wx == "くもり"}
        return {"G": t.month in (6, 7, 8) and 30 <= p <= 40 and wx == "くもり"}
    return {"J": 50 <= p <= 60}


def sample(fc, wp, obs, rain, item, lead):
    rainfall = item in ("miss", "false")
    key = "pop" if rainfall else item
    source = wp if rainfall else fc
    days, sequences, codes, events, errors, eligible, hits = [], [], [], [], [], [], []
    widths = [f["max_up"] - f["max_lo"] for (t, l), f in fc.items()
              if l == lead and t <= TRAIN_END and "max_up" in f]
    wide = np.quantile(widths, 0.75) if widths else np.inf
    for offset in range((END - START).days + 1):
        t = START + timedelta(days=offset)
        current = source.get((t, lead), {}).get(key)
        actual = rain.get(t) if rainfall else obs.get(t, {}).get(item)
        if current is None or actual is None:
            continue
        if (item == "miss" and current >= 50) or (item == "false" and current < 50):
            continue
        eligible.append(t.toordinal())
        leads = range(7, lead - 1, -1)
        vals = [source.get((t, l), {}).get(key) for l in leads]
        wx = [wp.get((t, l), {}).get("wx") for l in leads] if rainfall else []
        if any(v is None for v in vals) or any(w not in WEATHER for w in wx):
            continue
        error = current - actual if not rainfall else np.nan
        event = (actual >= 1 if item == "miss" else actual < 1) if rainfall else abs(error) > 2
        hit = fs05_hits(t, lead, item, fc, wp)
        if "C" in hit:
            f = fc[(t, lead)]
            hit["C'"] = hit["C"] and "max_up" in f and f["max_up"] - f["max_lo"] >= wide
        days.append(t.toordinal())
        sequences.append(vals)
        codes.append([WEATHER.index(w) for w in wx])
        events.append(event)
        errors.append(error)
        hits.append(hit)
    rules = {name: np.array([row[name] for row in hits]) for name in sorted(hits[0])} if hits else {}
    return Sample(np.array(days, dtype=int), np.array(sequences, dtype=float),
                  np.array(codes, dtype=int) if rainfall else None,
                  np.array(events, dtype=bool), np.array(errors), np.array(eligible, dtype=int), rules)


def features(data, representation):
    values = data.sequence.copy()
    if representation == "mean":
        values -= values.mean(axis=1, keepdims=True)
    elif representation == "delta":
        values = np.diff(values, axis=1)
    if data.codes is None:
        return values[:, :, None]
    weather = np.eye(len(WEATHER))[data.codes] / np.sqrt(2)
    if representation == "delta":
        weather = np.diff(weather, axis=1)
    # Changing the weather category has the same squared cost as a 20-point POP change.
    return np.concatenate((values[:, :, None] / 20, weather), axis=2)


def dtw(left, right):
    """Pairwise DTW. Keep the first/last leads anchored and warp at most one day."""
    length = left.shape[1]
    costs = {}
    for i in range(length):
        for j in range(max(0, i - 1), min(length, i + 2)):
            if (i in (0, length - 1) or j in (0, length - 1)) and i != j:
                continue
            point = cdist(left[:, i], right[:, j], "sqeuclidean")
            if i == j == 0:
                costs[i, j] = point
                continue
            parents = [costs[pair] for pair in ((i - 1, j), (i, j - 1), (i - 1, j - 1)) if pair in costs]
            if parents:
                costs[i, j] = point + np.minimum.reduce(parents)
    return np.sqrt(costs[length - 1, length - 1])


def medoids(distances, labels, k):
    """Representative training-day position with minimum within-cluster distance."""
    result = []
    for c in range(k):
        indices = np.flatnonzero(labels == c)
        result.append(indices[distances[np.ix_(indices, indices)].sum(axis=1).argmin()])
    return np.array(result)


def dtw_medoids(distance, k):
    centers = [int(distance.sum(axis=1).argmin())]
    while len(centers) < k:
        farthest = distance[:, centers].min(axis=1)
        next_center = int(farthest.argmax())
        if farthest[next_center] == 0:
            return None
        centers.append(next_center)
    for _ in range(50):
        labels = distance[:, centers].argmin(axis=1)
        if len(np.unique(labels)) != k:
            return None
        updated = medoids(distance, labels, k)
        if np.array_equal(centers, updated):
            break
        centers = updated
    return np.array(centers)


@dataclass
class Model:
    method: str
    rep: str
    k: int
    silhouette: float
    spread: float
    centers: np.ndarray
    representatives: np.ndarray
    labels: np.ndarray

    def assign(self, sequence):
        if self.method == "DTW-medoid":
            return dtw(sequence, self.centers).argmin(axis=1)
        return cdist(sequence.reshape(len(sequence), -1), self.centers).argmin(axis=1)


def models(sequence, y, representation):
    flat = sequence.reshape(len(sequence), -1)
    distinct = len(np.unique(flat, axis=0))
    if distinct < 2:
        return
    euclidean = cdist(flat, flat)
    tree = linkage(squareform(euclidean, checks=False), method="average")
    warped = dtw(sequence, sequence)
    for k in range(2, min(6, len(y) // 15, distinct) + 1):
        for method in METHODS:
            distance = warped if method == "DTW-medoid" else euclidean
            if method == "k-means":
                centers = KMeans(n_clusters=k, n_init=10, random_state=6).fit(flat).cluster_centers_
                labels = cdist(flat, centers).argmin(axis=1)
            else:
                if method == "hierarchical":
                    initial = cut_tree(tree, n_clusters=[k]).ravel()
                    reps = medoids(distance, initial, k)
                else:
                    reps = dtw_medoids(distance, k)
                    if reps is None:
                        continue
                centers = sequence[reps] if method == "DTW-medoid" else flat[reps]
                labels = distance[:, reps].argmin(axis=1)
            counts = np.bincount(labels, minlength=k)
            if counts.min() < 10:
                continue
            rates = [y[labels == c].mean() for c in range(k) if counts[c] >= 20]
            spread = max(rates) - min(rates) if len(rates) >= 2 else 0.0
            yield Model(method, representation, k, float(silhouette_score(distance, labels, metric="precomputed")),
                        float(spread), centers, medoids(distance, labels, k), labels)


def bootstrap(days, event, mask, alpha=0.05, seed=6):
    """Sample blocks of consecutive calendar days, retaining ineligible dates as zeros."""
    size = int(days[-1] - days[0] + 1)
    if size < BLOCK or not event.any() or not mask.any():
        return (np.nan, np.nan)
    daily = np.zeros((size, 4), dtype=np.int32)
    daily[days - days[0]] = np.column_stack((mask & event, mask, event, np.ones(len(days))))
    prefix = np.vstack((np.zeros((1, 4), dtype=np.int32), daily.cumsum(axis=0)))
    rng = np.random.default_rng(seed)
    # The corrected interval uses more draws to resolve the tail.
    draws = BOOTSTRAPS if alpha == 0.05 else 4 * BOOTSTRAPS
    starts = rng.integers(0, size - BLOCK + 1, size=(draws, math.ceil(size / BLOCK)))
    lengths = np.full(starts.shape[1], BLOCK)
    lengths[-1] = size - BLOCK * (len(lengths) - 1)
    counts = (prefix[starts + lengths] - prefix[starts]).sum(axis=1)
    matched_events, matched, all_events, total = counts.T
    valid = (matched > 0) & (all_events > 0)
    if valid.mean() < 0.95:
        return (np.nan, np.nan)
    lift = matched_events[valid] * total[valid] / (matched[valid] * all_events[valid])
    return tuple(np.quantile(lift, (alpha / 2, 1 - alpha / 2)))


def metrics(y, errors, mask):
    selected = y[mask]
    event_count = int(selected.sum())
    base = float(y.mean()) if len(y) else None
    rate = float(selected.mean()) if len(selected) else None
    high = int(((errors > 0) & mask & y).sum()) if np.isfinite(errors).any() else None
    return {"total": len(y), "n": len(selected), "share": len(selected) / len(y) if len(y) else None,
            "events": event_count, "rate": rate, "base": base,
            "ratio": rate / base if rate is not None and base else None,
            "high": high, "low": event_count - high if high is not None else None}


def describe(raw, weather=None):
    """Describe the training representative, including the size of the last revision."""
    diff = np.diff(raw)
    if not np.any(diff):
        shape = "横ばい"
    elif np.all(diff >= 0):
        shape = "上がり続ける"
    elif np.all(diff <= 0):
        shape = "下がり続ける"
    elif abs(raw[-1] - raw[0]) <= np.abs(diff).sum() / 3:
        shape = "行ったり来たり"
    else:
        shape = "上下しつつ上がる" if raw[-1] > raw[0] else "上下しつつ下がる"
    unit = "ポイント" if weather is not None else "℃"
    out = f"{shape}（正味 {raw[-1] - raw[0]:+g}、最後 {diff[-1]:+g}{unit}）"
    if weather is not None:
        out += " " + "→".join(WEATHER[code] for code in weather)
    return out


def month_range(month, radius):
    return {(month + offset - 1) % 12 + 1 for offset in range(-radius, radius + 1)}


def scopes(train, months):
    yield "全年", set(range(1, 13)), set(range(1, 13))
    for season in ("春", "夏", "秋", "冬"):
        core = {m for m in range(1, 13) if SEASON[m] == season}
        yield season, core, core
    for m in range(1, 13):
        for radius in (0, 1, 2):
            window = month_range(m, radius)
            if (train & np.isin(months, list(window))).sum() >= 80:
                break
        yield f"{m:02d}月", {m}, window


def inspect_scope(data, item, lead, scope, core, window, months, cache, comparisons):
    old = data.days <= TRAIN_END.toordinal()
    train = old & np.isin(months, list(window))
    test = ~old & np.isin(months, list(core))
    train_pos = np.flatnonzero(train)
    if train.sum() < 80:
        return []
    # Compare on training data only. Identical windows reuse the fitted models.
    window_key = tuple(sorted(window))
    if window_key not in cache:
        choices = ("level", "delta") if data.codes is not None else ("mean", "delta")
        cache[window_key] = [m for rep in choices for m in models(
            features(data, rep)[train], data.event[train], rep)]
    options = cache[window_key]
    if not options:
        return []
    best = max(m.silhouette for m in options)
    # At near-equal cohesion, prefer a meaningful difference in training miss rates.
    winner = max((m for m in options if m.silhouette >= best - 0.05),
                 key=lambda m: (m.spread, m.silhouette, -m.k))
    for m in options:
        comparisons.append({"item": item, "lead": lead, "scope": scope, "method": m.method,
                            "representation": m.rep, "k": m.k, "silhouette": m.silhouette,
                            "training_error_spread": m.spread, "selected": m is winner})
    # Compute the held-out labels against training centers, in the fitted representation.
    y_train, y_test = data.event[train], data.event[test]
    held_window = ~old & np.isin(months, list(window))
    sequence = features(data, winner.rep)
    held_labels = winner.assign(sequence[held_window]) if held_window.any() else np.array([], dtype=int)
    core_in_window = test[held_window]
    rows = []
    for c in range(winner.k):
        mask_train, mask_window = winner.labels == c, held_labels == c
        mask_test = mask_window[core_in_window]
        fitted = metrics(y_train, data.error[train], mask_train)
        held = metrics(y_test, data.error[test], mask_test)
        index = train_pos[winner.representatives[c]]
        raw = data.sequence[index]
        weather = data.codes[index] if data.codes is not None else None
        rows.append({
            "id": f"{item}-L{lead}-{scope}-{c + 1}", "item": item, "lead": lead, "scope": scope,
            "window": sorted(window), "core": sorted(core), "method": winner.method, "representation": winner.rep,
            "silhouette": winner.silhouette, "shape": describe(raw, weather),
            "trajectory": (raw - raw[0]).tolist() if weather is None else raw.tolist(),
            "weather": [WEATHER[code] for code in weather] if weather is not None else None,
            "centers": winner.centers.tolist() if c == 0 else None,
            "fitted": fitted, "held": held,
            "held_window": metrics(data.event[held_window], data.error[held_window], mask_window),
            "candidate": fitted["n"] >= 30 and fitted["events"] >= 5 and (fitted["ratio"] or 0) >= 1.5,
            "test": test, "mask": mask_test, "data": data, "months": months,
        })
    return rows


def interval(days, y, mask, alpha=0.05):
    lo, hi = bootstrap(days, y, mask, alpha)
    return [float(lo), float(hi)] if np.isfinite((lo, hi)).all() else None


def compare_rules(row, days, y, mask):
    data, test = row["data"], row["test"]
    rules = {name: hits[test] for name, hits in data.fs05.items()}
    if "B" in rules:
        rules["B・B'（#469）"] = rules["B"] | rules["B'"]
    overlaps = {}
    for name, hits in rules.items():
        both, either = int((mask & hits).sum()), int((mask | hits).sum())
        overlaps[name] = {"intersection": both, "fs05_n": int(hits.sum()),
                          "jaccard": both / either if either else None,
                          "cluster_covered": both / mask.sum() if mask.any() else None}
    existing = np.logical_or.reduce(list(rules.values())) if rules else np.zeros(len(y), dtype=bool)
    unseen = ~existing
    residual = metrics(y[unseen], data.error[test][unseen], mask[unseen])
    residual["ci95"] = interval(days[unseen], y[unseen], mask[unseen]) if unseen.any() else None
    residual["covered_by_any"] = int((mask & existing).sum()) / int(mask.sum()) if mask.any() else None
    return overlaps, residual


def rain_paired_baseline(data, test, mask):
    """Held-out expected event rate at the same exact endpoint POP mix."""
    observed = data.event[test]
    pop = data.sequence[test, -1]
    count = mask.sum()
    if not count:
        return None
    return float(sum(observed[pop == p].mean() * (mask & (pop == p)).sum()
                     for p in np.unique(pop)) / count)


def evaluate(rows):
    families = {global_scope: sum(r["candidate"] and (r["scope"] == "全年") == global_scope
                                  for r in rows) for global_scope in (True, False)}
    for row in rows:
        data, test, mask = row["data"], row["test"], row["mask"]
        days, y = data.days[test], data.event[test]
        held, fitted = row["held"], row["fitted"]
        held["ci95"] = interval(days, y, mask) if len(days) else None
        family = families[row["scope"] == "全年"]
        adjusted = None
        if row["candidate"] and held["n"] >= 20 and held["events"] >= 5:
            adjusted = interval(days, y, mask, min(0.05, 0.05 / family))
        held["family_ci"] = adjusted
        # If a direction had already emerged on the old period, require it to persist.
        learned_direction = None
        if fitted["events"] and fitted["high"] is not None:
            shares = {side: fitted[side] / fitted["events"] for side in ("high", "low")}
            dominant = max(shares, key=shares.get)
            if shares[dominant] >= 0.65:
                learned_direction = dominant
        direction_agrees = learned_direction is None or held[learned_direction] > held["events"] / 2
        row["direction"] = learned_direction
        row["kept"] = bool(adjusted and adjusted[0] > 1 and (held["ratio"] or 0) >= 1.30 and direction_agrees)
        if row["kept"]:
            row["overlap"], row["outside_fs05"] = compare_rules(row, days, y, mask)
            residual = row["outside_fs05"]
            row["same_pop_base"] = rain_paired_baseline(data, test, mask) if data.codes is not None else None
            # An additional candidate needs verified excess left after removing existing FS-05 dates.
            row["addition_candidate"] = bool(
                row["scope"] == "全年" and residual["covered_by_any"] < 0.5
                and residual["n"] >= 20 and residual["events"] >= 5 and (residual["ratio"] or 0) >= 1.30
                and residual["ci95"] and residual["ci95"][0] > 1
                and (row["same_pop_base"] is None or held["rate"] >= 1.3 * row["same_pop_base"])
            )
    kept = [r for r in rows if r["kept"]]
    for row in kept:
        if row["scope"] == "全年":
            continue
        data, test, mask = row["data"], row["test"], row["mask"]
        global_rows = [r for r in rows if r["scope"] == "全年" and r["item"] == row["item"]
                       and r["lead"] == row["lead"]]
        similarities = {}
        for g in global_rows:
            global_mask = np.zeros(len(data.days), dtype=bool)
            global_mask[g["test"]] = g["mask"]
            nearby = global_mask[test]
            similarities[g["id"]] = float((nearby & mask).sum() / (nearby | mask).sum())
        row["global_overlap"] = similarities
    return kept, families


def breakdown(row):
    data, test, mask = row["data"], row["test"], row["mask"]
    month_values = row["months"][test]
    groups = [(f"{m:02d}月", {m}) for m in range(1, 13)]
    groups += [(s, {m for m in range(1, 13) if SEASON[m] == s}) for s in ("春", "夏", "秋", "冬")]
    out = []
    for name, months in groups:
        part = np.isin(month_values, list(months))
        values = metrics(data.event[test][part], data.error[test][part], mask[part])
        out.append({"id": row["id"], "period": name, **values})
    return out


def write_csv(path, rows):
    if not rows:
        return
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def plot(output, rows, kept):
    # Each item/L gets a figure. All traces are representatives from the old period.
    for item in ITEM_NAMES:
        for lead in (1, 3):
            selected = [r for r in kept if r["item"] == item and r["lead"] == lead]
            if not selected:
                selected = [r for r in rows if r["scope"] == "全年" and r["item"] == item and r["lead"] == lead]
            if not selected:
                continue
            leads = list(range(7, lead - 1, -1))
            rainfall = item in ("miss", "false")
            height = 2.25 if rainfall else 1.85
            fig, axes = plt.subplots(len(selected), 1, figsize=(8, height * len(selected) + 0.6),
                                     sharex=True, squeeze=False, layout="constrained")
            for row, ax in zip(selected, axes[:, 0]):
                ax.plot(leads, row["trajectory"], marker="o", linewidth=2, color="#256E84")
                scope = "all months" if row["scope"] == "全年" else "-".join(map(str, row["core"]))
                status = "held-out pass" if row["kept"] else "illustrative / did not pass"
                ax.set_title(f"{item} · L{lead} · {scope} · cluster {row['id'].rsplit('-', 1)[-1]} · {status}",
                             loc="left", fontsize=10)
                ax.set_ylabel("POP (%)" if rainfall else "Change (°C)")
                ax.grid(axis="y", alpha=0.23)
                if rainfall:
                    ax.set_ylim(-15, 105)
                    ax.axhline(50, linewidth=0.8, color="#666666", linestyle="--")
                    for x, code in zip(leads, row["weather"]):
                        ax.text(x, -10, ("Sun", "Cloud", "Rain", "Snow")[WEATHER.index(code)],
                                ha="center", fontsize=8)
            axes[-1, 0].set(xticks=leads, xlim=(7.2, lead - 0.2), xlabel="Days before target date")
            fig.savefig(output / f"fs06_{item}_L{lead}.png", dpi=125)
            plt.close(fig)


def pct(x):
    return "—" if x is None else f"{x:.1%}"


def number(x):
    return "—" if x is None else f"{x:.2f}"


def summary(output, kept, monthly, coverage, families):
    lines = ["# FS-06 高知の予報の動き方", "", "## 検証を通った型", "",
             "| 項目 | 日前 | 範囲・型 | 代表の形 | 作る期間の倍率 | 確かめる期間の件数・割合 | 大外れ／ふだん | 倍率（95%幅） | 高すぎ／低すぎ |",
             "|---|---:|---|---|---:|---|---|---|---|"]
    for r in kept:
        f, h = r["fitted"], r["held"]
        side = f"{h['high']}／{h['low']}" if h["high"] is not None else "—"
        lo, hi = h["ci95"]
        lines.append(f"| {ITEM_NAMES[r['item']]} | {r['lead']} | {r['id']} | {r['shape']} | {f['ratio']:.2f} | "
                     f"{h['n']}/{h['total']}・{pct(h['share'])} | {pct(h['rate'])}／{pct(h['base'])} | "
                     f"{h['ratio']:.2f}（{lo:.2f}〜{hi:.2f}） | {side} |")
    if not kept:
        lines += ["", "検証基準を満たした型は0件。"]
    figures = [f"[`{path.name}`]({path.name})" for path in sorted(output.glob("fs06_*_L[13].png"))]
    if figures:
        lines += ["", "代表の形の図（古い期間の実在日）", "", "・".join(figures)]
    lines += ["", f"古い期間で選んだ検証対象は全年 {families[True]}件、月・季節 {families[False]}件。"]
    lines += ["", "## 月別・季節別の出方", "",
              "| 型 | 月・季節 | 件数／対象日数 | 大外れ／同じ月・季節のふだん | 倍率 |",
              "|---|---|---:|---|---:|"]
    kept_ids = {r["id"] for r in kept}
    for v in monthly:
        if v["id"] in kept_ids and v["n"]:
            lines.append(f"| {v['id']} | {v['period']} | {v['n']}/{v['total']} | {pct(v['rate'])}／"
                         f"{pct(v['base'])} | {number(v['ratio'])} |")
    lines += ["", "## FS-05 の型との重なり", "",
              "| 型 | FS-05 | 重複日数／FS-05該当日数 | Jaccard | FS-06側の一致割合 |",
              "|---|---|---:|---:|---:|"]
    for r in kept:
        for name, value in r["overlap"].items():
            lines.append(f"| {r['id']} | {name} | {value['intersection']}/{value['fs05_n']} | "
                         f"{number(value['jaccard'])} | {pct(value['cluster_covered'])} |")
    lines += ["", "L=1・3 に該当する A、B、B'、C、C'、D、G、H、J を同じ項目・日数・対象日で比較。"
              "E、F、I と4〜7日前の派生型は適用日数が違うため比較対象外。"]
    lines += ["", "## 月・季節で分け直した型と全年の型", ""]
    for r in kept:
        if "global_overlap" in r:
            name = max(r["global_overlap"], key=r["global_overlap"].get)
            local = r["global_overlap"][name]
            lines.append(f"- {r['id']} に最も近い全年の型は {name}（対象月・季節で Jaccard {local:.2f}）。")
    rain_rows = [r for r in kept if r["same_pop_base"] is not None]
    if rain_rows:
        lines += ["", "## 雨の判定時点の降水確率をそろえた比較", "",
                  "| 型 | 形に該当する日の大外れ | 同じ降水確率の構成比での大外れ |",
                  "|---|---:|---:|"]
        for r in rain_rows:
            lines.append(f"| {r['id']} | {pct(r['held']['rate'])} | {pct(r['same_pop_base'])} |")
    lines += ["", "## メインへ渡す追加候補", ""]
    additions = [r for r in kept if r["addition_candidate"]]
    for r in additions:
        v = r["outside_fs05"]
        lo, hi = v["ci95"]
        lines.append(f"- {r['id']}（{r['shape']}）。FS-05に該当する日を除いても {v['n']}日で "
                     f"{v['ratio']:.2f}倍（95%幅 {lo:.2f}〜{hi:.2f}）。")
    if not additions:
        lines.append("追加候補の基準を満たした型は0件。")
    lines += ["", "## データの採用数", "",
              "| 項目 | 日前 | 期間 | 末端値と実績あり | 形がそろった日 |",
              "|---|---:|---|---:|---:|"]
    for v in coverage:
        lines.append(f"| {ITEM_NAMES[v['item']]} | {v['lead']} | {v['period']} | {v['eligible']} | {v['complete']} |")
    (output / "fs06_summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def run(fc, wp, obs, rain, output):
    coverage, comparisons, rows, monthly = [], [], [], []
    for item in ITEM_NAMES:
        for lead in (1, 3):
            data = sample(fc, wp, obs, rain, item, lead)
            train = data.days <= TRAIN_END.toordinal()
            eligible_train = data.eligible <= TRAIN_END.toordinal()
            coverage.extend({"item": item, "lead": lead, "period": p, "complete": int(mask.sum()),
                             "eligible": int(eligible.sum())}
                            for p, mask, eligible in (("作る", train, eligible_train),
                                                       ("確かめる", ~train, ~eligible_train)))
            months = np.array([date.fromordinal(int(d)).month for d in data.days], dtype=int)
            cache = {}
            for name, core, window in scopes(train, months):
                rows.extend(inspect_scope(data, item, lead, name, core, window, months, cache, comparisons))
    kept, families = evaluate(rows)
    for r in rows:
        if r["scope"] == "全年" or r["kept"]:
            monthly.extend(breakdown(r))
    output.mkdir(parents=True, exist_ok=True)
    plot(output, rows, kept)
    summary(output, kept, monthly, coverage, families)
    write_csv(output / "fs06_coverage.csv", coverage)
    write_csv(output / "fs06_methods.csv", comparisons)
    write_csv(output / "fs06_calendar.csv", monthly)
    metadata = {"numpy": np.__version__, "scipy": scipy.__version__, "scikit-learn": sklearn.__version__,
                "matplotlib": matplotlib.__version__, "threadpoolctl": threadpoolctl.__version__}
    private = {"data", "test", "months", "mask"}
    results = [{key: val for key, val in row.items() if key not in private} for row in rows]
    payload = {"versions": metadata, "candidate_counts": {"global": families[True], "local": families[False]},
               "clusters": results}
    (output / "fs06_results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"versions": metadata, "clusters": len(rows), "kept": len(kept)}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    try:
        inputs = load_inputs(args.archive_dir)
    except (OSError, ValueError, BadZipFile) as exc:
        parser.error(str(exc))
    # Tiny repeated fits are faster and reproducible with one numerical worker.
    with threadpool_limits(limits=1):
        run(*inputs, args.output_dir)


if __name__ == "__main__":
    main()
