"""FS-06：予報の動き方の形をクラスター分析で分け、外れやすい形を見つける（高知、気象庁の府県・週間天気予報だけ）。

材料：shiromatz の記録（予報）、fs03_obs_47893.csv（最高・最低）、fs04_rain_47893.csv（日降水量）。外部は読まない。Open-Meteo は使わない。
材料の取り方は FS-05 と同じ（fs03.load_forecasts、fs04_season.load_wx_pop）。

ベクトル（対象日 t、判定する何日前 L。L 日前までの並びだけを使う＝先読みしない）
  気温：7日前 → L 日前の予報の並び（長さ 8−L）。形をそろえる3つの作り方を比べる：
    「7日前を引く」（7日前からの上がり下がり、長さ 7−L）、「並びの平均を引く」（長さ 8−L）、「差分」（発表ごとの動き、長さ 7−L）。
  雨：降水確率の並び（÷100）と、天気が雨・雪かの並び（0/1）をつなぐ（長さ 2×(8−L)）。1日前の降水確率は府県の6時間の最大。
  欠け：7日前から L 日前まで1つでも欠ける日は使わない（数を報告する）。
分け方：k-means、階層（Ward）、DTW（動的時間伸縮の距離で平均連結の階層、中心は代表の日＝メドイド）。k＝2〜8。
確かめ：作る期間（2024-02〜2025-10）で分けて中心を決め、確かめる期間（2025-11〜2026-10）の日をいちばん近い中心に割り当てる。
大外れ：FS-05 と同じ（気温 ±2℃超、雨は見逃し＝降水確率 <50% で 1mm 以上・空振り＝≥50% で 1mm 未満）。
使い方：python3 -I fs06b.py <forecast の ZIP があるフォルダ>   （図 fs06b_shapes.png・fs06b_months.png も作る）
"""
import math, os, random, statistics as st, sys
from collections import Counter, defaultdict
from datetime import date, timedelta

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform
from scipy.stats import binom, chi2_contingency
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs03 import load_forecasts, load_obs  # noqa: E402
from fs04_rain import load_rain  # noqa: E402
from fs04_season import load_wx_pop  # noqa: E402
from fs05 import block_ratio_ci  # noqa: E402

START, END = date(2024, 2, 1), date(2026, 10, 31)
TRAIN_END = date(2025, 10, 31)
LEADS = (1, 3, 5)
SEASON = {12: "冬", 1: "冬", 2: "冬", 3: "春", 4: "春", 5: "春", 6: "夏", 7: "夏", 8: "夏", 9: "秋", 10: "秋", 11: "秋"}
HERE = os.path.dirname(os.path.abspath(__file__))
TURN = (3, 4, 10, 11)


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


# ---------------------------------------------------------------- データ
def build(folder):
    fc, obs, rain, wp = load_forecasts(folder), load_obs(), load_rain(), load_wx_pop(folder)
    data = {}  # (item, L) -> list of dict(t, raw, y, e, pop)
    drop = Counter()
    for L in LEADS:
        for item in ("最高", "最低"):
            k = "max" if item == "最高" else "min"
            out = []
            for t in days(START, END):
                s = [fc.get((t, l), {}).get(k) for l in range(7, L - 1, -1)]  # 7日前 … L 日前
                if any(x is None for x in s) or t not in obs or obs[t][k] is None:
                    drop[(item, L)] += 1
                    continue
                e = s[-1] - obs[t][k]
                out.append({"t": t, "raw": np.array(s, float), "y": abs(e) > 2, "e": e})
            data[(item, L)] = out
        out = []
        for t in days(START, END):
            ps = [wp.get((t, l), {}).get("pop") for l in range(7, L - 1, -1)]
            ws = [wp.get((t, l), {}).get("wx") for l in range(7, L - 1, -1)]
            if any(x is None for x in ps) or any(x is None for x in ws) or t not in rain:
                drop[("雨", L)] += 1
                continue
            pop = ps[-1]
            r = rain[t] >= 1.0
            out.append({"t": t, "raw": np.array([p / 100 for p in ps] + [1.0 if w in ("雨", "雪") else 0.0 for w in ws]),
                        "pop": pop, "wx": ws[-1], "y_miss": (pop < 50 and r), "y_fa": (pop >= 50 and not r), "rain": r, "pops": ps, "wxs": ws})
        data[("雨", L)] = out
    return data, drop, fc, wp


def rep(raw, how):
    if how == "7日前を引く":
        return raw[1:] - raw[0]
    if how == "平均を引く":
        return raw - raw.mean()
    if how == "差分":
        return np.diff(raw)
    return raw


def dtw(a, b):
    n, m = len(a), len(b)
    D = np.full((n + 1, m + 1), np.inf)
    D[0, 0] = 0
    for i in range(1, n + 1):
        for j in range(max(1, i - 2), min(m, i + 2) + 1):  # ずれは前後2発表まで
            c = abs(a[i - 1] - b[j - 1])
            D[i, j] = c + min(D[i - 1, j], D[i, j - 1], D[i - 1, j - 1])
    return D[n, m]


_DTW = {}


# ---------------------------------------------------------------- 分ける
def cluster(X, method, k, seed=0):
    """作る期間の X を分け、(ラベル, 割り当て関数, 中心) を返す。"""
    if method == "k-means":
        km = KMeans(n_clusters=k, n_init=20, random_state=seed).fit(X)
        return km.labels_, (lambda Z: km.predict(Z)), km.cluster_centers_
    if method == "階層（Ward）":
        Zl = linkage(X, "ward")
        lab = fcluster(Zl, k, "maxclust") - 1
        cen = np.array([X[lab == c].mean(0) for c in range(lab.max() + 1)])
        return lab, (lambda Z: np.argmin(((Z[:, None, :] - cen[None]) ** 2).sum(-1), 1)), cen
    if method == "DTW":
        key = X.tobytes()
        if key not in _DTW:
            n = len(X)
            Dm = np.zeros((n, n))
            for i in range(n):
                for j in range(i + 1, n):
                    Dm[i, j] = Dm[j, i] = dtw(X[i], X[j])
            _DTW[key] = Dm
        Dm = _DTW[key]
        Zl = linkage(squareform(Dm, checks=False), "average")
        lab = fcluster(Zl, k, "maxclust") - 1
        med = []
        for c in range(lab.max() + 1):
            idx = np.where(lab == c)[0]
            med.append(X[idx[np.argmin(Dm[np.ix_(idx, idx)].sum(1))]])
        med = np.array(med)
        return lab, (lambda Z: np.array([np.argmin([dtw(z, m) for m in med]) for z in Z])), med, Dm
    raise ValueError(method)


def describe_shape(c_raw_anch, L):
    """中心（7日前を引いた並び、7日前=0 を先頭に足したもの）を言葉に。"""
    s = np.concatenate([[0.0], c_raw_anch])
    net = s[-1] - s[0]
    steps = np.diff(s)
    last = steps[-1]
    rng = s.max() - s.min()
    rev = sum(1 for i in range(len(steps) - 1) if steps[i] * steps[i + 1] < -0.04)
    early = s[:-1]
    if abs(last) >= 1.0 and abs(early[-1] - early[0]) < 1.0:
        w = f"{'前日' if L == 1 else '直前'}に急に{'上がる' if last > 0 else '下がる'}"
    elif net >= 1.5 and (steps >= -0.3).all():
        w = "上がり続ける"
    elif net <= -1.5 and (steps <= 0.3).all():
        w = "下がり続ける"
    elif rng >= 1.5 and abs(net) < 0.8:
        w = "行ったり来たり（上下して戻る）"
    elif net >= 1.0:
        w = "上がる（途中で揺れる）"
    elif net <= -1.0:
        w = "下がる（途中で揺れる）"
    else:
        w = "ほぼ動かない"
    return f"{w}（正味 {net:+.1f}℃・幅 {rng:.1f}℃・直前 {last:+.1f}℃）"


def rain_desc(c, L):
    n = 8 - L
    p, w = c[:n], c[n:]
    trend = p[-1] - p[0]
    lvl = "高い" if p[-1] >= 0.5 else ("中くらい" if p[-1] >= 0.3 else "低い")
    mv = "上がってきた" if trend >= 0.15 else ("下がってきた" if trend <= -0.15 else "ほぼ同じ")
    return f"降水確率が{lvl}（{p[0] * 100:.0f}%→{p[-1] * 100:.0f}%、{mv}）・雨の予報の割合 {w.mean() * 100:.0f}%"


# ---------------------------------------------------------------- 本体
def main(folder):
    data, drop, fc, wp = build(folder)
    print("使った日・欠けで除いた日：", {f"{k[0]}{k[1]}日前": (len(v), drop[k]) for k, v in data.items()})
    rng_seed = 0

    # ---------------------------------------------------------------- 1. 分け方の比べ
    print("\n## 1. 分け方の比べ（作る期間）：シルエット（DTW は DTW 距離）、大外れの割合のクラスター間の差（カイ二乗の p）、確かめる期間で続いたクラスターの数")
    choice = {}
    for (item, L), rows in data.items():
        tr = [r for r in rows if r["t"] <= TRAIN_END]
        te = [r for r in rows if r["t"] > TRAIN_END]
        ys = ["y"] if item != "雨" else ["y_miss", "y_fa"]
        hows = ("7日前を引く", "平均を引く", "差分") if item != "雨" else ("そのまま",)
        best = None
        for how in hows:
            Xtr = np.array([rep(r["raw"], how) for r in tr])
            Xte = np.array([rep(r["raw"], how) for r in te])
            for method in ("k-means", "階層（Ward）", "DTW"):
                if method == "DTW" and (item == "雨" or how == "差分"):
                    continue
                for k in range(2, 9):
                    res = cluster(Xtr, method, k, rng_seed)
                    lab, assign = res[0], res[1]
                    if len(set(lab)) < 2:
                        continue
                    sil = silhouette_score(res[3], lab, metric="precomputed") if method == "DTW" else silhouette_score(Xtr, lab)
                    lte = assign(Xte)
                    line = []
                    kept = 0
                    sep = 0  # 作る期間だけで数える：大外れがふだんの 1.3 倍以上で、二項検定 p<0.01 のクラスターの数
                    for yn in ys:
                        ytr = np.array([bool(r[yn]) for r in tr])
                        yte = np.array([bool(r[yn]) for r in te])
                        tab = np.array([[((lab == c) & ytr).sum(), ((lab == c) & ~ytr).sum()] for c in range(lab.max() + 1)])
                        tab = tab[tab.sum(1) > 0]
                        p = chi2_contingency(tab)[1] if (tab[:, 0] > 0).sum() >= 2 else 1.0
                        btr, bte = ytr.mean(), yte.mean()
                        for c in range(lab.max() + 1):
                            ntr, nte = (lab == c).sum(), (lte == c).sum()
                            if ntr < 30 or nte < 20 or btr == 0 or bte == 0:
                                continue
                            rtr, rte = ytr[lab == c].mean(), yte[lte == c].mean()
                            if rtr / btr >= 1.3 and binom.sf(int(ytr[lab == c].sum()) - 1, int(ntr), btr) < 0.01:
                                sep += 1
                            if rtr / btr >= 1.3 and rte / bte >= 1.3 and binom.sf(int(yte[lte == c].sum()) - 1, nte, bte) < 0.05:
                                kept += 1
                        line.append(f"{yn} p={p:.3f}")
                    print(f"  {item} {L}日前 {how} {method} k={k}：シルエット {sil:.2f}｜" + "｜".join(line) + f"｜作る期間で外れやすいクラスター {sep}｜（参考）確かめる期間で続いた {kept}")
                    score = (sep, sil)
                    if best is None or score > best[0]:
                        best = (score, how, method, k)
        choice[(item, L)] = best[1:]
        print(f"  → {item} {L}日前で選んだ：{best[1]}・{best[2]}・k={best[3]}（作る期間だけで選ぶ：外れやすいクラスターがいちばん多く、同じならシルエットが高い）")

    # ---------------------------------------------------------------- 2・4・5. 選んだ分け方でクラスターごとに
    print("\n## 2・4・5. クラスターごと（選んだ分け方）。作る期間で中心を決め、確かめる期間の日を割り当てる")
    kept_all = []
    shape_fig = []
    for (item, L), rows in data.items():
        how, method, k = choice[(item, L)]
        tr = [r for r in rows if r["t"] <= TRAIN_END]
        te = [r for r in rows if r["t"] > TRAIN_END]
        Xtr = np.array([rep(r["raw"], how) for r in tr])
        Xall = np.array([rep(r["raw"], how) for r in rows])
        res = cluster(Xtr, method, k, rng_seed)
        lab_all = res[1](Xall)
        is_tr = np.array([r["t"] <= TRAIN_END for r in rows])
        for r, c in zip(rows, lab_all):
            r.setdefault("cl", {})[L] = c
        ys = ["y"] if item != "雨" else ["y_miss", "y_fa"]
        # 図のための代表の形（全期間、7日前を引いた並びの平均）
        anch = np.array([r["raw"][1:] - r["raw"][0] for r in rows]) if item != "雨" else np.array([r["raw"] for r in rows])
        for c in range(lab_all.max() + 1):
            m = lab_all == c
            if m.sum() == 0:
                continue
            cen = anch[m].mean(0)
            words = describe_shape(cen, L) if item != "雨" else rain_desc(cen, L)
            mon = Counter(r["t"].month for r, mm in zip(rows, m) if mm)
            topm = "・".join(f"{mm}月{mon[mm] / m.sum():.0%}" for mm, _ in mon.most_common(3))
            share = m.mean()
            line = f"  [{item}｜{L}日前｜{how}・{method}・k={k}｜クラスター{c}] {words}｜当てはまる {share:.0%}（{m.sum()} 日）｜多い月 {topm}"
            print(line)
            for yn in ys:
                y = np.array([bool(r[yn]) for r in rows])
                pop_ok = np.ones(len(rows), bool)
                if yn == "y_miss":
                    pop_ok = np.array([r["pop"] < 50 for r in rows])
                if yn == "y_fa":
                    pop_ok = np.array([r["pop"] >= 50 for r in rows])
                mm_ = m & pop_ok
                if mm_[is_tr].sum() < 20 or mm_[~is_tr].sum() < 15:
                    print(f"     {yn}：件が少ない（作る {mm_[is_tr].sum()}・確かめる {mm_[~is_tr].sum()}）")
                    continue
                btr, bte = y[pop_ok & is_tr].mean(), y[pop_ok & ~is_tr].mean()
                rtr, rte = y[mm_ & is_tr].mean(), y[mm_ & ~is_tr].mean()
                nte = int((mm_ & ~is_tr).sum())
                pte = binom.sf(int(y[mm_ & ~is_tr].sum()) - 1, nte, bte)
                sub = [i for i in range(len(rows)) if pop_ok[i]]
                lo, hi = block_ratio_ci([rows[i]["t"] for i in sub], [bool(mm_[i]) for i in sub], [int(y[i]) for i in sub])
                full = y[mm_].mean() / y[pop_ok].mean()
                kept = rtr / btr >= 1.3 and rte / bte >= 1.3 and pte < 0.05
                dirn = ""
                if item != "雨":
                    es = [r["e"] for r, a in zip(rows, mm_ & y) if a]
                    dirn = f"｜向き：予報が高すぎ {sum(1 for e in es if e > 0) / max(1, len(es)):.0%}" if es else ""
                print(f"     {yn}：大外れ 作る {rtr:.0%}／{btr:.0%}・確かめる {rte:.0%}／{bte:.0%}（{nte} 件、p={pte:.3f}）｜全期間の倍率 {full:.2f}（{lo:.2f}〜{hi:.2f}）{dirn}｜{'残す' if kept else '—'}")
                if kept:
                    kept_all.append({"item": item, "L": L, "c": c, "yn": yn, "words": words, "mask": mm_, "rows": rows,
                                     "ratio": full, "ci": (lo, hi), "share": share, "rte": rte, "bte": bte, "topm": topm, "dirn": dirn})
            shape_fig.append((item, L, c, cen, words, m.sum()))
    figure_shapes(shape_fig)

    # ---------------------------------------------------------------- 3. 月別・季節別
    print("\n## 3a. 全期間で分けたクラスターの、月ごとの出方（％）と大外れの割合（気温、選んだ分け方）")
    month_tab = {}
    for (item, L), rows in data.items():
        if item == "雨":
            continue
        k = max(r["cl"][L] for r in rows) + 1
        for c in range(k):
            share = [np.mean([r["cl"][L] == c for r in rows if r["t"].month == m]) for m in range(1, 13)]
            rate = []
            for m in range(1, 13):
                sel = [r for r in rows if r["t"].month == m and r["cl"][L] == c]
                rate.append(np.mean([r["y"] for r in sel]) if len(sel) >= 8 else float("nan"))
            month_tab[(item, L, c)] = (share, rate)
            print(f"  {item} {L}日前 クラスター{c}：出方 " + " ".join(f"{m}月{s:.0%}" for m, s in zip(range(1, 13), share)))
            print(f"     大外れ " + " ".join(f"{m}月{'—' if x != x else f'{x:.0%}'}" for m, x in zip(range(1, 13), rate)))
    figure_months(month_tab)

    print("\n## 3b. 月の前後1か月の窓（3か月）ごとに分け直す（k-means・7日前を引く・k=4）。全期間の中心から遠い形（その時期だけの形）と、その外れやすさ")
    for item in ("最高", "最低"):
        for L in (1, 3):
            rows = data[(item, L)]
            g_cent = {}
            how = "7日前を引く"
            Xg = np.array([rep(r["raw"], how) for r in rows if r["t"] <= TRAIN_END])
            gk = KMeans(n_clusters=4, n_init=20, random_state=0).fit(Xg)
            within = np.sqrt(((Xg - gk.cluster_centers_[gk.labels_]) ** 2).sum(1)).mean()
            for m in range(1, 13):
                win = {((m - 1 + d) % 12) + 1 for d in (-1, 0, 1)}
                sub = [r for r in rows if r["t"].month in win]
                tr = [r for r in sub if r["t"] <= TRAIN_END]
                te = [r for r in sub if r["t"] > TRAIN_END]
                if len(tr) < 80:
                    win = {((m - 1 + d) % 12) + 1 for d in (-2, -1, 0, 1, 2)}
                    sub = [r for r in rows if r["t"].month in win]
                    tr = [r for r in sub if r["t"] <= TRAIN_END]
                    te = [r for r in sub if r["t"] > TRAIN_END]
                Xtr = np.array([rep(r["raw"], how) for r in tr])
                km = KMeans(n_clusters=4, n_init=20, random_state=0).fit(Xtr)
                lte = km.predict(np.array([rep(r["raw"], how) for r in te])) if te else np.array([])
                ytr = np.array([r["y"] for r in tr])
                yte = np.array([r["y"] for r in te])
                for c in range(4):
                    dist = np.sqrt(((gk.cluster_centers_ - km.cluster_centers_[c]) ** 2).sum(1)).min() / within
                    mtr, mte = km.labels_ == c, lte == c
                    if mtr.sum() < 15 or mte.sum() < 10:
                        continue
                    rtr, rte = ytr[mtr].mean() / max(ytr.mean(), 1e-9), yte[mte].mean() / max(yte.mean(), 1e-9)
                    pte = binom.sf(int(yte[mte].sum()) - 1, int(mte.sum()), yte.mean())
                    flag = "その時期だけの形" if dist >= 1.0 else "全期間にもある形"
                    if rtr >= 1.3 and rte >= 1.3 and pte < 0.05:
                        cen = km.cluster_centers_[c]
                        print(f"  {item} {L}日前 {m}月の窓 {sorted(win)}：{describe_shape(cen, L)}｜{flag}（全期間の中心との距離 {dist:.2f}）"
                              f"｜倍率 作る {rtr:.2f}・確かめる {rte:.2f}（{int(mte.sum())} 日、p={pte:.3f}）")

    # ---------------------------------------------------------------- 6. FS-05 の型との重なり
    print("\n## 6. 残ったクラスターと FS-05 の型（shared/forecastTypes.ts、PR #469 で固定）の重なり")
    def types_for(item, L, r):
        t = r["t"]
        out = []
        if item == "最低" and L == 1 and r["raw"][-1] - r["raw"][0] >= 2:
            out.append("A")
        if item == "最高" and L in (2, 3):
            p = wp.get((t, L), {}).get("pop")
            if p is not None and p >= 50:
                out.append("B")
        if item == "最高" and 4 <= L <= 7:
            p = wp.get((t, L), {}).get("pop")
            if p is not None and 50 <= p <= 60:
                out.append("B''")
        if item == "最高" and L <= 6 and 1 < abs(r["raw"][-1] - r["raw"][-2]) <= 3 and L >= 2:
            out.append("C" if L <= 3 else "C''")
        if item == "最低" and 4 <= L <= 7 and t.month in TURN:
            a = fc.get((t, L), {}).get("min")
            b = fc.get((t - timedelta(days=1), max(L - 1, 1)), {}).get("min")
            if a is not None and b is not None and -4 < a - b <= -2:
                out.append("E")
        if item == "雨" and t.month in (6, 7, 8) and 30 <= r["pop"] <= 40 and r["wx"] == "くもり" and L >= 2:
            out.append("G" if L <= 3 else "G'")
        return out
    for kc in kept_all:
        rows, m = kc["rows"], kc["mask"]
        tys = Counter()
        for r, mm in zip(rows, m):
            if mm:
                for ty in types_for(kc["item"], kc["L"], r):
                    tys[ty] += 1
        n = int(m.sum())
        jac = {}
        for ty in set(tys):
            tm = np.array([ty in types_for(kc["item"], kc["L"], r) for r in rows])
            jac[ty] = (m & tm).sum() / (m | tm).sum()
        print(f"  [{kc['item']}｜{kc['L']}日前｜クラスター{kc['c']}｜{kc['yn']}] {kc['words']}：倍率 {kc['ratio']:.2f}（{kc['ci'][0]:.2f}〜{kc['ci'][1]:.2f}）"
              f"｜型と重なる日 " + ("、".join(f"{ty} {cnt / n:.0%}（Jaccard {jac[ty]:.2f}）" for ty, cnt in tys.most_common()) or "なし"))


def figure_shapes(shape_fig):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    names = {x.name for x in font_manager.fontManager.ttflist}
    for f in ("Noto Sans CJK JP", "Noto Sans CJK TC"):
        if f in names:
            plt.rcParams["font.family"] = f
            break
    panels = sorted({(it, L) for it, L, *_ in shape_fig}, key=lambda x: (["最高", "最低", "雨"].index(x[0]), x[1]))
    fig, axes = plt.subplots(3, 3, figsize=(15, 12))
    for ax, (it, L) in zip(axes.flat, panels):
        for it2, L2, c, cen, words, n in shape_fig:
            if (it2, L2) != (it, L):
                continue
            if it == "雨":
                k = 8 - L
                xs = list(range(7, L - 1, -1))
                ax.plot(xs, cen[:k] * 100, marker="o", label=f"{c}：{n}日")
                ax.set_ylabel("降水確率（％）")
            else:
                xs = list(range(7, L - 1, -1))
                ax.plot(xs, np.concatenate([[0], cen]), marker="o", label=f"{c}：{n}日")
                ax.set_ylabel("7日前からの差（℃）")
        ax.invert_xaxis()
        ax.set_xlabel("何日前の予報")
        ax.set_title(f"{it}　{L}日前で判定", fontsize=10)
        ax.axhline(0, color="black", lw=0.5)
        ax.legend(fontsize=7)
    fig.suptitle("FS-06　クラスターの代表の形（全期間の平均。気温は7日前の予報からの差）", fontsize=12)
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, "fs06b_shapes.png"), dpi=90)
    print("[図] fs06b_shapes.png")


def figure_months(tab):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(2, 3, figsize=(15, 7), sharey=True)
    for ax, key in zip(axes.flat, sorted({(i, L) for i, L, c in tab}, key=lambda x: (["最高", "最低"].index(x[0]), x[1]))):
        bottom = np.zeros(12)
        for (i, L, c), (share, rate) in sorted(tab.items()):
            if (i, L) != key:
                continue
            ax.bar(range(1, 13), share, bottom=bottom, label=f"{c}")
            bottom += np.array(share)
        ax.set_title(f"{key[0]}　{key[1]}日前：クラスターの月ごとの出方", fontsize=10)
        ax.set_xticks(range(1, 13))
        ax.legend(fontsize=7, ncol=4)
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, "fs06b_months.png"), dpi=90)
    print("[図] fs06b_months.png")


if __name__ == "__main__":
    main(sys.argv[1])
