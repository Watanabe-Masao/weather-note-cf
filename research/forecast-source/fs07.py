"""FS-07：最後の降水確率が同じでも、そこに至る経路で降った割合が違うか（高知、気象庁の予報だけ）。

決め方は README の FS-07 の節（数える前に書いた）のとおり。
- 判断の確率：前日（1日前）の府県天気予報の6時間降水確率の最大（fs04_season.load_wx_pop の 1日前）。
- 経路：週間の日降水確率の 5日前 → 2日前の動き Δ（±20 で上がってきた・横ばい・下がってきた）。
- 降った：日降水量 1mm 以上（fs04_rain_47893.csv）。
- 区切りのまとめ方・幅は作る期間（2024-02〜2025-10）だけで決め、確かめる期間（2025-11〜2026-10）で1回だけ数える。
使い方：python3 -I fs07.py <forecast の ZIP があるフォルダ>   （図 fs07_paths.png も作る）
      python3 -I fs07.py early <forecast の ZIP があるフォルダ>   （手前の期間 2021-11〜2024-01 で、judge_aligned で1回だけ数える）
"""
import math, os, random, statistics as st, sys
from collections import Counter, defaultdict
from datetime import date, timedelta

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs04_rain import load_rain  # noqa: E402
from fs04_season import load_wx_pop  # noqa: E402

START, END = date(2024, 2, 1), date(2026, 10, 31)
TRAIN_END = date(2025, 10, 31)
STEP = 20
MIN_N = 20
HERE = os.path.dirname(os.path.abspath(__file__))
PATHS = ("上がってきた", "横ばい", "下がってきた")


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def path_of(dlt, step):
    return "上がってきた" if dlt >= step else ("下がってきた" if dlt <= -step else "横ばい")


def load(folder):
    wp, rain = load_wx_pop(folder), load_rain()
    rows, miss = [], Counter()
    for t in days(START, END):
        p1 = wp.get((t, 1), {}).get("pop")
        p2 = wp.get((t, 2), {}).get("pop")
        p5 = wp.get((t, 5), {}).get("pop")
        r = rain.get(t)
        lack = [n for n, v in (("前日の確率", p1), ("2日前", p2), ("5日前", p5), ("実績", r)) if v is None]
        if lack:
            for n in lack:
                miss[n] += 1
            miss["使わなかった日"] += 1
            continue
        rows.append({"t": t, "p1": p1, "d": p2 - p5, "p2": p2, "p5": p5, "rain": r >= 1.0})
    return rows, miss


def merge_bins(train, step):
    """作る期間だけで、10% の区切りをとなりとまとめる。比べる経路（上・下）のどちらかと横ばいが 20 件以上になるまで。"""
    cnt = defaultdict(Counter)
    for r in train:
        cnt[r["p1"]][path_of(r["d"], step)] += 1
    vals = sorted(cnt)
    bins, cur = [], []
    for v in vals:
        cur.append(v)
        c = Counter()
        for x in cur:
            c.update(cnt[x])
        if c["横ばい"] >= MIN_N and (c["上がってきた"] >= MIN_N or c["下がってきた"] >= MIN_N):
            bins.append(tuple(cur))
            cur = []
    if cur:
        if bins:
            bins[-1] = bins[-1] + tuple(cur)
        else:
            bins.append(tuple(cur))
    return bins


def bin_of(p, bins):
    for b in bins:
        if p in b:
            return b
    # 作る期間に無かった値：いちばん近い区切りへ
    return min(bins, key=lambda b: min(abs(p - x) for x in b))


def label(b):
    return f"{min(b)}%" if len(b) == 1 else f"{min(b)}〜{max(b)}%"


def stratified_diff(rows, bins, step, path, comparable):
    """区切りをそろえた差：区切りごとの（path の降った割合 − 横ばいの降った割合）を、横ばいの件数で重みづけた平均。"""
    num = den = 0.0
    for b in bins:
        if (b, path) not in comparable:
            continue
        a = [r["rain"] for r in rows if bin_of(r["p1"], bins) == b and path_of(r["d"], step) == path]
        h = [r["rain"] for r in rows if bin_of(r["p1"], bins) == b and path_of(r["d"], step) == "横ばい"]
        if not a or not h:
            continue
        num += len(h) * (np.mean(a) - np.mean(h))
        den += len(h)
    return num / den if den else float("nan")


def boot_ci(rows, bins, step, path, comparable, block=7, B=2000, seed=7):
    """対象日を7日ずつのブロックで選び直すブートストラップの 95% の幅。"""
    byday = sorted(rows, key=lambda r: r["t"])
    ds = sorted({r["t"] for r in byday})
    idx = defaultdict(list)
    for r in byday:
        idx[r["t"]].append(r)
    # 暦日で並べる（欠けた日もブロックの中に置く）
    cal = list(days(ds[0], ds[-1]))
    rnd = random.Random(seed)
    res = []
    n = len(cal)
    for _ in range(B):
        s = []
        for _ in range(math.ceil(n / block)):
            i = rnd.randrange(0, n - block + 1)
            for d in cal[i:i + block]:
                s += idx.get(d, [])
        v = stratified_diff(s, bins, step, path, comparable)
        if v == v:
            res.append(v)
    res.sort()
    return res[int(0.025 * len(res))], res[int(0.975 * len(res))]


def rate_ci(rows, block=7, B=1000, seed=11):
    """降った割合の 95% の幅（暦日を7日ずつのブロックで選び直す）。"""
    if len(rows) < 5:
        return float("nan"), float("nan")
    idx = defaultdict(list)
    for r in rows:
        idx[r["t"]].append(r["rain"])
    cal = list(days(START, END))
    rnd = random.Random(seed)
    res = []
    n = len(cal)
    for _ in range(B):
        s = []
        for _ in range(math.ceil(n / block)):
            i = rnd.randrange(0, n - block + 1)
            for d in cal[i:i + block]:
                s += idx.get(d, [])
        if s:
            res.append(np.mean(s))
    res.sort()
    return res[int(0.025 * len(res))], res[int(0.975 * len(res))]


def table(rows, bins, step, title, ci=False):
    print(f"\n[{title}]（±{step}）")
    out = {}
    for b in bins:
        for pth in PATHS:
            sel = [r for r in rows if bin_of(r["p1"], bins) == b and path_of(r["d"], step) == pth]
            if not sel:
                continue
            rate = np.mean([r["rain"] for r in sel])
            miss = sum(1 for r in sel if r["p1"] < 50 and r["rain"])
            fa = sum(1 for r in sel if r["p1"] >= 50 and not r["rain"])
            bs = np.mean([(r["p1"] / 100 - r["rain"]) ** 2 for r in sel])
            lo, hi = rate_ci(sel) if ci else (float("nan"), float("nan"))
            out[(b, pth)] = (len(sel), rate, miss, fa, bs, lo, hi)
            cis = f"（{lo:.0%}〜{hi:.0%}）" if ci else ""
            print(f"  前日 {label(b):>8}｜{pth:　<6}｜{len(sel):4d} 件｜降った {rate:5.1%}{cis}｜見逃し {miss:3d}・空振り {fa:3d}｜BS {bs:.3f}")
    return out


def main(folder):
    rows, miss = load(folder)
    train = [r for r in rows if r["t"] <= TRAIN_END]
    test = [r for r in rows if r["t"] > TRAIN_END]
    print(f"使った日 {len(rows)}（作る {len(train)}・確かめる {len(test)}）、欠け {dict(miss)}")

    # ---------------------------------------------------------------- 作る期間：まとめ方と、幅の試し
    print("\n## 作る期間（2024-02〜2025-10）だけで決める")
    tried = {}
    for step in (10, 20, 30):
        bins = merge_bins(train, step)
        tab = table(train, bins, step, f"作る期間・幅 ±{step}")
        comparable = {(b, p) for b in bins for p in ("上がってきた", "下がってきた")
                      if tab.get((b, p), (0,))[0] >= MIN_N and tab.get((b, "横ばい"), (0,))[0] >= MIN_N}
        diffs = {p: stratified_diff(train, bins, step, p, comparable) for p in ("上がってきた", "下がってきた")}
        print(f"  区切り {[label(b) for b in bins]}、比べられる組 {sorted((label(b), p) for b, p in comparable)}")
        print(f"  区切りをそろえた差（横ばいとの差）：" + "、".join(f"{p} {v * 100:+.1f} 点" for p, v in diffs.items()))
        tried[step] = (bins, comparable)
    bins, comparable = tried[STEP]
    print(f"\n→ 本筋は ±{STEP}（FS-06 の POP_STEP に合わせる、決め方どおり）。区切り：{[label(b) for b in bins]}")

    # 作る期間の差と区間（本筋の幅）
    for p in ("上がってきた", "下がってきた"):
        v = stratified_diff(train, bins, STEP, p, comparable)
        lo, hi = boot_ci(train, bins, STEP, p, comparable)
        print(f"  作る期間：{p} − 横ばい ＝ {v * 100:+.1f} 点（95% {lo * 100:+.1f}〜{hi * 100:+.1f}）")

    # ---------------------------------------------------------------- 確かめる期間：1回だけ
    print("\n## 確かめる期間（2025-11〜2026-10、FS-06 の確かめにも使った期間）で1回だけ数える")
    tab_te = table(test, bins, STEP, "確かめる期間", ci=True)
    verdict = {}
    for p in ("上がってきた", "下がってきた"):
        short = [label(b) for b in bins if (b, p) in comparable and (tab_te.get((b, p), (0,))[0] < MIN_N or tab_te.get((b, "横ばい"), (0,))[0] < MIN_N)]
        never = [label(b) for b in bins if (b, p) not in comparable]
        print(f"  {p}：確かめる期間で 20 件に届かない区切り {short or 'なし'}／作る期間で比べられなかった区切り {never or 'なし'}（どちらも「件数が足りず判断できない」）")
        v = stratified_diff(test, bins, STEP, p, comparable)
        lo, hi = boot_ci(test, bins, STEP, p, comparable)
        ok = abs(v) >= 0.10 and (lo > 0 or hi < 0)
        verdict[p] = (v, lo, hi, ok)
        print(f"  確かめる期間：{p} − 横ばい ＝ {v * 100:+.1f} 点（95% {lo * 100:+.1f}〜{hi * 100:+.1f}）→ {'差がある' if ok else '差があるとは言えない'}")

    # 全期間（参考）と季節（参考）
    print("\n## 参考：全期間と季節（夏 6〜8月／それ以外）")
    tab_all = table(rows, bins, STEP, "全期間", ci=True)
    for p in ("上がってきた", "下がってきた"):
        v = stratified_diff(rows, bins, STEP, p, comparable)
        lo, hi = boot_ci(rows, bins, STEP, p, comparable)
        print(f"  全期間：{p} − 横ばい ＝ {v * 100:+.1f} 点（95% {lo * 100:+.1f}〜{hi * 100:+.1f}）")
    for name, months in (("夏（6〜8月）", {6, 7, 8}), ("それ以外", set(range(1, 13)) - {6, 7, 8})):
        sub = [r for r in rows if r["t"].month in months]
        table(sub, bins, STEP, f"全期間・{name}")
        for p in ("上がってきた", "下がってきた"):
            v = stratified_diff(sub, bins, STEP, p, comparable)
            print(f"  {name}：{p} − 横ばい ＝ {'—' if v != v else f'{v * 100:+.1f} 点'}")

    figure(tab_all, bins)

    # ---------------------------------------------------------------- 後から足した確かめ（決め方の外）
    print("\n## 後から足した確かめ（決め方の外）：まとめた区切りの中で、前日の確率の中身が経路で違わないか")
    for per, sel in (("作る", lambda r: r["t"] <= TRAIN_END), ("確かめる", lambda r: r["t"] > TRAIN_END), ("全期間", lambda r: True)):
        for b in bins:
            if len(b) == 1:
                continue
            for pth in PATHS:
                sub = [r for r in rows if sel(r) and r["p1"] in b and path_of(r["d"], STEP) == pth]
                if not sub:
                    continue
                c = Counter(r["p1"] for r in sub)
                rate = np.mean([r["rain"] for r in sub])
                mp = np.mean([r["p1"] for r in sub])
                print(f"  {per} {label(b)} {pth}：{len(sub)} 件、前日の確率の平均 {mp:.0f}%（内訳 {dict(sorted(c.items()))}）、降った {rate:.0%}、確率との差 {rate * 100 - mp:+.0f} 点")
    fine = [(v,) for v in range(0, 101, 10)]
    fine_cmp = {(b, "上がってきた") for b in fine if 30 <= b[0] <= 60}
    print("  10% ごとにそろえた差（30〜60%、上がってきた − 横ばい、横ばいの件数で重み、同じ7日ブロックの幅）")
    for per, sub in (("作る", train), ("確かめる", test), ("全期間", rows)):
        v = stratified_diff(sub, fine, STEP, "上がってきた", fine_cmp)
        lo, hi = boot_ci(sub, fine, STEP, "上がってきた", fine_cmp)
        print(f"    {per}：{v * 100:+.1f} 点（95% {lo * 100:+.1f}〜{hi * 100:+.1f}）")


def figure(tab, bins):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    names = {x.name for x in font_manager.fontManager.ttflist}
    for f in ("Noto Sans CJK JP", "Noto Sans CJK TC"):
        if f in names:
            plt.rcParams["font.family"] = f
            break
    fig, ax = plt.subplots(figsize=(10, 4.5))
    w = 0.27
    for i, pth in enumerate(PATHS):
        xs, ys, ns = [], [], []
        for j, b in enumerate(bins):
            if (b, pth) in tab:
                n, rate = tab[(b, pth)][:2]
                xs.append(j + (i - 1) * w)
                ys.append(rate * 100)
                ns.append(n)
        bars = ax.bar(xs, ys, width=w, label=pth)
        for x, y, n in zip(xs, ys, ns):
            ax.text(x, y + 1, f"{n}", ha="center", fontsize=7)
    ax.set_xticks(range(len(bins)))
    ax.set_xticklabels([label(b) for b in bins])
    ax.set_xlabel("前日の降水確率（府県、6時間の最大）")
    ax.set_ylabel("実際に降った割合（％、1mm 以上）")
    ax.set_title("FS-07　前日の降水確率ごとの、5日前→2日前の動き（週間）別の降った割合（全期間 2024-02〜2026-10、数字は件数）\n"
                 "注意：まとめた区切り（30〜60%）の中では、上がってきた日の前日の確率が高め（平均 49%、横ばいは 42%）。10% ごとにそろえると差は +11 点（95% −6〜+30）", fontsize=9)
    ax.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, "fs07_paths.png"), dpi=100)
    print("[図] fs07_paths.png")


# ---------------------------------------------------------------- 確かめ直しの決め方（2026-11-24 の判断で切り替え）
# 理由：作る期間で「20 件になるまでとなりとまとめる」とした区切り（30〜60%）の中に、前日の確率の違いが残った
# （上がってきた日の平均 49%、横ばいの日 42%）。そのため、確かめ直しは 10% ごとにそろえる。
# - 区切り：前日の確率の 10% ごと（まとめない）。
# - 差：区切りごとに（上がってきた − 横ばい）の降った割合の差を出し、横ばいの件数で重みをつけて1つにまとめる
#   （両方が1件以上ある区切りだけ）。stratified_diff と同じ計算。
# - 件数：20 件以上かは、差に入った区切りの合計で判断する（上がってきた・横ばいのどちらも合計 20 件以上）。
# - 合格：差が 10 点以上、かつ 7日ブロックのブートストラップの 95% の幅が 0 をまたがない（今のまま）。
# - 合否は 1年分（2026-11〜2027-10）がそろってから。半年（〜2027-04）の時点では件数だけ数える（count_only）。
FINE_BINS = [(v,) for v in range(0, 101, 10)]


def aligned_pairs(rows, path="上がってきた", step=STEP):
    """差に入る区切り（両方が1件以上）と、その合計の件数。"""
    used, n_path, n_flat = [], 0, 0
    for b in FINE_BINS:
        a = sum(1 for r in rows if r["p1"] == b[0] and path_of(r["d"], step) == path)
        h = sum(1 for r in rows if r["p1"] == b[0] and path_of(r["d"], step) == "横ばい")
        if a and h:
            used.append(b)
            n_path += a
            n_flat += h
    return used, n_path, n_flat


def count_only(rows, path="上がってきた"):
    """半年の時点：件数だけ（差も合否も出さない）。"""
    used, n_path, n_flat = aligned_pairs(rows, path)
    return {"区切り": [label(b) for b in used], path: n_path, "横ばい": n_flat}


def judge_aligned(rows, path="上がってきた"):
    """1年分がそろった時点の判定。返り値：判定、差、95% の幅、件数。"""
    used, n_path, n_flat = aligned_pairs(rows, path)
    if n_path < MIN_N or n_flat < MIN_N:
        return {"判定": "件数が足りず判断できない", path: n_path, "横ばい": n_flat}
    comparable = {(b, path) for b in used}
    v = stratified_diff(rows, FINE_BINS, STEP, path, comparable)
    lo, hi = boot_ci(rows, FINE_BINS, STEP, path, comparable)
    ok = abs(v) >= 0.10 and (lo > 0 or hi < 0)
    return {"判定": "差がある" if ok else "差があるとは言えない", "差": v, "幅": (lo, hi), path: n_path, "横ばい": n_flat}


# ---------------------------------------------------------------- 手前の期間で確かめる（11/24 渡辺さん OK）
# 期間 2021-11-01〜2024-01-31（shiromatz の記録の始まり〜作る期間の前）。実績は fs07_rain_47893_early.csv。
# 決め方は judge_aligned のまま（変えない）。この期間で1回だけ数える。季節ごとは件数だけ（合否は全体で）。
EARLY_START, EARLY_END = date(2021, 11, 1), date(2024, 1, 31)
SEASONS = (("春（3〜5月）", (3, 4, 5)), ("夏（6〜8月）", (6, 7, 8)), ("秋（9〜11月）", (9, 10, 11)), ("冬（12〜2月）", (12, 1, 2)))


def load_early_rain():
    out = {}
    with open(os.path.join(HERE, "fs07_rain_47893_early.csv"), encoding="utf-8") as f:
        next(f)
        for line in f:
            d, v = line.strip().split(",")
            out[date.fromisoformat(d)] = float(v)
    return out


def load_early(folder):
    wp, rain = load_wx_pop(folder), load_early_rain()
    rows, miss = [], Counter()
    for t in days(EARLY_START, EARLY_END):
        p1, p2, p5 = (wp.get((t, L), {}).get("pop") for L in (1, 2, 5))
        r = rain.get(t)
        lack = [n for n, v in (("前日の確率", p1), ("2日前", p2), ("5日前", p5), ("実績", r)) if v is None]
        if lack:
            for n in lack:
                miss[n] += 1
            miss["使わなかった日"] += 1
            continue
        rows.append({"t": t, "p1": p1, "d": p2 - p5, "p2": p2, "p5": p5, "rain": r >= 1.0})
    return rows, miss


def main_early(folder):
    rows, miss = load_early(folder)
    print(f"期間 {EARLY_START}〜{EARLY_END}：使った日 {len(rows)}、欠け {dict(miss)}")
    print("経路の件数", Counter(path_of(r["d"], STEP) for r in rows))
    for path in ("上がってきた", "下がってきた"):
        res = judge_aligned(rows, path)
        used, _, _ = aligned_pairs(rows, path)
        print(f"\n[{path} と 横ばい] 差に入った区切り {[label(b) for b in used]}")
        print({k: (round(v, 3) if isinstance(v, float) else tuple(round(x, 3) for x in v) if isinstance(v, tuple) else v) for k, v in res.items()})
        for b in used:
            a = [r["rain"] for r in rows if r["p1"] == b[0] and path_of(r["d"], STEP) == path]
            h = [r["rain"] for r in rows if r["p1"] == b[0] and path_of(r["d"], STEP) == "横ばい"]
            print(f"  {label(b)}：{path} {sum(a)}/{len(a)}、横ばい {sum(h)}/{len(h)}")
        for name, ms in SEASONS:
            print("  ", name, count_only([r for r in rows if r["t"].month in ms], path))


if __name__ == "__main__":
    if sys.argv[1] == "early":
        main_early(sys.argv[2])
    else:
        main(sys.argv[1])
