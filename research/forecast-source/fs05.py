"""FS-05：予報が外れやすい「型」を計算で見つける（高知、気象庁の府県・週間天気予報だけ。Open-Meteo は使わない）。

材料：shiromatz の記録（予報）、fs03_obs_47893.csv（最高・最低）、fs04_rain_47893.csv（日降水量）。外部は読まない。
1 件 ＝（対象日 t、何日前 L、項目）。予報を出した日 D＝t−L の、値のある中でいちばん遅い発表（FS-01 と同じ）。
型の材料は D の時点で分かることだけ：
  動き（7日前から L 日前までの予報の動き）、中身（天気の分類・降水確率・前の日からの予報気温の変化）、信頼度、予測範囲の広さ、
  季節、最近の外れ方（対象日が D−1 までの実績で作る EWMA、FS-04 の方法）、臨時の発表（D・D−1 に定時でない発表があったか）。
大外れ：気温は |予報−実績| > 2℃（比べに「その時期の 80% の範囲の外」）。雨は見逃し（降水確率 <50% で 1mm 以上）と空振り（≥50% で 1mm 未満）。
探し方：条件1つと2つの組み合わせを全部数える（何日前のまとまりごと）。作る期間 2024-02〜2025-10 で、件数の下限と
  偽の発見率（Benjamini–Hochberg、q＝0.05）で選び、確かめる期間 2025-11〜2026-10 で効き目が続いたものだけ残す。
  浅い決定木（深さ3）も比べに。
使い方：python3 -I fs05.py <forecast の ZIP があるフォルダ>
"""
import csv, io, math, os, random, statistics as st, sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from itertools import combinations

import numpy as np
from scipy.stats import binom

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs03 import find_csv, load_forecasts, load_obs  # noqa: E402
from fs04 import baseline, series, smoother  # noqa: E402
from fs04_rain import load_rain  # noqa: E402
from fs04_season import load_wx_pop  # noqa: E402

START, END = date(2024, 2, 1), date(2026, 10, 31)
TRAIN_END = date(2025, 10, 31)
SEASON = {12: "冬", 1: "冬", 2: "冬", 3: "春", 4: "春", 5: "春", 6: "夏", 7: "夏", 8: "夏", 9: "秋", 10: "秋", 11: "秋"}
GROUPS = {"1日前": (1,), "2〜3日前": (2, 3), "4〜7日前": (4, 5, 6, 7)}
MIN_TRAIN, MIN_TEST = 80, 40          # 件数の下限（件＝対象日×何日前）
MIN_DAYS_TRAIN, MIN_DAYS_TEST = 30, 20  # 対象日の数の下限


def irregular_days(folder):
    """定時（5・11・17時）でない府県天気予報の発表があった日。"""
    out = set()
    for fn in sorted(os.listdir(folder)):
        ym = fn[9:15]
        raw = find_csv(open(os.path.join(folder, fn), "rb").read(), f"forecast_{ym}_390000.csv")
        if raw is None:
            continue
        for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
            if r["areaCode"] == "390010" and r["reportDatetime"][11:13] not in ("05", "11", "17"):
                out.add(date.fromisoformat(r["reportDatetime"][:10]))
    return out


def bin_move(x):
    return None if x is None else ("0〜1℃" if x <= 1 else ("2〜3℃" if x <= 3 else "4℃以上"))


def build(folder):
    fc, obs, rain = load_forecasts(folder), load_obs(), load_rain()
    wp = load_wx_pop(folder)
    irr = irregular_days(folder)
    # 最近の外れ方（FS-04）：項目ごと、1〜7日前まとめの |e| の z を EWMA（半減期3日）。日 D の値は対象日 D−1 まで。
    J = {}
    for (t, l), v in fc.items():
        for k in ("max", "min"):
            if k in v and t in obs and obs[t][k] is not None and START <= t <= END:
                J[(k, l, t)] = v[k] - obs[t][k]
    base = baseline(J, TRAIN_END)
    recent = {}
    for k in ("max", "min"):
        ew, sig = smoother(series(J, (k,), tuple(range(1, 8)), base), 3, START - timedelta(days=10), END)
        recent[k] = (ew, sig)
    # 予測範囲の広さの「広い」：何日前ごとに作る期間の上位 25%
    widths = defaultdict(list)
    for (t, l), v in fc.items():
        for k in ("max", "min"):
            if k + "_up" in v and t <= TRAIN_END:
                widths[(k, l)].append(v[k + "_up"] - v[k + "_lo"])
    wide = {g: np.quantile(x, 0.75) for g, x in widths.items()}

    rows = []
    for (t, L), v in fc.items():
        if not (START <= t <= END):
            continue
        D = t - timedelta(days=L)
        w = wp.get((t, L), {})
        common = {
            "季節": SEASON[t.month], "季節の変わり目（3・4・10・11月）": "はい" if t.month in (3, 4, 10, 11) else "いいえ",
            "天気（予報）": w.get("wx"), "臨時の発表（予報した日か前の日）": "あり" if (D in irr or D - timedelta(days=1) in irr) else "なし",
        }
        pop = w.get("pop")
        if pop is not None:
            common["降水確率（予報）"] = "0〜20%" if pop <= 20 else ("30〜40%" if pop <= 40 else ("50〜60%" if pop <= 60 else "70%以上"))
        if L >= 3 and w.get("rel"):
            common["信頼度"] = w["rel"]
        # 降水確率の動き（7日前→L日前、2日前まで。1日前は作り方が違うので 2日前までの動き）
        pp = [wp.get((t, l), {}).get("pop") for l in range(max(L, 2), 8)]
        if len(pp) >= 2 and all(p is not None for p in pp):
            common["降水確率の動き（％、7日前から）"] = "0〜10" if sum(abs(pp[i] - pp[i + 1]) for i in range(len(pp) - 1)) <= 10 else ("20〜30" if sum(abs(pp[i] - pp[i + 1]) for i in range(len(pp) - 1)) <= 30 else "40以上")
        for k, nm in (("max", "最高"), ("min", "最低")):
            if k not in v or t not in obs or obs[t][k] is None:
                continue
            e = v[k] - obs[t][k]
            f = dict(common)
            seq = [fc.get((t, l), {}).get(k) for l in range(L, 8)]  # L 日前 … 7日前
            if L <= 6 and all(x is not None for x in seq):
                ds = [seq[i] - seq[i + 1] for i in range(len(seq) - 1)]  # 新しい − ひとつ前
                f["予報の動きの合計（7日前から）"] = bin_move(sum(abs(d) for d in ds))
                f["正味の動き（7日前から）"] = bin_move(abs(seq[0] - seq[-1]))
                f["直前の発表からの動き"] = bin_move(abs(ds[0]))
                nz = [d for d in ds if d != 0]
                f["行ったり来たり"] = "あり" if any(nz[i] * nz[i + 1] < 0 for i in range(len(nz) - 1)) else "なし"
                f["動いた向き（7日前から）"] = "上げた" if seq[0] - seq[-1] >= 2 else ("下げた" if seq[0] - seq[-1] <= -2 else "ほぼ同じ")
            prev = fc.get((t - timedelta(days=1), max(L - 1, 1)), {}).get(k)
            if prev is not None:
                dd = v[k] - prev
                f["前の日からの予報の変化"] = "4℃以上下がる" if dd <= -4 else ("2〜3℃下がる" if dd <= -2 else ("4℃以上上がる" if dd >= 4 else ("2〜3℃上がる" if dd >= 2 else "±1℃以内")))
            if k + "_up" in v:
                f["予測範囲"] = "広い（上位25%）" if v[k + "_up"] - v[k + "_lo"] >= wide[(k, L)] else "ふつう"
            ew, sig = recent[k]
            if D in ew:
                f["最近の外れ方（FS-04）"] = "ずれやすい" if ew[D]["abs"] > 2 * sig else "ふつう"
            rows.append({"t": t, "L": L, "item": nm, "e": e, "f": f})
        # 雨
        if pop is not None and t in rain:
            f = dict(common)
            if "降水確率の動き（％、7日前から）" in common:
                pass
            ew, sig = recent["max"]
            if D in ew:
                f["最近の外れ方（FS-04、最高）"] = "ずれやすい" if ew[D]["abs"] > 2 * sig else "ふつう"
            rows.append({"t": t, "L": L, "item": "雨", "pop": pop, "rain": rain[t] >= 1.0, "f": f})
    return rows, J, base


def targets(rows, J):
    """大外れの決め方（1）：気温は |e|>2℃ と、その時期の 80% の範囲の外（作る期間の何日前×前後2か月の 10%〜90% 点）。"""
    q = {}
    for k, nm in (("max", "最高"), ("min", "最低")):
        for L in range(1, 8):
            for m in range(1, 13):
                w = {((m - 1 + i) % 12) + 1 for i in (-2, -1, 0, 1, 2)}
                xs = [x for (kk, l, t), x in J.items() if kk == k and l == L and t <= TRAIN_END and t.month in w]
                q[(nm, L, m)] = (np.quantile(xs, 0.1), np.quantile(xs, 0.9))
    for r in rows:
        if r["item"] in ("最高", "最低"):
            lo, hi = q[(r["item"], r["L"], r["t"].month)]
            r["y_2度"] = abs(r["e"]) > 2
            r["y_範囲外"] = bool(r["e"] < lo or r["e"] > hi)
    return q


def bh(pvals, alpha=0.05):
    """Benjamini–Hochberg：残る p の閾値。"""
    ps = sorted(pvals)
    m = len(ps)
    thr = 0.0
    for i, p in enumerate(ps, 1):
        if p <= alpha * i / m:
            thr = p
    return thr


def block_ratio_ci(dates, inrule, y, block=7, B=2000, seed=3):
    """日付のブロックで、（型に当てはまる件の大外れ率）／（全部の件の大外れ率）の 95% の幅。"""
    days = sorted(set(dates))
    idx = defaultdict(list)
    for i, d in enumerate(dates):
        idx[d].append(i)
    rnd = random.Random(seed)
    n = len(days)
    res = []
    for _ in range(B):
        a = b = c = dd = 0
        for _ in range(math.ceil(n / block)):
            s = rnd.randrange(0, n - block + 1)
            for d in days[s:s + block]:
                for i in idx[d]:
                    c += 1
                    dd += y[i]
                    if inrule[i]:
                        a += 1
                        b += y[i]
        if a and dd:
            res.append((b / a) / (dd / c))
    res.sort()
    return res[int(0.025 * len(res))], res[int(0.975 * len(res))]


def search(rows, item, yname, cond_rows=None, label=None):
    """条件1つ・2つの型を探す。cond_rows：雨の見逃し（降水確率 <50%）・空振り（≥50%）の母集団の絞り込み。"""
    out = []
    for gname, leads in GROUPS.items():
        R = [r for r in rows if r["item"] == item and r["L"] in leads and (cond_rows is None or cond_rows(r))]
        if not R:
            continue
        y = np.array([bool(r[yname]) if yname in r else False for r in R])
        tr = np.array([r["t"] <= TRAIN_END for r in R])
        te = ~tr
        feats = sorted({k for r in R for k in r["f"] if r["f"][k] is not None})
        conds = []
        for k in feats:
            vals = Counter(r["f"].get(k) for r in R if r["f"].get(k) is not None)
            for v in vals:
                mask = np.array([r["f"].get(k) == v for r in R])
                conds.append(((k, v), mask))
        base_tr, base_te = y[tr].mean(), y[te].mean()
        cands = []
        for (c1, m1) in conds:
            cands.append(((c1,), m1))
        for (c1, m1), (c2, m2) in combinations(conds, 2):
            if c1[0] == c2[0]:
                continue
            cands.append(((c1, c2), m1 & m2))
        tested = []
        dates = np.array([r["t"] for r in R])
        for cs, m in cands:
            ntr, nte = int((m & tr).sum()), int((m & te).sum())
            if ntr < MIN_TRAIN or nte < MIN_TEST:
                continue
            if len(set(dates[m & tr])) < MIN_DAYS_TRAIN or len(set(dates[m & te])) < MIN_DAYS_TEST:
                continue
            ktr = int((y & m & tr).sum())
            p = binom.sf(ktr - 1, ntr, base_tr)  # 作る期間で、ふだんより多いか（片側）
            tested.append((cs, m, ntr, ktr, p))
        if not tested:
            continue
        thr = bh([x[4] for x in tested])
        single = {cs[0]: ktr / ntr for cs, m, ntr, ktr, p in tested if len(cs) == 1}
        for cs, m, ntr, ktr, p in tested:
            rate_tr = ktr / ntr
            if p > thr or rate_tr / base_tr < 1.5:
                continue
            # 2つの組み合わせは、どちらの1つより 1.1 倍以上高い時だけ（同じことの言い直しを減らす）
            if len(cs) == 2 and any(single.get(c, 0) * 1.1 > rate_tr for c in cs):
                continue
            nte = int((m & te).sum())
            kte = int((y & m & te).sum())
            rate_te = kte / nte
            p_te = binom.sf(kte - 1, nte, base_te)
            out.append({"item": label or item, "group": gname, "conds": cs, "n_tr": ntr, "rate_tr": rate_tr, "base_tr": base_tr,
                        "n_te": nte, "rate_te": rate_te, "base_te": base_te, "p_te": p_te, "mask": m, "R": R, "y": y,
                        "kept": rate_te / base_te >= 1.3 and p_te < 0.05})
        print(f"  [{label or item} {yname} {gname}] 件 {len(R)}（作る {tr.sum()}・確かめる {te.sum()}）ふだん {base_tr:.1%}／{base_te:.1%}"
              f"　数えた型 {len(tested)}、偽の発見率で残った {sum(1 for x in tested if x[4] <= thr)}")
    return out


def describe(cs):
    return " かつ ".join(f"{k}＝{v}" for k, v in cs)


def main(folder):
    rows, J, base = build(folder)
    q = targets(rows, J)
    T = [r for r in rows if r["item"] in ("最高", "最低")]
    Rn = [r for r in rows if r["item"] == "雨"]
    print("件：気温", len(T), "雨", len(Rn))

    # ---------------------------------------------------------------- 1. 大外れの決め方
    print("\n## 1. 大外れの決め方（全期間の割合、何日前ごと）")
    for item in ("最高", "最低"):
        line = []
        for L in range(1, 8):
            R = [r for r in T if r["item"] == item and r["L"] == L]
            a = st.mean(r["y_2度"] for r in R)
            b = st.mean(r["y_範囲外"] for r in R)
            both = st.mean(r["y_2度"] and r["y_範囲外"] for r in R)
            line.append(f"{L}日 2℃超 {a:.0%}・範囲外 {b:.0%}・両方 {both:.0%}")
        print(f"  {item}：" + "｜".join(line))
    for L in range(1, 8):
        R = [r for r in Rn if r["L"] == L]
        lo = [r for r in R if r["pop"] < 50]
        hi = [r for r in R if r["pop"] >= 50]
        print(f"  雨 {L}日：見逃し（<50% の日のうち降った）{st.mean(r['rain'] for r in lo):.0%}（{len(lo)}）・空振り（≥50% の日のうち降らなかった）{st.mean(not r['rain'] for r in hi):.0%}（{len(hi)}）")
    for r in Rn:
        r["y_見逃し"] = r["rain"] and r["pop"] < 50
        r["y_空振り"] = (not r["rain"]) and r["pop"] >= 50

    # ---------------------------------------------------------------- 2・3. 探す・確かめる
    print("\n## 2・3. 型を探す（作る期間）→ 確かめる（確かめる期間）。下限：件 作る≥%d・確かめる≥%d、対象日 作る≥%d・確かめる≥%d。偽の発見率 q=0.05、倍率 ≥1.5（作る）" % (MIN_TRAIN, MIN_TEST, MIN_DAYS_TRAIN, MIN_DAYS_TEST))
    found = []
    for item in ("最高", "最低"):
        found += search(rows, item, "y_2度")
    found += search(rows, "雨", "y_見逃し", cond_rows=lambda r: r["pop"] < 50, label="雨の見逃し")
    found += search(rows, "雨", "y_空振り", cond_rows=lambda r: r["pop"] >= 50, label="雨の空振り")
    # 範囲外の定義でも同じ型が残るか（比べ）
    alt = []
    for item in ("最高", "最低"):
        alt += search(rows, item, "y_範囲外")

    print(f"\n  作る期間で残った型 {len(found)}、確かめる期間で効き目が続いた型 {sum(f['kept'] for f in found)}")
    print("\n## 4. 残った型（効き目が続いたもの）：当てはまる割合・大外れの割合（全期間）・ふだんとの倍率（95% の幅、ブロック7日）・向き・季節")
    kept = [f for f in found if f["kept"]]
    kept.sort(key=lambda f: (f["item"], f["group"], -f["rate_te"] / f["base_te"]))
    for f in kept:
        R, m, y = f["R"], f["mask"], f["y"]
        dates = [r["t"] for r in R]
        lo, hi = block_ratio_ci(dates, list(m), list(y.astype(int)))
        share = m.mean()
        rate = y[m].mean()
        basea = y.mean()
        # 向き（気温）：大外れの件の予報−実績の符号
        dirn = ""
        if f["item"] in ("最高", "最低"):
            es = [R[i]["e"] for i in range(len(R)) if m[i] and y[i]]
            dirn = f"向き：予報が高すぎ {sum(1 for e in es if e > 0) / len(es):.0%}・低すぎ {sum(1 for e in es if e < 0) / len(es):.0%}"
        sea = Counter(SEASON[R[i]["t"].month] for i in range(len(R)) if m[i])
        tot = sum(sea.values())
        seas = " ".join(f"{s}{sea[s] / tot:.0%}" for s in ("春", "夏", "秋", "冬"))
        f["full"] = (share, rate, basea, lo, hi, dirn, seas)
        print(f"  [{f['item']}｜{f['group']}] {describe(f['conds'])}")
        print(f"     当てはまる {share:.1%}（{int(m.sum())} 件）大外れ {rate:.0%}／ふだん {basea:.0%} 倍率 {rate / basea:.2f}（{lo:.2f}〜{hi:.2f}）"
              f"｜作る {f['rate_tr']:.0%}/{f['base_tr']:.0%}（{f['n_tr']}）確かめる {f['rate_te']:.0%}/{f['base_te']:.0%}（{f['n_te']}、p={f['p_te']:.3f}）｜{dirn}｜季節 {seas}")
    print("\n  効き目が続かなかった型（作る期間では残ったもの、倍率の大きい順に 15）")
    for f in sorted([f for f in found if not f["kept"]], key=lambda f: -f["rate_tr"] / f["base_tr"])[:15]:
        print(f"    [{f['item']}｜{f['group']}] {describe(f['conds'])}：作る {f['rate_tr']:.0%}/{f['base_tr']:.0%}（{f['n_tr']}）→ 確かめる {f['rate_te']:.0%}/{f['base_te']:.0%}（{f['n_te']}）")
    print("\n  比べ：大外れを「その時期の 80% の範囲の外」にした時に、確かめる期間で残った型")
    for f in [f for f in alt if f["kept"]]:
        print(f"    [{f['item']}｜{f['group']}] {describe(f['conds'])}：確かめる {f['rate_te']:.0%}/{f['base_te']:.0%}（{f['n_te']}）")

    # ---------------------------------------------------------------- 6. 重なり
    print("\n## 6. 型どうしの重なり（同じ項目・同じ何日前の中で、当てはまる件の Jaccard ≥ 0.5 の組）")
    for a, b in combinations(kept, 2):
        if a["item"] == b["item"] and a["group"] == b["group"]:
            j = (a["mask"] & b["mask"]).sum() / (a["mask"] | b["mask"]).sum()
            if j >= 0.5:
                print(f"  {j:.2f}：{describe(a['conds'])} ／ {describe(b['conds'])}")

    # ---------------------------------------------------------------- 比べ：浅い決定木
    print("\n## 比べ：浅い決定木（深さ3、葉の件 ≥ 作る期間の 3%）。確かめる期間で、大外れの割合がふだんの 1.3 倍以上の葉")
    from sklearn.tree import DecisionTreeClassifier
    for item, yname, flt in (("最高", "y_2度", None), ("最低", "y_2度", None), ("雨", "y_見逃し", lambda r: r["pop"] < 50), ("雨", "y_空振り", lambda r: r["pop"] >= 50)):
        for gname, leads in GROUPS.items():
            R = [r for r in rows if r["item"] == item and r["L"] in leads and (flt is None or flt(r))]
            keys = sorted({(k, v) for r in R for k, v in r["f"].items() if v is not None})
            X = np.array([[1 if r["f"].get(k) == v else 0 for k, v in keys] for r in R])
            y = np.array([bool(r[yname]) for r in R])
            tr = np.array([r["t"] <= TRAIN_END for r in R])
            clf = DecisionTreeClassifier(max_depth=3, min_samples_leaf=max(30, int(0.03 * tr.sum())), random_state=0).fit(X[tr], y[tr])
            leaf = clf.apply(X)
            base_te = y[~tr].mean()
            tree = clf.tree_
            def path(node_id):
                # 葉までの条件を集める
                parent = {}
                for i in range(tree.node_count):
                    for ch, side in ((tree.children_left[i], "でない"), (tree.children_right[i], "")):
                        if ch != -1:
                            parent[ch] = (i, side)
                cs = []
                n = node_id
                while n in parent:
                    p, side = parent[n]
                    k, v = keys[tree.feature[p]]
                    cs.append(f"{k}＝{v}{side}")
                    n = p
                return " かつ ".join(reversed(cs))
            for lf in sorted(set(leaf)):
                mte = (leaf == lf) & ~tr
                if mte.sum() >= MIN_TEST and y[mte].mean() >= 1.3 * base_te:
                    print(f"  [{item} {yname[2:]}｜{gname}] {path(lf)}：確かめる {y[mte].mean():.0%}/{base_te:.0%}（{mte.sum()}）")


if __name__ == "__main__":
    main(sys.argv[1])
