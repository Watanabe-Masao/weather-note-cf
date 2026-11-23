"""FS-04 の 14〜16：季節のふだんとしての「変わりやすさ」と「外れやすさ」（高知、気象庁の府県・週間天気予報）。

材料：shiromatz の記録（予報）と fs03_obs_47893.csv（実績の最高・最低）。外部は読まない。
  - 予報は、予報した日（D−n）の値のある中でいちばん遅い発表（fs03.load_forecasts と同じ考え）。
  - 天気：1〜2日前は府県天気予報（中部 390010）の天気コード、3〜7日前は週間（高知県 390000）。百の位で 晴(1)・くもり(2)・雨(3)・雪(4)。
  - 降水確率（日）：2〜7日前は週間の日の降水確率。1日前は府県天気予報の6時間降水確率のいちばん高い区切り（アプリと同じ）。
変わりやすさ（対象日ごと）：
  - 気温：7日前→1日前の6回の動きの合計 Σ|F_n − F_{n+1}|（℃）と、正味 |F_1 − F_7|。
  - 天気：7日前→1日前の6回で、晴・くもり・雨・雪 の入れ替わった回数。
  - 降水確率：7日前→2日前の5回の動きの合計（％。1日前は作り方が違うので入れない）。
外れやすさ：気温の MAE とかたより（e＝予報−実績）、1日前と 1〜7日前の平均。雨の適中率などは、降水量の実績が要る（fs04_rain.py、未実行）。
幅：移動ブロック・ブートストラップ（ブロック7日、2,000回）。
使い方：python3 -I fs04_season.py <forecast の ZIP があるフォルダ>
"""
import csv, io, math, os, random, statistics as st, sys
from collections import defaultdict
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs03 import find_csv, load_forecasts, load_obs  # noqa: E402

START, END = date(2024, 2, 1), date(2026, 10, 31)
TRAIN_END = date(2025, 10, 31)
CAT = {"1": "晴", "2": "くもり", "3": "雨", "4": "雪"}
GROUPS = {"梅雨（6〜7月）": {6, 7}, "秋（9〜11月）": {9, 10, 11}, "春（3〜5月）": {3, 4, 5}, "夏（7〜8月）": {7, 8}, "冬（12〜2月）": {12, 1, 2}}


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def load_wx_pop(folder):
    """（対象日, 何日前）→ {"wx": 晴/くもり/雨/雪, "pop": 日の降水確率}。予報した日ごとに、いちばん遅い発表の値。"""
    per = defaultdict(dict)  # (発表の日, 対象日) -> (発表時刻, dict)
    for fn in sorted(os.listdir(folder)):
        ym = fn[9:15]
        raw = find_csv(open(os.path.join(folder, fn), "rb").read(), f"forecast_{ym}_390000.csv")
        if raw is None:
            continue
        for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
            rep = r["reportDatetime"]
            td = r["timeDefine"]
            t = date.fromisoformat(td[:10])
            d0 = date.fromisoformat(rep[:10])
            lead = (t - d0).days
            if not 1 <= lead <= 7:
                continue
            code = r.get("weatherCodes") or r.get("weatherCode") or ""
            pop = r.get("pops") or r.get("pop") or ""
            key = (d0, t)
            slot = per[key].setdefault(rep, {"pop6": []})
            if r["areaCode"] == "390010":
                if code and lead <= 2:
                    slot["wx1"] = CAT.get(code[0])
                if pop and lead == 1 and td[11:13] in ("00", "06", "12", "18"):
                    slot["pop6"].append(int(pop))
            elif r["areaCode"] == "390000":
                if code:
                    slot["wxw"] = CAT.get(code[0])
                if pop:
                    slot["popw"] = int(pop)
    out = {}
    for (d0, t), reps in per.items():
        lead = (t - d0).days
        v = {}
        for rep in sorted(reps):  # 遅い発表で上書き
            s = reps[rep]
            wx = s.get("wx1") if lead <= 2 else s.get("wxw")
            if wx:
                v["wx"] = wx
            if lead == 1 and len(s["pop6"]) >= 3:
                v["pop"] = max(s["pop6"])
            elif lead >= 2 and "popw" in s:
                v["pop"] = s["popw"]
        if v:
            out[(t, lead)] = v
    return out


def mbb_diff(series, ingroup, block=7, B=2000, seed=1):
    """series：日付の順 [(日, 値)]。ingroup(日) が真の日の平均 − それ以外の平均 の 95% の幅（ブロックは日付の順で切る）。"""
    rnd = random.Random(seed)
    n = len(series)
    k = math.ceil(n / block)
    res = []
    for _ in range(B):
        g, o = [], []
        for _ in range(k):
            i = rnd.randrange(0, n - block + 1)
            for d, x in series[i:i + block]:
                (g if ingroup(d) else o).append(x)
        if g and o:
            res.append(st.mean(g) - st.mean(o))
    res.sort()
    return res[int(0.025 * len(res))], res[int(0.975 * len(res))]


def mbb_mean(xs, block=7, B=2000, seed=2):
    rnd = random.Random(seed)
    n = len(xs)
    if n < block * 2:
        return float("nan"), float("nan")
    k = math.ceil(n / block)
    res = []
    for _ in range(B):
        s = []
        for _ in range(k):
            i = rnd.randrange(0, n - block + 1)
            s += xs[i:i + block]
        res.append(st.mean(s[:n]))
    res.sort()
    return res[int(0.025 * B)], res[int(0.975 * B)]


def main(folder):
    fc, obs = load_forecasts(folder), load_obs()
    wp = load_wx_pop(folder)
    M = defaultdict(dict)  # 対象日 -> 指標
    for t in days(START, END):
        for key, nm in (("max", "最高"), ("min", "最低")):
            fs = [fc.get((t, l), {}).get(key) for l in range(1, 8)]
            if all(f is not None for f in fs):
                M[t][f"{nm}の動き"] = sum(abs(fs[i] - fs[i + 1]) for i in range(6))
                M[t][f"{nm}の正味の動き"] = abs(fs[0] - fs[6])
            o = obs.get(t, {}).get(key)
            if o is not None and fs[0] is not None:
                M[t][f"{nm} 1日前の外れ"] = abs(fs[0] - o)
                M[t][f"{nm} 1日前のかたより"] = fs[0] - o
            if o is not None and all(f is not None for f in fs):
                M[t][f"{nm} 1〜7日前の外れ"] = st.mean(abs(f - o) for f in fs)
                M[t][f"{nm} 1〜7日前のかたより"] = st.mean(f - o for f in fs)
        wx = [wp.get((t, l), {}).get("wx") for l in range(1, 8)]
        if all(wx):
            M[t]["天気の入れ替わり"] = sum(1 for i in range(6) if wx[i] != wx[i + 1])
            M[t]["7日前と1日前で天気が違う"] = 1.0 if wx[0] != wx[6] else 0.0
        pp = [wp.get((t, l), {}).get("pop") for l in range(2, 8)]
        if all(p is not None for p in pp):
            M[t]["降水確率の動き"] = sum(abs(pp[i] - pp[i + 1]) for i in range(5))
    names = ["最高の動き", "最低の動き", "最高の正味の動き", "最低の正味の動き", "天気の入れ替わり", "7日前と1日前で天気が違う", "降水確率の動き",
             "最高 1日前の外れ", "最低 1日前の外れ", "最高 1〜7日前の外れ", "最低 1〜7日前の外れ", "最高 1日前のかたより", "最低 1日前のかたより",
             "最高 1〜7日前のかたより", "最低 1〜7日前のかたより"]
    print("そろった日：", {n: sum(1 for t in M if n in M[t]) for n in names})

    # ---------------------------------------------------------------- 14. 月ごと
    print("\n## 14. 月ごとの値（全期間 2024-02〜2026-10、対象日の月。かっこはブロック・ブートストラップの 95% の幅）")
    for n in names:
        row = []
        for m in range(1, 13):
            xs = [M[t][n] for t in sorted(M) if t.month == m and n in M[t]]
            lo, hi = mbb_mean(xs)
            row.append(f"{m}月 {st.mean(xs):.2f}（{lo:.2f}〜{hi:.2f}）")
        allx = [M[t][n] for t in M if n in M[t]]
        print(f"  {n}｜全体 {st.mean(allx):.2f}｜" + " ".join(row))

    # ---------------------------------------------------------------- 15. 言い伝え
    print("\n## 15. 言い伝えの確かめ：その時期の平均 − それ以外の平均（95% の幅、ブロック7日）。幅が 0 を含まなければ「違いあり」")
    for n in names:
        ser = [(t, M[t][n]) for t in sorted(M) if n in M[t]]
        line = []
        for g, months in GROUPS.items():
            a = st.mean(x for t, x in ser if t.month in months)
            b = st.mean(x for t, x in ser if t.month not in months)
            lo, hi = mbb_diff(ser, lambda d, ms=months: d.month in ms)
            mark = "＋" if lo > 0 else ("−" if hi < 0 else "・")
            line.append(f"{g} {a:.2f}対{b:.2f} 差 {a - b:+.2f}（{lo:+.2f}〜{hi:+.2f}）{mark}")
        print(f"  {n}｜" + "｜".join(line))

    # ---------------------------------------------------------------- 16. 「今」をその時期のふだんと比べる
    print("\n## 16. 「この時期にしては」：月の前後2か月のふだん（作る期間）で標準化した z を EWMA（半減期3日）。線 2σ と 2.5σ。確かめる期間で、その日から3日の実際の z の平均の当たり")
    for n in ("最高の動き", "最低の動き", "天気の入れ替わり", "降水確率の動き", "最高 1〜7日前の外れ", "最低 1〜7日前の外れ", "最高 1日前の外れ", "最低 1〜7日前のかたより"):
        base = {}
        for m in range(1, 13):
            w = {((m - 1 + k) % 12) + 1 for k in (-2, -1, 0, 1, 2)}
            xs = [M[t][n] for t in M if n in M[t] and t <= TRAIN_END and t.month in w]
            base[m] = (st.mean(xs), st.stdev(xs))
        z = {t: (M[t][n] - base[t.month][0]) / base[t.month][1] for t in M if n in M[t]}
        ts = sorted(z)
        lag = st.correlation([z[ts[i - 1]] for i in range(1, len(ts)) if (ts[i] - ts[i - 1]).days == 1],
                             [z[ts[i]] for i in range(1, len(ts)) if (ts[i] - ts[i - 1]).days == 1])
        # 変わりやすさは、対象日の前日までの予報の動きが分かるのは「1日前の発表の後」。外れは実績の後。どちらも対象日が昨日までの値で EWMA。
        lam = 1 - 0.5 ** (1 / 3)
        sig = math.sqrt(lam / (2 - lam))
        e, ew = 0.0, {}
        for t in days(START, END):
            ew[t] = e
            if t in z:
                e = lam * z[t] + (1 - lam) * e
        for L in (2.0, 2.5):
            hi_, lo_, allf = [], [], []
            tr = sum(1 for t in days(START + timedelta(days=60), TRAIN_END) if abs(ew[t]) > L * sig)
            ntr = (TRAIN_END - START).days - 60
            for t in days(TRAIN_END + timedelta(days=1), END - timedelta(days=2)):
                nx = [z.get(t + timedelta(days=k)) for k in range(3)]
                if any(x is None for x in nx):
                    continue
                f = st.mean(nx)
                allf.append(f)
                if ew[t] > L * sig:
                    hi_.append(f)
                elif ew[t] < -L * sig:
                    lo_.append(f)
            pr = lambda v, c: f"{len(v) / len(allf) * 100:.0f}%の日 当たり {sum(1 for x in v if c(x)) / len(v) * 100:.0f}%" if v else "0%の日"
            print(f"  {n}（1日ずらした相関 {lag:+.2f}）{L}σ：この時期にしては大きい {pr(hi_, lambda x: x > 0)}（何もしない時 {sum(1 for x in allf if x > 0) / len(allf) * 100:.0f}%）"
                  f"／小さい {pr(lo_, lambda x: x < 0)}（{sum(1 for x in allf if x < 0) / len(allf) * 100:.0f}%）／作る期間で越えた日 {tr / ntr * 100:.0f}%")


if __name__ == "__main__":
    main(sys.argv[1])
