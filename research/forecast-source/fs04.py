"""FS-04：予報の当たり具合のふりかえりの指標（EWMA 管理図）。高知、気象庁の府県・週間天気予報、1〜7日前、最高・最低。

材料は FS-03 と同じ（shiromatz の記録・fs03_obs_47893.csv）。外部は読まない。
使い方：python3 -I fs04.py <forecast の ZIP があるフォルダ>   （図 fs04_ewma.png も作る）

誤差 e = 予報 − 実績（℃）。
  上に外れた分 up = max(−e, 0)（実績＞予報）、下に外れた分 dn = max(e, 0)（実績＜予報）、大きさ |e| = up + dn。かたより = e の平均。
ふだん：何日前 × 対象日の月の前後2か月（5か月の窓）で、作る期間の平均と標準偏差。
直近：その日の時点で答えの分かっている誤差（対象日が昨日まで）を標準化 z = (値 − ふだん平均) / ふだん標準偏差 し、
      日ごとに EWMA（半減期 h 日）。比べ役に直近28日の単純平均。
線：±L·σ（EWMA は √(λ/(2−λ))、28日平均は 1/√28。誤差が日ごとに独立と仮定）。
単純な予測：持続（n 日前の予報の代わりに、対象日の n 日前の実績）と平年（実績の、同じ時期の他の年の前後15日の平均。気象庁の平年値ではない）。
"""
import csv, io, math, os, random, statistics as st, sys
from collections import Counter, defaultdict
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs03 import find_csv, load_forecasts, load_obs  # noqa: E402

START, END = date(2024, 2, 1), date(2026, 10, 31)
TRAIN_END = date(2025, 10, 31)
HALF = (3, 5, 7, 14)
LS = (1.5, 2.0, 2.5, 3.0)
SEASON = {12: "冬", 1: "冬", 2: "冬", 3: "春", 4: "春", 5: "春", 6: "夏", 7: "夏", 8: "夏", 9: "秋", 10: "秋", 11: "秋"}
KEYS = (("max", "最高"), ("min", "最低"))
ALL = tuple(range(1, 8))
NAMES = ("abs", "up", "dn", "e")


def window(m):
    return {((m - 1 + k) % 12) + 1 for k in (-2, -1, 0, 1, 2)}


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def comp(x):
    return {"abs": abs(x), "up": max(-x, 0.0), "dn": max(x, 0.0), "e": x}


def build(folder):
    fc, obs = load_forecasts(folder), load_obs()
    clim = climatology(obs)
    E = {"気象庁": {}, "持続": {}, "平年": {}}
    F = {}
    for (t, lead), v in fc.items():
        if not (START <= t <= END) or t not in obs:
            continue
        for key, _ in KEYS:
            o = obs[t][key]
            if key in v and o is not None:
                E["気象庁"][(key, lead, t)] = v[key] - o
                F[(key, lead, t)] = v[key]
                p = obs.get(t - timedelta(days=lead), {}).get(key)
                if p is not None:
                    E["持続"][(key, lead, t)] = p - o
                if (key, t) in clim:
                    E["平年"][(key, lead, t)] = clim[(key, t)] - o
    return E, F, obs


def climatology(obs):
    out = {}
    for t in obs:
        for key in ("max", "min"):
            xs = []
            for y in (2024, 2025, 2026):
                if y == t.year:
                    continue
                try:
                    c = t.replace(year=y)
                except ValueError:
                    c = t.replace(year=y, day=28)
                for k in range(-15, 16):
                    v = obs.get(c + timedelta(days=k), {}).get(key)
                    if v is not None:
                        xs.append(v)
            if xs:
                out[(key, t)] = st.mean(xs)
    return out


def baseline(D, until):
    by = defaultdict(list)
    for (k, l, t), x in D.items():
        if t <= until:
            for m in range(1, 13):
                if t.month in window(m):
                    by[(k, l, m)].append(comp(x))
    return {g: {n: (st.mean(c[n] for c in cs), st.stdev(c[n] for c in cs)) for n in NAMES} for g, cs in by.items()}


def series(D, keys, leads, base):
    acc = defaultdict(lambda: (defaultdict(list), defaultdict(list)))
    for (k, lead, t), x in D.items():
        if k not in keys or lead not in leads:
            continue
        b = base[(k, lead, t.month)]
        z, r = acc[t]
        for n, v in comp(x).items():
            mu, sd = b[n]
            z[n].append((v - mu) / sd)
            r[n].append(v)
    return {t: ({n: st.mean(v) for n, v in z.items()}, {n: st.mean(v) for n, v in r.items()}) for t, (z, r) in acc.items()}


def smoother(ser, h, a, b):
    out = {}
    if h == "28日":
        for t in days(a, b):
            xs = [ser[t - timedelta(days=k)][0] for k in range(1, 29) if (t - timedelta(days=k)) in ser]
            out[t] = {n: st.mean(x[n] for x in xs) for n in NAMES} if len(xs) >= 20 else {n: 0.0 for n in NAMES}
        return out, 1 / math.sqrt(28)
    lam = 1 - 0.5 ** (1 / h)
    e = {n: 0.0 for n in NAMES}
    for t in days(a, b):
        out[t] = dict(e)
        if t in ser:
            for n in NAMES:
                e[n] = lam * ser[t][0][n] + (1 - lam) * e[n]
    return out, math.sqrt(lam / (2 - lam))


def ahead(ser, t, n=3):
    xs = [ser[t + timedelta(days=i)][0] for i in range(n) if (t + timedelta(days=i)) in ser]
    if len(xs) < n:
        return None
    return {k: st.mean(x[k] for x in xs) for k in NAMES}


def lag1(xs):
    m = st.mean(xs)
    return sum((xs[i] - m) * (xs[i - 1] - m) for i in range(1, len(xs))) / sum((x - m) ** 2 for x in xs)


def episodes(ser, thr=0.75, win=7):
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


def mbb(xs, block=7, B=2000, seed=1):
    """移動ブロック・ブートストラップ（ブロック7日）で、平均の 95% の幅。xs は日付の順。"""
    rnd = random.Random(seed)
    n = len(xs)
    k = math.ceil(n / block)
    means = []
    for _ in range(B):
        s = []
        for _ in range(k):
            i = rnd.randrange(0, n - block + 1)
            s += xs[i:i + block]
        means.append(st.mean(s[:n]))
    means.sort()
    return means[int(0.025 * B)], means[int(0.975 * B)]


TESTS = {"ずれやすい": lambda x: x["abs"] > 0, "安定": lambda x: x["abs"] < 0,
         "上に外れやすい": lambda x: x["e"] < 0, "下に外れやすい": lambda x: x["e"] > 0}


def evaluate(ser, h, L, Llow=None):
    ew, sig = smoother(ser, h, START, END)
    hi, lo = L * sig, (Llow if Llow is not None else L) * sig
    test = [t for t in days(TRAIN_END + timedelta(days=1), END) if ahead(ser, t)]
    lv = defaultdict(list)
    for t in test:
        e, nx = ew[t], ahead(ser, t)
        lv["ずれやすい" if e["abs"] > hi else ("安定" if e["abs"] < -lo else "ふつう")].append(nx)
        # e の z が上＝予報が高め＝実績が下に出る
        lv["下に外れやすい" if e["e"] > hi else ("上に外れやすい" if e["e"] < -hi else "向きなし")].append(nx)
    n = len(test)
    allnx = [ahead(ser, t) for t in test]
    rate = lambda lst, f: sum(1 for x in lst if f(x)) / len(lst) if lst else float("nan")
    r = {k: (len(lv[k]) / n, rate(lv[k], f), rate(allnx, f)) for k, f in TESTS.items()}
    tr = [ew[t] for t in days(START + timedelta(days=60), TRAIN_END)]
    r["越え_大きさ"] = sum(1 for e in tr if e["abs"] > hi) / len(tr)
    r["越え_向き"] = sum(1 for e in tr if abs(e["e"]) > hi) / len(tr)
    eps = [ep for ep in episodes(ser) if ep[0] > TRAIN_END]
    delays, missed = [], 0
    for s, e_ in eps:
        hit = [t for t in days(s, e_ + timedelta(days=3)) if t in ew and ew[t]["abs"] > hi]
        if hit:
            delays.append((hit[0] - s).days)
        else:
            missed += 1
    r["時期"], r["見逃し"], r["気づく"] = len(eps), missed, (st.median(delays) if delays else None)
    return r


def pct(x):
    return "—" if x != x else f"{x * 100:.0f}%"


def fmtr(label, h, L, r):
    parts = [f"{k} {pct(r[k][0])} 当{pct(r[k][1])}/{pct(r[k][2])}" for k in TESTS]
    gd = "—" if r["気づく"] is None else f"{r['気づく']:.0f}日"
    hl = h if h == "28日" else f"h{h}"
    return (f"{label} {hl} {L}σ｜" + "｜".join(parts) +
            f"｜越え 大{pct(r['越え_大きさ'])}・向{pct(r['越え_向き'])}｜時期{r['時期']} 逃{r['見逃し']} 気づく{gd}")


def main(folder):
    E, F, obs = build(folder)
    J = E["気象庁"]
    bases = {src: baseline(D, TRAIN_END) for src, D in E.items()}
    full = {src: baseline(D, END) for src, D in E.items()}
    print("誤差の数：", {k: len(v) for k, v in E.items()})

    print("\n## 1. ふだんの値（全期間、何日前 × 月の前後2か月）：MAE＝上＋下（かたより）℃")
    for key, name in KEYS:
        for lead in (1, 3, 7):
            row = []
            for m in range(1, 13):
                b = full["気象庁"][(key, lead, m)]
                row.append(f"{m}月 {b['abs'][0]:.2f}={b['up'][0]:.2f}+{b['dn'][0]:.2f}({b['e'][0]:+.2f})")
            print(f"  {name} {lead}日前：" + " ".join(row))
    chk = max(abs(v["abs"][0] - v["up"][0] - v["dn"][0]) for v in full["気象庁"].values())
    print(f"  （MAE−上−下 の最大のずれ {chk:.1e}）")

    print("\n## 3. 単純な予測との比べ（全期間、MAE ℃）")
    for key, name in KEYS:
        for lead in ALL:
            row = [f"{src} {st.mean(abs(x) for (k, l, t), x in E[src].items() if k == key and l == lead):.2f}" for src in ("気象庁", "持続", "平年")]
            print(f"  {name} {lead}日前：" + " ".join(row))

    print("\n## 5. 外れ方が続くか（1日ずらした相関、全期間の z）")
    for key, name in KEYS:
        line = []
        for lead in ALL:
            s = series(J, (key,), (lead,), full["気象庁"])
            ts = sorted(s)
            line.append(f"{lead}日 大{lag1([s[t][0]['abs'] for t in ts]):+.2f}/向{lag1([s[t][0]['e'] for t in ts]):+.2f}")
        s = series(J, (key,), ALL, full["気象庁"])
        ts = sorted(s)
        line.append(f"まとめ 大{lag1([s[t][0]['abs'] for t in ts]):+.2f}/向{lag1([s[t][0]['e'] for t in ts]):+.2f}")
        print(f"  {name}：" + " ".join(line))
        runs, cur, last = [], 0, None
        for t in ts:
            sg = 1 if s[t][1]["e"] > 0 else -1
            if sg == last:
                cur += 1
            else:
                if last is not None:
                    runs.append(cur)
                cur, last = 1, sg
        print(f"    同じ向き（1〜7日前まとめの e の符号）の続く日数：平均 {st.mean(runs):.2f}日（でたらめなら約 2）、5日以上 {sum(x >= 5 for x in runs)} 回／{len(runs)}、最長 {max(runs)}日")

    print("\n## 2・4・6. 半減期 × 線（作る期間 2024-02〜2025-10 でふだん、確かめる期間 2025-11〜2026-10。当＝その日から3日の実際の z の当たり/何もしない時）")
    combos = [("最高 1日前", ("max",), (1,)), ("最低 1日前", ("min",), (1,)),
              ("最高 1〜7日前", ("max",), ALL), ("最低 1〜7日前", ("min",), ALL), ("最高・最低 1〜7日前", ("max", "min"), ALL)]
    for label, keys, leads in combos:
        ser = series(J, keys, leads, bases["気象庁"])
        for h in HALF + ("28日",):
            for L in LS:
                print("  " + fmtr(label, h, L, evaluate(ser, h, L)))
    print("  名目（独立で正規なら片側）：1.5σ 6.7%・2σ 2.3%・2.5σ 0.6%・3σ 0.1%")
    print("\n  「安定」の下の線だけ狭くする（半減期3日・上の線 2σ）")
    for label, keys, leads in combos:
        ser = series(J, keys, leads, bases["気象庁"])
        for lo in (0.5, 1.0):
            share, hit, base = evaluate(ser, 3, 2.0, Llow=lo)["安定"]
            print(f"    {label} 下 {lo}σ：安定 {pct(share)}の日 当たり {pct(hit)}／何もしない時 {pct(base)}")

    print("\n## 3b. 見分けの線（半減期3日、1〜7日前まとめ。後3日の z：気象庁／単純な予測）")
    for key, name in KEYS:
        sj = series(J, (key,), ALL, bases["気象庁"])
        ej, sig = smoother(sj, 3, START, END)
        for ref in ("平年", "持続"):
            sn = series(E[ref], (key,), ALL, bases[ref])
            en, _ = smoother(sn, 3, START, END)
            for Lj, Ln in ((2.0, 0.0), (2.0, 1.0), (2.0, 1.5), (2.0, 2.0)):
                grp = defaultdict(list)
                for t in days(TRAIN_END + timedelta(days=1), END):
                    a1, a2 = ahead(sj, t), ahead(sn, t)
                    if not a1 or not a2:
                        continue
                    jbad, nbad = ej[t]["abs"] > Lj * sig, en[t]["abs"] > Ln * sig
                    g = "読みにくい" if jbad and nbad else ("予報の側" if jbad else ("単純だけ悪い" if nbad else "ふつう"))
                    grp[g].append((a1["abs"], a2["abs"]))
                desc = " ".join(f"{g} {len(v)}日（{st.mean(x for x, _ in v):+.2f}／{st.mean(y for _, y in v):+.2f}）" for g, v in sorted(grp.items()))
                print(f"  {name} 単純={ref} 線 気象庁{Lj}σ・単純{Ln}σ：{desc}")

    print("\n## 6b. かたよりの候補（作る期間で 95% の幅が 0 を含まない季節）を確かめる期間で確かめる（1〜7日前まとめの日ごとの e、ブロック7日のブートストラップ）")
    for key, name in KEYS:
        s = series(J, (key,), ALL, bases["気象庁"])
        for sea in ("冬", "春", "夏", "秋"):
            tr = [s[t][1]["e"] for t in sorted(s) if t <= TRAIN_END and SEASON[t.month] == sea]
            te = [s[t][1]["e"] for t in sorted(s) if t > TRAIN_END and SEASON[t.month] == sea]
            lo1, hi1 = mbb(tr)
            lo2, hi2 = mbb(te)
            cand = "候補" if lo1 > 0 or hi1 < 0 else "—"
            print(f"  {name} {sea}：作る {st.mean(tr):+.2f}（{lo1:+.2f}〜{hi1:+.2f}）{cand}／確かめる {st.mean(te):+.2f}（{lo2:+.2f}〜{hi2:+.2f}）")
    print("  全期間（何日前ごと、かたよりと MAE の 95% の幅）")
    for key, name in KEYS:
        for lead in (1, 4, 7):
            xs = [J[g] for g in sorted((g for g in J if g[0] == key and g[1] == lead), key=lambda g: g[2])]
            a1, b1 = mbb(xs)
            a2, b2 = mbb([abs(x) for x in xs])
            print(f"    {name} {lead}日前：かたより {st.mean(xs):+.2f}（{a1:+.2f}〜{b1:+.2f}） MAE {st.mean(abs(x) for x in xs):.2f}（{a2:.2f}〜{b2:.2f}）")

    print("\n## ずれやすい時期（全期間のふだん、1〜7日前まとめ、中心7日の |e| の z 平均 ≥ 0.75）")
    yrs = (END - START).days / 365.25
    for key, name in KEYS:
        s = series(J, (key,), ALL, full["気象庁"])
        eps = episodes(s)
        lens = [(b - a).days + 1 for a, b in eps]
        dirs, sea = Counter(), Counter()
        for a, b in eps:
            m = st.mean(s[t][1]["e"] for t in days(a, b) if t in s)
            dirs["下（実績が予報より低い）" if m > 0.3 else ("上（実績が予報より高い）" if m < -0.3 else "混じる")] += 1
            sea[SEASON[a.month]] += 1
        print(f"  {name}：{len(eps)} 回（年 {len(eps) / yrs:.1f}）、長さ 中央 {st.median(lens):.0f}日・最長 {max(lens)}日、向き {dict(dirs)}、季節 {dict(sea)}")

    print("\n## 7. 条件別（1〜7日前まとめ、かたより e と MAE ℃。天気・風は府県天気予報 中部の予報の文）")
    wx = forecast_weather(folder)
    sm = smooth_obs(obs)
    for key, name in KEYS:
        g = defaultdict(list)
        for (k, lead, t), x in J.items():
            if k != key:
                continue
            w = wx.get(t, "")
            g["全部"].append(x)
            if "雨" in w:
                g["予報で雨"].append(x)
            elif "晴" in w and "雪" not in w:
                g["予報で晴れ（雨・雪なし）"].append(x)
                if obs[t]["min"] is not None and obs[t]["min"] - sm["min"].get(t, obs[t]["min"]) <= -2:
                    g["予報で晴れ、朝が冷え込んだ（実績の最低が前後15日の平均より2℃以上低い）"].append(x)
            if "雷" in w or "強く" in wx.get(("wind", t), ""):
                g["荒れた予報（天気に雷、または風に「強く」）"].append(x)
            g["季節の変わり目（3・4・10・11月）" if t.month in (3, 4, 10, 11) else "それ以外の月"].append(x)
            prev = obs.get(t - timedelta(days=1), {}).get(key)
            if prev is not None:
                j = obs[t][key] - prev
                if j <= -4:
                    g["実績が前日より4℃以上下がった（後から分かる）"].append(x)
                elif j >= 4:
                    g["実績が前日より4℃以上上がった（後から分かる）"].append(x)
            g[f"季節 {SEASON[t.month]}"].append(x)
        print(f"  {name}")
        for k_, xs in g.items():
            print(f"    {k_}: n={len(xs)} かたより {st.mean(xs):+.2f} MAE {st.mean(abs(x) for x in xs):.2f}")
    print("  台風：shiromatz の記録（天気・風・波の文）に「台風」の文字が無く、記録からは分けられない。")

    print("\n## 8. 予報の更新幅（同じ対象日、Δ＝1日前の予報−7日前の予報）")
    for key, name in KEYS:
        bins = defaultdict(list)
        for (k, l, t), f1 in F.items():
            if k != key or l != 1 or (key, 7, t) not in F:
                continue
            dl = f1 - F[(key, 7, t)]
            b = "0〜1℃" if abs(dl) <= 1 else ("2〜3℃" if abs(dl) <= 3 else "4℃以上")
            bins[b].append((J[(key, 1, t)], J[(key, 7, t)], dl))
        for b in ("0〜1℃", "2〜3℃", "4℃以上"):
            v = bins[b]
            short = sum(1 for e1, _, dl in v if dl != 0 and (e1 > 0) == (dl > 0) and e1 != 0) / len(v)
            print(f"  {name} 動き {b}: {len(v)}日（{len(v) / sum(len(x) for x in bins.values()) * 100:.0f}%） 1日前の MAE {st.mean(abs(a) for a, _, _ in v):.2f}・かたより {st.mean(a for a, _, _ in v):+.2f}"
                  f" 7日前の MAE {st.mean(abs(c) for _, c, _ in v):.2f}／1日前の誤差が動いた向きと同じ側（動き足りない）{short * 100:.0f}%")

    try:
        figure(J, bases["気象庁"])
    except Exception as ex:
        print("[図] 描けなかった", ex)


def forecast_weather(folder):
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
            wd = r.get("winds") or r.get("wind") or ""
            if not w:
                continue
            t = date.fromisoformat(r["timeDefine"][:10])
            rep = r["reportDatetime"]
            if rep[:10] < str(t) and (t not in last or rep >= last[t][0]):
                last[t] = (rep, w, wd)
    out = {}
    for t, (rep, w, wd) in last.items():
        out[t] = w
        out[("wind", t)] = wd
    return out


def smooth_obs(obs):
    out = {"max": {}, "min": {}}
    for key in out:
        for t in obs:
            xs = [obs[t + timedelta(days=i)][key] for i in range(-15, 16) if (t + timedelta(days=i)) in obs and obs[t + timedelta(days=i)][key] is not None]
            out[key][t] = st.mean(xs)
    return out


def figure(J, base):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    names = {x.name for x in font_manager.fontManager.ttflist}
    for f in ("Noto Sans CJK JP", "Noto Sans CJK TC"):
        if f in names:
            plt.rcParams["font.family"] = f
            break
    fig, axes = plt.subplots(4, 1, figsize=(14, 13), sharex=True)
    for row, (key, name) in enumerate(KEYS):
        s = series(J, (key,), ALL, base)
        ts = sorted(s)
        ew, sig = smoother(s, 3, START, END)
        m28, _ = smoother(s, "28日", START, END)
        dd = sorted(ew)
        for col, (stat, title) in enumerate((("abs", "大きさ（|e| の z）"), ("e", "向き（e の z。＋は実績が予報より低い）"))):
            ax = axes[row * 2 + col]
            ax.bar(ts, [s[t][0][stat] for t in ts], width=1.0, color="#cccccc", label="日ごとの z（1〜7日前の平均）")
            ax.plot(dd, [ew[t][stat] for t in dd], color="#c0392b", lw=1.4, label="EWMA（半減期3日）")
            ax.plot(dd, [m28[t][stat] for t in dd], color="#2c3e50", lw=1.0, label="直近28日の平均")
            ax.axhline(2 * sig, color="#c0392b", ls="--", lw=0.8)
            ax.axhline(-2 * sig, color="#c0392b", ls="--", lw=0.8)
            ax.axhline(0, color="black", lw=0.5)
            ax.axvline(TRAIN_END, color="#888888", lw=0.8)
            ax.set_ylim(-2.5, 3.5)
            ax.set_title(f"{name}　{title}　点線＝±2σ（EWMA）、縦線＝作る期間の終わり", fontsize=10)
            if row == 0 and col == 0:
                ax.legend(loc="upper left", fontsize=8)
    fig.suptitle("FS-04　高知の気象庁の予報（1〜7日前）の誤差の z と直近の平均（2024-02〜2026-10）", fontsize=12)
    fig.tight_layout()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fs04_ewma.png")
    fig.savefig(out, dpi=100)
    print("[図]", out)


if __name__ == "__main__":
    main(sys.argv[1])
