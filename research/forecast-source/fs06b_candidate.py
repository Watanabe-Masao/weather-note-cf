"""FS-06 の候補「最高の予報が 7日前から下がり続けた日」を、言葉どおりの決まりにして確かめる（季節を分けて）。

決まり：最高の予報の並び（7日前 → L 日前）が、どの発表でも上がらず（＋1℃未満の揺れは許さない＝上がらない）、7日前から 2℃以上下がった。
使い方：python3 -I fs06b_candidate.py <forecast の ZIP があるフォルダ>
"""
import os, sys
import numpy as np
from scipy.stats import binom

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs05 import block_ratio_ci  # noqa: E402
from fs06b import TRAIN_END, build  # noqa: E402

data, drop, fc, wp = build(sys.argv[1])
for L in (1, 3, 5):
    rows = data[("最高", L)]
    for name, months in (("全部の月", set(range(1, 13))), ("秋（9〜11月）", {9, 10, 11}), ("8〜11月", {8, 9, 10, 11}), ("それ以外（12〜7月）", {12, 1, 2, 3, 4, 5, 6, 7})):
        sub = [r for r in rows if r["t"].month in months]
        m = np.array([bool((np.diff(r["raw"]) <= 0).all() and r["raw"][-1] - r["raw"][0] <= -2) for r in sub])
        y = np.array([bool(r["y"]) for r in sub])
        tr = np.array([r["t"] <= TRAIN_END for r in sub])
        if (m & tr).sum() < 10 or (m & ~tr).sum() < 10:
            print(f"  {L}日前 {name}：件が少ない（作る {(m & tr).sum()}・確かめる {(m & ~tr).sum()}）")
            continue
        rtr, btr = y[m & tr].mean(), y[tr].mean()
        rte, bte = y[m & ~tr].mean(), y[~tr].mean()
        p = binom.sf(int(y[m & ~tr].sum()) - 1, int((m & ~tr).sum()), bte)
        lo, hi = block_ratio_ci([r["t"] for r in sub], list(m), list(y.astype(int)))
        es = [r["e"] for r, a in zip(sub, m & y) if a]
        print(f"  {L}日前 {name}：当てはまる {m.mean():.0%}（{m.sum()} 日）｜作る {rtr:.0%}/{btr:.0%}（{(m & tr).sum()}）確かめる {rte:.0%}/{bte:.0%}（{(m & ~tr).sum()}、p={p:.3f}）"
              f"｜全期間の倍率 {y[m].mean() / y.mean():.2f}（{lo:.2f}〜{hi:.2f}）｜向き：予報が高すぎ {sum(1 for e in es if e > 0) / max(1, len(es)):.0%}")
