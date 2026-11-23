"""FS-03：予報の誤差の範囲を統計で求める（高知、気象庁の府県・週間天気予報の最高・最低、1〜7日前）。

材料
- 予報：shiromatz/Japan-Meteorological-Agency-Weather-Forecast（CC BY-SA 4.0）の月ごとの ZIP（気象庁 forecast/390000.json の記録）。
  予報した日（D−n）の、値のある中でいちばん遅い発表（FS-01 と同じ）。週間予報の「予測範囲」（Upper/Lower）も読む。
- 実績：fs03_obs_47893.csv（気象庁 過去の気象データ、高知 47893 の日最高・日最低）。
使い方：python3 -I fs03.py <forecast の ZIP があるフォルダ>
誤差 e = 予報 − 実績（℃）。範囲は「実績 = 予報 − e」なので [予報 − e の上の分位, 予報 − e の下の分位]。
"""
import csv, io, math, os, statistics as st, sys, zipfile
from collections import defaultdict
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
Z80 = 1.2816  # 正規分布の 10%・90%
START, END = date(2024, 2, 1), date(2026, 10, 31)
TRAIN_END = date(2025, 10, 31)  # 古い期間 2024-02〜2025-10（21か月）、新しい期間 2025-11〜2026-10（12か月）
SEASON = {12: "冬", 1: "冬", 2: "冬", 3: "春", 4: "春", 5: "春", 6: "夏", 7: "夏", 8: "夏", 9: "秋", 10: "秋", 11: "秋"}
KEYS = (("max", "最高"), ("min", "最低"))


def find_csv(zbytes, name):
    with zipfile.ZipFile(io.BytesIO(zbytes)) as z:
        if name in z.namelist():
            return z.read(name)
        for n in z.namelist():
            if n.endswith(".zip"):
                r = find_csv(z.read(n), name)
                if r:
                    return r
    return None


def load_forecasts(folder):
    per_rep = defaultdict(dict)
    for fn in sorted(os.listdir(folder)):
        ym = fn[9:15]
        raw = find_csv(open(os.path.join(folder, fn), "rb").read(), f"forecast_{ym}_390000.csv")
        if raw is None:
            continue
        for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
            if r["areaCode"] != "74182":
                continue
            g = lambda a, b: r.get(a) or r.get(b) or ""
            rep, td = r["reportDatetime"], r["timeDefine"]
            slot = per_rep[rep].setdefault(td[:10], {})
            for key, cap in (("max", "Max"), ("min", "Min")):
                v = g(f"temps{cap}", f"temp{cap}")
                if v:
                    slot[key] = float(v)
                    up, lo = g(f"temps{cap}Upper", f"temp{cap}Upper"), g(f"temps{cap}Lower", f"temp{cap}Lower")
                    if up and lo:
                        slot[key + "_up"], slot[key + "_lo"] = float(up), float(lo)
            t = g("temps", "temp")
            if t and td[:10] > rep[:10]:
                key = "min" if td[11:13] == "00" else ("max" if td[11:13] == "09" else None)
                if key:
                    slot.setdefault(key, float(t))
    fc = {}  # (対象日, 何日前) -> {max, min, max_up, ...}
    for rep in sorted(per_rep):
        d0 = date.fromisoformat(rep[:10])
        for tdate, v in per_rep[rep].items():
            lead = (date.fromisoformat(tdate) - d0).days
            if 1 <= lead <= 7:
                fc.setdefault((date.fromisoformat(tdate), lead), {}).update(v)
    return fc


def load_obs():
    obs = {}
    with open(os.path.join(HERE, "fs03_obs_47893.csv"), encoding="utf-8") as f:
        next(f)
        for line in f:
            d, mx, mn = line.strip().split(",")
            obs[date.fromisoformat(d)] = {"max": float(mx) if mx else None, "min": float(mn) if mn else None}
    return obs


def q(xs, p):
    """分位（線形補間、numpy の既定と同じ）。"""
    xs = sorted(xs)
    i = (len(xs) - 1) * p
    lo = math.floor(i)
    return xs[lo] + (xs[min(lo + 1, len(xs) - 1)] - xs[lo]) * (i - lo)


def skew(xs):
    m, s = st.mean(xs), st.pstdev(xs)
    return sum(((x - m) / s) ** 3 for x in xs) / len(xs) if s else 0


def main(folder):
    fc, obs = load_forecasts(folder), load_obs()
    err = defaultdict(list)  # (key, lead) -> [(対象日, e, 予報)]
    for (d, lead), v in sorted(fc.items()):
        if not (START <= d <= END) or d not in obs:
            continue
        for key, _ in KEYS:
            o = obs[d][key]
            if key in v and o is not None:
                err[(key, lead)].append((d, v[key] - o, v[key]))
    print(f"予報と実績がそろった数：", {f"{k}{l}": len(x) for (k, l), x in sorted(err.items())})

    # ---------------------------------------------------------------- 1. 分布
    print("\n## 1. 誤差の分布（予報−実績、℃）：何日前 × 季節（冬12-2・春3-5・夏6-8・秋9-11）")
    print("項目 何日前 季節 n 平均 標準偏差 歪度 10% 50% 90% |e|>3の割合 最小 最大")
    for key, name in KEYS:
        for lead in range(1, 8):
            for s in ("全体", "冬", "春", "夏", "秋"):
                xs = [e for d, e, _ in err[(key, lead)] if s == "全体" or SEASON[d.month] == s]
                if not xs:
                    continue
                print(f"{name} {lead} {s} {len(xs)} {st.mean(xs):+.2f} {st.stdev(xs):.2f} {skew(xs):+.2f} "
                      f"{q(xs, .1):+.1f} {q(xs, .5):+.1f} {q(xs, .9):+.1f} {sum(abs(x) > 3 for x in xs) / len(xs) * 100:.0f}% {min(xs):+.1f} {max(xs):+.1f}")

    # ---------------------------------------------------------------- 2・3. 範囲の求め方と当たり具合
    print("\n## 2・3. 80% の範囲：古い期間（2024-02〜2025-10）で作り、新しい期間（2025-11〜2026-10）で確かめる")

    def group_fn(method):
        if method in ("①季節", "②季節"):
            return lambda d: [m for m in range(1, 13) if SEASON[m] == SEASON[d.month]]
        if method in ("②全年", "①全年"):
            return lambda d: list(range(1, 13))
        if method in ("③前後1か月", "①前後1か月"):
            return lambda d: [((d.month - 1 + k) % 12) + 1 for k in (-1, 0, 1)]
        if method == "③前後2か月":
            return lambda d: [((d.month - 1 + k) % 12) + 1 for k in (-2, -1, 0, 1, 2)]
        if method == "②月":
            return lambda d: [d.month]

    def interval(method, train, d):
        months = set(group_fn(method)(d))
        xs = [e for dd, e, _ in train if dd.month in months]
        if len(xs) < 20:
            return None
        if method.startswith("①"):
            m, s = st.mean(xs), st.stdev(xs)
            return m - Z80 * s, m + Z80 * s  # e の 10%・90%
        return q(xs, .1), q(xs, .9)

    methods = ["①全年", "①季節", "①前後1か月", "②全年", "②月", "②季節", "③前後1か月", "③前後2か月"]
    summary = {}
    for key, name in KEYS:
        print(f"\n[{name}] 方法ごと：入った割合（目標 80%）／平均の広さ（℃）／季節ごとの入った割合（冬・春・夏・秋）")
        for method in methods:
            cover_all, width_all, by_season, score = [], [], defaultdict(list), []
            for lead in range(1, 8):
                rows = err[(key, lead)]
                train = [r for r in rows if r[0] <= TRAIN_END]
                test = [r for r in rows if r[0] > TRAIN_END]
                cov, wid = [], []
                for d, e, f in test:
                    it = interval(method, train, d)
                    if it is None:
                        continue
                    lo_e, hi_e = it
                    inside = lo_e <= e <= hi_e  # 実績が [予報−hi, 予報−lo] に入る
                    # 区間のスコア（Winkler、α=0.2）：広さ＋外れた分×10。小さいほどよい
                    score.append((hi_e - lo_e) + 10 * max(0, lo_e - e) + 10 * max(0, e - hi_e))
                    cov.append(inside)
                    wid.append(hi_e - lo_e)
                    by_season[SEASON[d.month]].append(inside)
                cover_all += cov
                width_all += wid
                summary[(key, method, lead)] = (sum(cov) / len(cov), st.mean(wid), len(cov))
            ss = " ".join(f"{s}{sum(by_season[s]) / len(by_season[s]) * 100:.0f}%" for s in ("冬", "春", "夏", "秋") if by_season[s])
            spread = st.pstdev([sum(by_season[x]) / len(by_season[x]) * 100 for x in ("冬", "春", "夏", "秋")])
            print(f"  {method}: {sum(cover_all) / len(cover_all) * 100:.1f}%／{st.mean(width_all):.2f}℃／{ss}／季節のばらつき {spread:.1f}点／区間のスコア {st.mean(score):.2f}")
        print(f"  何日前ごと（入った割合・広さ）：")
        for method in methods:
            print("   ", method, " ".join(f"{l}日:{summary[(key, method, l)][0] * 100:.0f}%/{summary[(key, method, l)][1]:.1f}" for l in range(1, 8)))

    # 逆の向き（新しい期間で作り、古い期間で確かめる）も1つだけ：③前後1か月と②季節
    print("\n[逆の向き] 新しい期間（2025-11〜2026-10）で作り、古い期間（2024-02〜2025-10）で確かめる")
    for key, name in KEYS:
        for method in ("②全年", "②季節", "③前後1か月"):
            cov, wid = [], []
            for lead in range(1, 8):
                rows = err[(key, lead)]
                train = [r for r in rows if r[0] > TRAIN_END]
                for d, e, f in [r for r in rows if r[0] <= TRAIN_END]:
                    it = interval(method, train, d)
                    if it:
                        cov.append(it[0] <= e <= it[1])
                        wid.append(it[1] - it[0])
            print(f"  {name} {method}: {sum(cov) / len(cov) * 100:.1f}%／{st.mean(wid):.2f}℃")

    # ---------------------------------------------------------------- 4. 傾向（上振れ・下振れ）
    print("\n## 4. 誤差の平均（上振れ＋・下振れ−）：全期間（95% の幅、日ごとの相関は見ていない）と最近 30・90 日（〜2026-10-31）")
    for key, name in KEYS:
        for lead in range(1, 8):
            xs = [e for _, e, _ in err[(key, lead)]]
            m, se = st.mean(xs), st.stdev(xs) / math.sqrt(len(xs))
            r30 = [e for d, e, _ in err[(key, lead)] if d > END - timedelta(days=30)]
            r90 = [e for d, e, _ in err[(key, lead)] if d > END - timedelta(days=90)]
            def ci(v):
                return f"{st.mean(v):+.2f}（±{1.96 * st.stdev(v) / math.sqrt(len(v)):.2f}）"
            print(f"  {name} {lead}日前：全期間 {m:+.2f}（±{1.96 * se:.2f}） 最近90日 {ci(r90)} 最近30日 {ci(r30)}")
    print("\n  最近の平均を引くと当たるか（新しい期間で、対象日より lead+1 日以上前に分かっている誤差の平均を引く）：絶対値の平均")
    for key, name in KEYS:
        for lead in (1, 3, 5, 7):
            rows = err[(key, lead)]
            known = {d: e for d, e, _ in rows}
            res = {"そのまま": [], "30日": [], "90日": [], "季節の平均（古い期間）": []}
            train = [r for r in rows if r[0] <= TRAIN_END]
            for d, e, f in [r for r in rows if r[0] > TRAIN_END]:
                res["そのまま"].append(abs(e))
                for w in (30, 90):
                    past = [known[x] for x in (d - timedelta(days=k) for k in range(lead + 1, lead + 1 + w)) if x in known]
                    res[f"{w}日"].append(abs(e - st.mean(past)) if past else abs(e))
                sm = [ee for dd, ee, _ in train if SEASON[dd.month] == SEASON[d.month]]
                res["季節の平均（古い期間）"].append(abs(e - st.mean(sm)))
            print(f"   {name} {lead}日前：" + " ".join(f"{k} {st.mean(v):.3f}" for k, v in res.items()))

    # ---------------------------------------------------------------- 5. 収束
    print("\n## 5. 収束：80% の範囲の広さ（全期間の誤差の 10%〜90%、℃）")
    for key, name in KEYS:
        line = []
        for lead in range(1, 8):
            xs = [e for _, e, _ in err[(key, lead)]]
            line.append(f"{lead}日:{q(xs, .9) - q(xs, .1):.1f}")
        print(f"  {name} " + " ".join(line))
        for s in ("冬", "春", "夏", "秋"):
            line = []
            for lead in range(1, 8):
                xs = [e for d, e, _ in err[(key, lead)] if SEASON[d.month] == s]
                line.append(f"{q(xs, .9) - q(xs, .1):.1f}")
            print(f"    {s} " + " ".join(line))

    # ---------------------------------------------------------------- 6. 気象庁の予測範囲
    print("\n## 6. 気象庁の週間の予測範囲（新しい期間、2〜7日前）と ③前後1か月 の比べ")
    print("  気象庁：実績（そのまま／整数に四捨五入）が [Lower, Upper] に入った割合、広さ Upper−Lower（整数の実績で見ると +1）")
    for key, name in KEYS:
        for lead in range(1, 8):
            jm_raw, jm_round, jw, ours, ow, n_ours = [], [], [], [], [], 0
            rows = err[(key, lead)]
            train = [r for r in rows if r[0] <= TRAIN_END]
            for d, e, f in [r for r in rows if r[0] > TRAIN_END]:
                v = fc[(d, lead)]
                o = obs[d][key]
                if key + "_up" in v:
                    lo, up = v[key + "_lo"], v[key + "_up"]
                    jm_raw.append(lo <= o <= up)
                    jm_round.append(lo <= math.floor(o + 0.5) <= up)
                    jw.append(up - lo)
                    it = interval("③前後1か月", train, d)
                    ours.append(it[0] <= e <= it[1])
                    ow.append(it[1] - it[0])
            if not jw:
                print(f"  {name} {lead}日前：予測範囲なし")
                continue
            print(f"  {name} {lead}日前 n={len(jw)}：気象庁 {sum(jm_raw) / len(jm_raw) * 100:.0f}%（四捨五入 {sum(jm_round) / len(jm_round) * 100:.0f}%）広さ {st.mean(jw):.2f}（+1 で {st.mean(jw) + 1:.2f}）"
                  f" ／ ③前後1か月 {sum(ours) / len(ours) * 100:.0f}% 広さ {st.mean(ow):.2f}")


if __name__ == "__main__":
    main(sys.argv[1])
