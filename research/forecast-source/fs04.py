"""FS-04：予報の当たり具合のふりかえりの指標（EWMA 管理図）。高知、気象庁の府県・週間天気予報、1〜7日前、最高・最低。

材料は FS-03 と同じ（shiromatz の記録・fs03_obs_47893.csv）。外部は読まない。
使い方：python3 -I fs04.py <forecast の ZIP があるフォルダ>

向き：d = 実際 − 予報（℃）。上に外れた分 up = max(d, 0)、下に外れた分 dn = max(−d, 0)、大きさ |d| = up + dn。
ふだん：何日前 × 対象日の月の前後2か月（5か月の窓）で、作る期間の平均と標準偏差。
直近：その日の時点で答えの分かっている誤差（対象日が昨日まで）を、日ごとに EWMA（半減期 h 日）。
標準化 z = (x − ふだん平均) / ふだん標準偏差 を EWMA し、管理の線 ±L·σ_EWMA（σ_EWMA = √(λ/(2−λ))、独立を仮定）と比べる。
"""
import math, os, statistics as st, sys
from collections import Counter, defaultdict
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs03 import load_forecasts, load_obs  # noqa: E402

START, END = date(2024, 2, 1), date(2026, 10, 31)
TRAIN_END = date(2025, 10, 31)
HALF = (3, 5, 7, 14)
LS = (1.5, 2.0, 2.5, 3.0)
SEASON = {12: "冬", 1: "冬", 2: "冬", 3: "春", 4: "春", 5: "春", 6: "夏", 7: "夏", 8: "夏", 9: "秋", 10: "秋", 11: "秋"}
KEYS = (("max", "最高"), ("min", "最低"))


def window(m):
    return {((m - 1 + k) % 12) + 1 for k in (-2, -1, 0, 1, 2)}


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def build(folder):
    fc, obs = load_forecasts(folder), load_obs()
    D = {}  # (key, lead, 対象日) -> d
    for (t, lead), v in fc.items():
        if START <= t <= END and t in obs:
            for key, _ in KEYS:
                if key in v and obs[t][key] is not None:
                    D[(key, lead, t)] = obs[t][key] - v[key]
    return D, obs, fc


def baseline(D, keys, leads, until):
    """ふだん：（何日前, 月）ごとに |d|・up・dn・d の平均と標準偏差。keys・leads をまとめる時は、日ごとに平均した系列で。"""
    out = {}
    for m in range(1, 13):
        w = window(m)
        for key in keys:
            for lead in leads:
                xs = [x for (k, l, t), x in D.items() if l == lead and k == key and t <= until and t.month in w]
                out[(key, lead, m)] = stats(xs)
    return out


def stats(xs):
    a = [abs(x) for x in xs]
    u = [max(x, 0) for x in xs]
    n = [max(-x, 0) for x in xs]
    return {"abs": (st.mean(a), st.stdev(a)), "up": (st.mean(u), st.stdev(u)), "dn": (st.mean(n), st.stdev(n)),
            "d": (st.mean(xs), st.stdev(xs)), "n": len(xs)}


def daily_z(D, base, keys, leads, t):
    """対象日 t の、標準化した値（まとめる時は keys×leads の平均）。無ければ None。"""
    zs = defaultdict(list)
    raw = defaultdict(list)
    for k in keys:
        for lead in leads:
            x = D.get((k, lead, t))
            if x is None:
                continue
            b = base[(k, lead, t.month)]
            for name, v in (("abs", abs(x)), ("up", max(x, 0)), ("dn", max(-x, 0)), ("d", x)):
                mu, sd = b[name]
                zs[name].append((v - mu) / sd)
                raw[name].append(v)
    if not zs:
        return None
    return {k: st.mean(v) for k, v in zs.items()}, {k: st.mean(v) for k, v in raw.items()}


def series(D, keys, leads, base, a, b):
    return {t: z for t in days(a, b) if (z := daily_z(D, base, keys, leads, t))}


def ewma(ser, h, a, b):
    """日 t の値 = 対象日が t−1 までの z の EWMA（欠けた日は飛ばす）。"""
    lam = 1 - 0.5 ** (1 / h)
    e = {k: 0.0 for k in ("abs", "up", "dn", "d")}
    out = {}
    for t in days(a, b):
        out[t] = dict(e)
        if t in ser:
            z = ser[t][0]
            for k in e:
                e[k] = lam * z[k] + (1 - lam) * e[k]
    return out, math.sqrt(lam / (2 - lam))


def ahead(ser, t, n=3):
    """t から n 日の、実際の z の平均（|d| と d）。"""
    xs = [ser[t + timedelta(days=i)][0] for i in range(n) if (t + timedelta(days=i)) in ser]
    if len(xs) < n:
        return None
    return st.mean(x["abs"] for x in xs), st.mean(x["d"] for x in xs)


def lag1(xs):
    m = st.mean(xs)
    num = sum((xs[i] - m) * (xs[i - 1] - m) for i in range(1, len(xs)))
    return num / sum((x - m) ** 2 for x in xs)


def episodes(ser, thr=0.75, win=7):
    """ずれやすい時期（答え）：対象日を中心に7日の |d| の z の平均が thr 以上の日が続く所。"""
    flag = {}
    for t in ser:
        xs = [ser[t + timedelta(days=i)][0]["abs"] for i in range(-(win // 2), win // 2 + 1) if (t + timedelta(days=i)) in ser]
        flag[t] = len(xs) >= win - 1 and st.mean(xs) >= thr
    eps, cur = [], None
    for t in sorted(flag):
        if flag[t]:
            if cur and (t - cur[1]).days <= 2:
                cur[1] = t
            else:
                if cur:
                    eps.append(tuple(cur))
                cur = [t, t]
    if cur:
        eps.append(tuple(cur))
    return eps


def evaluate(D, keys, leads, h, L, label, verbose=False, Llow=None):
    """作る期間でふだんを作り、確かめる期間で警告を出して当たり具合を見る。"""
    base = baseline(D, keys, leads, TRAIN_END)
    ser_all = series(D, keys, leads, base, START, END)
    a, b = TRAIN_END + timedelta(days=1), END
    ew, sig = ewma(ser_all, h, START, END)
    lim = L * sig
    test_days = [t for t in days(a, b) if ahead(ser_all, t)]
    res = Counter()
    nxt = defaultdict(list)
    for t in test_days:
        e = ew[t]
        lvl = "ずれやすい" if e["abs"] > lim else ("安定" if e["abs"] < -(Llow or L) * sig else "ふつう")
        dirn = "上" if e["d"] > lim else ("下" if e["d"] < -lim else "なし")
        res[lvl] += 1
        res["向き" + dirn] += 1
        fa, fd = ahead(ser_all, t)
        nxt[lvl].append(fa)
        nxt["向き" + dirn].append(fd)
    n = len(test_days)
    # 作る期間での警告の多さ（ふだんどおりのはずの期間で、どれだけ線を越えるか）
    tr = [ew[t] for t in days(START + timedelta(days=60), TRAIN_END)]
    fa_rate = sum(1 for e in tr if abs(e["abs"]) > lim) / len(tr)
    fd_rate = sum(1 for e in tr if abs(e["d"]) > lim) / len(tr)
    # 気づくまで：確かめる期間の「ずれやすい時期」に、警告が出るまでの日数
    eps = [ep for ep in episodes(ser_all) if ep[0] > TRAIN_END]
    delays, missed = [], 0
    for s, e_ in eps:
        hit = [t for t in days(s, e_ + timedelta(days=3)) if t in ew and ew[t]["abs"] > lim]
        if hit:
            delays.append((hit[0] - s).days)
        else:
            missed += 1
    # 警告の後3日の z の平均（ずれやすい：|d| が大きいか／向き：d の符号が合うか）
    def m(v):
        return f"{st.mean(v):+.2f}" if v else "—"
    prec_hi = sum(1 for x in nxt["ずれやすい"] if x > 0) / len(nxt["ずれやすい"]) if nxt["ずれやすい"] else float("nan")
    prec_lo = sum(1 for x in nxt["安定"] if x < 0) / len(nxt["安定"]) if nxt["安定"] else float("nan")
    prec_up = sum(1 for x in nxt["向き上"] if x > 0) / len(nxt["向き上"]) if nxt["向き上"] else float("nan")
    prec_dn = sum(1 for x in nxt["向き下"] if x < 0) / len(nxt["向き下"]) if nxt["向き下"] else float("nan")
    base_hi = sum(1 for t in test_days if ahead(ser_all, t)[0] > 0) / n
    out = {
        "label": label, "h": h, "L": L, "n": n,
        "ずれやすい日%": res["ずれやすい"] / n * 100, "安定日%": res["安定"] / n * 100,
        "上日%": res["向き上"] / n * 100, "下日%": res["向き下"] / n * 100,
        "後3日z_ずれやすい": m(nxt["ずれやすい"]), "後3日z_ふつう": m(nxt["ふつう"]), "後3日z_安定": m(nxt["安定"]),
        "当たり_ずれやすい": prec_hi, "当たり_安定": prec_lo, "当たり_上": prec_up, "当たり_下": prec_dn, "ふだんの割合": base_hi,
        "後3日d_上": m(nxt["向き上"]), "後3日d_下": m(nxt["向き下"]),
        "作る期間の越え%": fa_rate * 100, "作る期間の向き越え%": fd_rate * 100,
        "時期": len(eps), "見逃し": missed, "気づく日数": (st.median(delays) if delays else None),
    }
    return out


def fmt(r):
    def p(x):
        return "—" if x != x else f"{x * 100:.0f}%"
    gd = "—" if r["気づく日数"] is None else f"{r['気づく日数']:.0f}日"
    return (f"{r['label']} 半減期{r['h']} 線{r['L']}σ：ずれやすい{r['ずれやすい日%']:.0f}%の日（後3日 z {r['後3日z_ずれやすい']}、当たり {p(r['当たり_ずれやすい'])}／ふだん {p(r['ふだんの割合'])}）"
            f" 安定{r['安定日%']:.0f}%（後3日 z {r['後3日z_安定']}、当たり {p(r['当たり_安定'])}） ふつうの後3日 z {r['後3日z_ふつう']}"
            f"｜上{r['上日%']:.0f}%（当たり {p(r['当たり_上'])}、後3日 d {r['後3日d_上']}） 下{r['下日%']:.0f}%（当たり {p(r['当たり_下'])}、後3日 d {r['後3日d_下']}）"
            f"｜作る期間で線を越えた日 {r['作る期間の越え%']:.0f}%・向き {r['作る期間の向き越え%']:.0f}%"
            f"｜ずれやすい時期 {r['時期']} 回、見逃し {r['見逃し']}、気づくまで（中央） {gd}")


def main(folder):
    D, obs, fc = build(folder)
    print("誤差の数：", len(D))

    # ---------------------------------------------------------------- 1. ふだんの値（全期間で作った表、何日前 × 月）
    print("\n## 1. ふだんの値（全期間、何日前 × 対象日の月の前後2か月）：大きさ＝上＋下（℃）")
    for key, name in KEYS:
        base = baseline(D, (key,), range(1, 8), END)
        for lead in (1, 3, 7):
            row = []
            for m in range(1, 13):
                b = base[(key, lead, m)]
                row.append(f"{m}月 {b['abs'][0]:.2f}={b['up'][0]:.2f}+{b['dn'][0]:.2f}")
            print(f"  {name} {lead}日前：" + "  ".join(row))
        chk = max(abs(base[k]["abs"][0] - base[k]["up"][0] - base[k]["dn"][0]) for k in base)
        print(f"  （大きさ−上−下 の最大のずれ {chk:.1e}）")

    # 誤差の日ごとのつながり
    print("\n## 誤差の日ごとのつながり（1日ずらした相関、全期間、標準化した値）")
    for key, name in KEYS:
        for lead in (1, 3, 7):
            base = baseline(D, (key,), (lead,), END)
            ser = series(D, (key,), (lead,), base, START, END)
            ts = sorted(ser)
            print(f"  {name} {lead}日前：大きさ {lag1([ser[t][0]['abs'] for t in ts]):+.2f}  向き d {lag1([ser[t][0]['d'] for t in ts]):+.2f}")

    # ---------------------------------------------------------------- 2〜4. 半減期 × 線の幅
    print("\n## 2〜4. 半減期 × 線の幅（作る期間 2024-02〜2025-10 でふだんを作り、確かめる期間 2025-11〜2026-10 で確かめる）")
    print("  当たり：その日から3日の実際の |d| の z の平均が 0 より上（ずれやすい）／下（安定）、d の平均の符号が合う（上・下）割合")
    combos = [("最高 1日前", ("max",), (1,)), ("最低 1日前", ("min",), (1,)),
              ("最高 1〜7日前", ("max",), tuple(range(1, 8))), ("最低 1〜7日前", ("min",), tuple(range(1, 8))),
              ("最高・最低 1〜7日前", ("max", "min"), tuple(range(1, 8))), ("最高・最低 1〜3日前", ("max", "min"), (1, 2, 3))]
    results = []
    for label, keys, leads in combos:
        for h in HALF:
            for L in LS:
                r = evaluate(D, keys, leads, h, L, label)
                results.append(r)
                print("  " + fmt(r))

    # 作る期間で線を越えた割合を、名目（独立なら）と比べる
    print("\n  名目の越える割合（独立で正規なら、片側）：1.5σ 6.7%・2σ 2.3%・2.5σ 0.6%・3σ 0.1%")

    # 「安定」の線：下の側は |d| の分布が 0 で止まるので、同じ幅では越えない。狭い線（0.5・1.0σ）を試す
    print("\n## 3b. 「安定」の線（半減期3日、ずれやすいの線 2σ、安定の線を 0.5σ・1.0σ）")
    for label, keys, leads in combos[:4]:
        for lo in (0.5, 1.0):
            r = evaluate(D, keys, leads, 3, 2.0, label, Llow=lo)
            print(f"  {label} 安定の線 {lo}σ：安定 {r['安定日%']:.0f}% の日、後3日 z {r['後3日z_安定']}、当たり（後3日 z<0） {r['当たり_安定'] * 100 if r['当たり_安定'] == r['当たり_安定'] else float('nan'):.0f}%（ふだん z<0 は {100 - r['ふだんの割合'] * 100:.0f}%）")

    # ---------------------------------------------------------------- 5. ずれやすい時期の姿
    print("\n## 5. ずれやすい時期の姿（全期間、何日前 1〜7 をまとめた最高・最低それぞれ、答え：中心7日の |d| の z 平均 ≥ 0.75）")
    for key, name in KEYS:
        base = baseline(D, (key,), range(1, 8), END)
        ser = series(D, (key,), tuple(range(1, 8)), base, START, END)
        eps = episodes(ser)
        lens = [(e - s).days + 1 for s, e in eps]
        yrs = (END - START).days / 365.25
        dirs = Counter()
        months = Counter()
        for s, e in eps:
            dd = st.mean(ser[t][1]["d"] for t in days(s, e) if t in ser)
            dirs["上（実際が高い）" if dd > 0.3 else ("下（実際が低い）" if dd < -0.3 else "混じる")] += 1
            months[SEASON[s.month]] += 1
        print(f"  {name}：{len(eps)} 回（年 {len(eps) / yrs:.1f} 回）、長さ 中央 {st.median(lens):.0f}日・最長 {max(lens)}日、向き {dict(dirs)}、季節 {dict(months)}")
        for s, e in eps[:40]:
            dd = st.mean(ser[t][1]["d"] for t in days(s, e) if t in ser)
            print(f"    {s}〜{e}（{(e - s).days + 1}日）d の平均 {dd:+.1f}℃")

    # どんな日に外れやすいか（記録で分かる範囲：実績の前日からの変化・ふだんより冷え込んだ朝・予報で雨の日・季節）
    print("\n## 5b. どんな日に外れやすいか（何日前 1〜7 をまとめた、対象日の |d| と d の平均、℃）")
    rainy = rain_forecast(folder)
    sm = smooth_obs(obs)
    for key, name in KEYS:
        groups = defaultdict(list)
        for (k, lead, t), d in D.items():
            if k != key or t - timedelta(days=1) not in obs:
                continue
            prev = obs[t - timedelta(days=1)][key]
            jump = obs[t][key] - prev if prev is not None else 0
            anom = obs[t][key] - sm[key].get(t, obs[t][key])
            groups["全部"].append(d)
            groups["前日より 4℃以上下がった" if jump <= -4 else ("前日より 4℃以上上がった" if jump >= 4 else "前日から ±4℃未満")].append(d)
            groups["ふだん（前後15日の平均）より 3℃以上低い" if anom <= -3 else ("3℃以上高い" if anom >= 3 else "ふだん ±3℃未満")].append(d)
            groups["予報で雨（その日の発表の天気に「雨」）" if rainy.get(t) else "予報で雨なし"].append(d)
            groups[f"季節 {SEASON[t.month]}"].append(d)
        print(f"  {name}")
        for g, xs in groups.items():
            print(f"    {g}: n={len(xs)} 大きさ {st.mean(abs(x) for x in xs):.2f} 向き {st.mean(xs):+.2f}（上 {st.mean(max(x, 0) for x in xs):.2f}・下 {st.mean(max(-x, 0) for x in xs):.2f}）")


def smooth_obs(obs):
    out = {"max": {}, "min": {}}
    for key in out:
        for t in obs:
            xs = [obs[t + timedelta(days=i)][key] for i in range(-15, 16) if (t + timedelta(days=i)) in obs and obs[t + timedelta(days=i)][key] is not None]
            out[key][t] = st.mean(xs)
    return out


def rain_forecast(folder):
    """対象日に、府県天気予報（区域 中部 390010）のいちばん遅い発表の天気に「雨」があるか（予報の天気。実際の雨ではない）。"""
    import csv, io
    from fs03 import find_csv
    last = {}
    for fn in sorted(os.listdir(folder)):
        ym = fn[9:15]
        raw = find_csv(open(os.path.join(folder, fn), "rb").read(), f"forecast_{ym}_390000.csv")
        if raw is None:
            continue
        for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
            if r["areaCode"] != "390010":
                continue
            w = r.get("weathers") or r.get("weather") or ""
            if not w:
                continue
            t = date.fromisoformat(r["timeDefine"][:10])
            rep = r["reportDatetime"]
            if rep[:10] < str(t) or rep[:10] == str(t):
                if t not in last or rep >= last[t][0]:
                    last[t] = (rep, w)
    return {t: ("雨" in w) for t, (rep, w) in last.items()}


if __name__ == "__main__":
    main(sys.argv[1])
