"""FS-04 の 10・14・15・16（雨）と、向きの警告の線の比べ（メインの判断 11/23 の3）。

材料：shiromatz の記録（予報）、fs04_rain_47893.csv（高知の日降水量、気象庁 過去の気象データ）、fs03_obs_47893.csv。
予報の「降水あり」：日の降水確率が 50% 以上。日の降水確率は fs04_season.load_wx_pop と同じ
  （1日前＝府県天気予報 中部の6時間降水確率のいちばん高い区切り、2〜7日前＝週間 高知県の日の降水確率）。
実際の「降った」：日降水量 1.0mm 以上（比べに 0.5mm 以上も）。
指標（気象庁の週間予報の検証と同じ名前）：
  適中率＝（降水あり予報で降った＋降水なし予報で降らなかった）／日数、見逃し率＝降水なし予報で降った／日数、
  空振り率＝降水あり予報で降らなかった／日数、捕捉率＝降った日のうち降水あり予報だった割合、
  ブライアスコア BS＝（確率−実際 0/1）² の平均、BSS＝1 − BS／BS(気候値)。気候値は、その月（前後2か月）の作る期間の「降った」割合。
使い方：python3 -I fs04_rain.py <forecast の ZIP があるフォルダ>
"""
import math, os, statistics as st, sys
from collections import defaultdict
from datetime import date, timedelta

from scipy.stats import norm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs03 import load_forecasts  # noqa: E402
from fs04 import ALL, END, START, TRAIN_END, days  # noqa: E402
from fs04_season import GROUPS, load_wx_pop, mbb_diff, mbb_mean  # noqa: E402
from fs04_ss import fit, kalman  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def load_rain():
    out = {}
    with open(os.path.join(HERE, "fs04_rain_47893.csv"), encoding="utf-8") as f:
        next(f)
        for line in f:
            d, v = line.strip().split(",")
            try:
                out[date.fromisoformat(d)] = float(v)
            except ValueError:
                pass
    return out


def window(m):
    return {((m - 1 + k) % 12) + 1 for k in (-2, -1, 0, 1, 2)}


def scores(pairs):
    """pairs：[(確率%, 降った 0/1)]。"""
    n = len(pairs)
    yes = [(p >= 50, o) for p, o in pairs]
    hit = sum(1 for f, o in yes if f == bool(o)) / n
    miss = sum(1 for f, o in yes if not f and o) / n
    fa = sum(1 for f, o in yes if f and not o) / n
    rain = sum(o for _, o in pairs)
    pod = sum(1 for f, o in yes if f and o) / rain if rain else float("nan")
    bs = st.mean((p / 100 - o) ** 2 for p, o in pairs)
    return {"n": n, "降った割合": rain / n, "適中率": hit, "見逃し率": miss, "空振り率": fa, "捕捉率": pod, "BS": bs}


def main(folder):
    wp = load_wx_pop(folder)
    rain = load_rain()
    print("降水量の日数", len(rain), "1mm以上", sum(1 for v in rain.values() if v >= 1), "0.5mm以上", sum(1 for v in rain.values() if v >= 0.5))

    def pairs(lead, thr=1.0, cond=lambda t: True):
        return [(wp[(t, lead)]["pop"], 1 if rain[t] >= thr else 0) for t in days(START, END)
                if (t, lead) in wp and "pop" in wp[(t, lead)] and t in rain and cond(t)]

    # 気候値（作る期間、月の前後2か月）
    clim = {}
    for m in range(1, 13):
        xs = [1 if rain[t] >= 1 else 0 for t in rain if t <= TRAIN_END and t.month in window(m)]
        clim[m] = st.mean(xs)

    # ---------------------------------------------------------------- 10. 何日前ごと
    print("\n## 10. 何日前ごと（全期間）：降った＝1.0mm 以上（かっこは 0.5mm 以上）")
    for lead in ALL:
        a, b = scores(pairs(lead)), scores(pairs(lead, 0.5))
        bsc = st.mean((clim[t.month] - (1 if rain[t] >= 1 else 0)) ** 2 for t in days(START, END) if (t, lead) in wp and "pop" in wp[(t, lead)] and t in rain)
        print(f"  {lead}日前 n={a['n']}：適中率 {a['適中率'] * 100:.0f}%（{b['適中率'] * 100:.0f}%） 見逃し {a['見逃し率'] * 100:.0f}%（{b['見逃し率'] * 100:.0f}%） 空振り {a['空振り率'] * 100:.0f}%（{b['空振り率'] * 100:.0f}%）"
              f" 捕捉率 {a['捕捉率'] * 100:.0f}% BS {a['BS']:.3f}（{b['BS']:.3f}） BSS {1 - a['BS'] / bsc:+.2f}（気候値の BS {bsc:.3f}）")

    print("\n## 10b. 較正（全期間、1〜7日前まとめ。件数の少ない帯は広げる）：確率の帯ごとの実際に降った割合（1.0mm）")
    bands = [(0, 0), (10, 10), (20, 20), (30, 30), (40, 40), (50, 50), (60, 70), (80, 100)]
    for lead_set, label in ((ALL, "1〜7日前"), ((1,), "1日前"), ((2, 3), "2〜3日前"), ((4, 5, 6, 7), "4〜7日前")):
        row = []
        for lo, hi in bands:
            xs = [o for l in lead_set for p, o in pairs(l) if lo <= p <= hi]
            if xs:
                row.append(f"{lo}〜{hi}%：{st.mean(xs) * 100:.0f}%（{len(xs)}）")
        print(f"  {label}：" + " ".join(row))

    # ---------------------------------------------------------------- 14. 月ごと（雨）
    print("\n## 14（雨）. 月ごと（1日前／1〜7日前まとめ、1.0mm）。かっこはブロック・ブートストラップの 95% の幅")
    daily = defaultdict(dict)  # 対象日 -> 指標
    for t in days(START, END):
        if t not in rain:
            continue
        o = 1 if rain[t] >= 1 else 0
        ps = [wp.get((t, l), {}).get("pop") for l in ALL]
        if ps[0] is not None:
            daily[t]["1日前 BS"] = (ps[0] / 100 - o) ** 2
            daily[t]["1日前 当たり"] = 1.0 if (ps[0] >= 50) == bool(o) else 0.0
            daily[t]["1日前 見逃し"] = 1.0 if ps[0] < 50 and o else 0.0
            daily[t]["1日前 空振り"] = 1.0 if ps[0] >= 50 and not o else 0.0
        if all(p is not None for p in ps):
            daily[t]["1〜7日前 BS"] = st.mean((p / 100 - o) ** 2 for p in ps)
            daily[t]["1〜7日前 当たり"] = st.mean(1.0 if (p >= 50) == bool(o) else 0.0 for p in ps)
            daily[t]["1〜7日前 見逃し"] = st.mean(1.0 if p < 50 and o else 0.0 for p in ps)
            daily[t]["1〜7日前 空振り"] = st.mean(1.0 if p >= 50 and not o else 0.0 for p in ps)
            daily[t]["1〜7日前 気候値の BS"] = (clim[t.month] - o) ** 2
        daily[t]["降った"] = float(o)
    names = ["降った", "1日前 当たり", "1日前 見逃し", "1日前 空振り", "1日前 BS", "1〜7日前 当たり", "1〜7日前 見逃し", "1〜7日前 空振り", "1〜7日前 BS", "1〜7日前 気候値の BS"]
    for n in names:
        row = []
        for m in range(1, 13):
            xs = [daily[t][n] for t in sorted(daily) if t.month == m and n in daily[t]]
            lo, hi = mbb_mean(xs)
            row.append(f"{m}月 {st.mean(xs):.3f}（{lo:.3f}〜{hi:.3f}）")
        print(f"  {n}｜全体 {st.mean(daily[t][n] for t in daily if n in daily[t]):.3f}｜" + " ".join(row))
    print("  BSS（月ごと、1〜7日前）：" + " ".join(
        f"{m}月 {1 - st.mean(daily[t]['1〜7日前 BS'] for t in daily if t.month == m and '1〜7日前 BS' in daily[t]) / st.mean(daily[t]['1〜7日前 気候値の BS'] for t in daily if t.month == m and '1〜7日前 BS' in daily[t]):+.2f}"
        for m in range(1, 13)))

    # ---------------------------------------------------------------- 15（雨）
    print("\n## 15（雨）. その時期の平均 − それ以外（95% の幅、ブロック7日）")
    for n in names[1:]:
        ser = [(t, daily[t][n]) for t in sorted(daily) if n in daily[t]]
        line = []
        for g, months in GROUPS.items():
            a = st.mean(x for t, x in ser if t.month in months)
            b = st.mean(x for t, x in ser if t.month not in months)
            lo, hi = mbb_diff(ser, lambda d, ms=months: d.month in ms)
            mark = "＋" if lo > 0 else ("−" if hi < 0 else "・")
            line.append(f"{g} {a:.3f}対{b:.3f} 差 {a - b:+.3f}（{lo:+.3f}〜{hi:+.3f}）{mark}")
        print(f"  {n}｜" + "｜".join(line))
    # BSS の差（気候値に対する上手さ）：日ごとの (BS − BS気候値) で比べる
    ser = [(t, daily[t]["1〜7日前 BS"] - daily[t]["1〜7日前 気候値の BS"]) for t in sorted(daily) if "1〜7日前 BS" in daily[t]]
    line = []
    for g, months in GROUPS.items():
        a = st.mean(x for t, x in ser if t.month in months)
        b = st.mean(x for t, x in ser if t.month not in months)
        lo, hi = mbb_diff(ser, lambda d, ms=months: d.month in ms)
        line.append(f"{g} {a:+.3f}対{b:+.3f} 差 {a - b:+.3f}（{lo:+.3f}〜{hi:+.3f}）{'＋' if lo > 0 else ('−' if hi < 0 else '・')}")
    print("  BS−気候値の BS（小さいほど気候値より上手）｜" + "｜".join(line))

    # 区域の違い：2日前の天気（府県 中部と週間 高知県）がどれだけ一致するか、どちらが雨の日をよく当てるか
    print("\n## 区域の違い（2日前の予報で、府県天気予報 中部 と 週間 高知県 の天気の分類）")
    both = [(wp[(t, 2)]["wx_中部"], wp[(t, 2)]["wx_高知県"], t) for t in days(START, END) if (t, 2) in wp and "wx_中部" in wp[(t, 2)] and "wx_高知県" in wp[(t, 2)]]
    agree = sum(1 for a, b, _ in both if a == b) / len(both)
    def wet(c):
        return c in ("雨", "雪")
    ra = [(wet(a), rain[t] >= 1) for a, b, t in both if t in rain]
    rb = [(wet(b), rain[t] >= 1) for a, b, t in both if t in rain]
    acc = lambda v: sum(1 for f, o in v if f == o) / len(v)
    print(f"  {len(both)} 日、分類の一致 {agree * 100:.0f}%。天気が雨・雪を「降水あり」とした適中率：中部 {acc(ra) * 100:.0f}%・高知県 {acc(rb) * 100:.0f}%")

    # ---------------------------------------------------------------- 16（雨）
    print("\n## 16（雨）. 「この時期にしては外れやすい」：日ごとの BS（1〜7日前）を月の前後2か月のふだん（作る期間）で z にし、EWMA（半減期3日）")
    n = "1〜7日前 BS"
    base = {}
    for m in range(1, 13):
        xs = [daily[t][n] for t in daily if n in daily[t] and t <= TRAIN_END and t.month in window(m)]
        base[m] = (st.mean(xs), st.stdev(xs))
    z = {t: (daily[t][n] - base[t.month][0]) / base[t.month][1] for t in daily if n in daily[t]}
    lam = 1 - 0.5 ** (1 / 3)
    sig = math.sqrt(lam / (2 - lam))
    e, ew = 0.0, {}
    for t in days(START, END):
        ew[t] = e
        if t in z:
            e = lam * z[t] + (1 - lam) * e
    ts = sorted(z)
    lag = st.correlation([z[ts[i - 1]] for i in range(1, len(ts)) if (ts[i] - ts[i - 1]).days == 1], [z[ts[i]] for i in range(1, len(ts)) if (ts[i] - ts[i - 1]).days == 1])
    for L in (1.5, 2.0, 2.5):
        hit, allf = [], []
        tr = sum(1 for t in days(START + timedelta(days=60), TRAIN_END) if ew[t] > L * sig)
        ntr = (TRAIN_END - START).days - 60
        for t in days(TRAIN_END + timedelta(days=1), END - timedelta(days=2)):
            nx = [z.get(t + timedelta(days=k)) for k in range(3)]
            if any(x is None for x in nx):
                continue
            f = st.mean(nx)
            allf.append(f)
            if ew[t] > L * sig:
                hit.append(f)
        r = f"{len(hit) / len(allf) * 100:.0f}%の日 当たり {sum(1 for x in hit if x > 0) / len(hit) * 100:.0f}%" if hit else "0%の日"
        print(f"  {L}σ（1日ずらした相関 {lag:+.2f}）：{r}（何もしない時 {sum(1 for x in allf if x > 0) / len(allf) * 100:.0f}%）／作る期間で越えた日 {tr / ntr * 100:.0f}%")

    # ---------------------------------------------------------------- 判断3：向きの警告の線（最低 1〜7日前、ローカルレベル）
    print("\n## 判断3. 向きの警告（最低 1〜7日前まとめ、ローカルレベル）：線の比べ。当たり＝その日から3日の e の平均の符号が合う")
    fc = load_forecasts(folder)
    from fs03 import load_obs
    obs = load_obs()
    ts = list(days(START, END))
    ys = []
    for t in ts:
        xs = [fc[(t, l)]["min"] - obs[t]["min"] for l in ALL if (t, l) in fc and "min" in fc[(t, l)] and t in obs and obs[t]["min"] is not None]
        ys.append(st.mean(xs) if len(xs) == 7 else None)
    q, r, _ = fit([y for t, y in zip(ts, ys) if t <= TRAIN_END])
    prior, _ = kalman(ys, q, r)
    for amt, pr in ((0.5, 0.8), (0.5, 0.9), (0.7, 0.8), (0.7, 0.9)):
        res = defaultdict(list)
        trn, ntr = 0, 0
        for i, t in enumerate(ts):
            m, p = prior[i]
            pdn = 1 - norm.cdf((amt - m) / math.sqrt(p))
            pup = norm.cdf((-amt - m) / math.sqrt(p))
            lv = "下" if pdn >= pr else ("上" if pup >= pr else "なし")
            if START + timedelta(days=60) <= t <= TRAIN_END:
                ntr += 1
                trn += lv != "なし"
            if t > TRAIN_END and i + 2 < len(ys) and all(ys[i + k] is not None for k in range(3)):
                f = st.mean(ys[i:i + 3])
                res[lv].append(f)
                res["全部"].append(f)
        nn = len(res["全部"])
        sh = lambda lv, c: f"{len(res[lv]) / nn * 100:.0f}%の日 当たり {sum(1 for x in res[lv] if c(x)) / len(res[lv]) * 100:.0f}%" if res[lv] else "0%の日"
        print(f"  {amt}℃以上・確率 {pr * 100:.0f}%：下（実績が予報より低い） {sh('下', lambda x: x > 0)}／上 {sh('上', lambda x: x < 0)}"
              f"（何もしない時 下 {sum(1 for x in res['全部'] if x > 0) / nn * 100:.0f}%・上 {sum(1 for x in res['全部'] if x < 0) / nn * 100:.0f}%）／作る期間の警告 {trn / ntr * 100:.0f}%")


if __name__ == "__main__":
    main(sys.argv[1])
