"""FS-04 の 11〜13：偏りを状態空間モデル（ローカルレベル、1次元カルマンフィルタ）で。高知、気象庁、1〜7日前、最高・最低。

モデル：e_t = μ_t + ε_t（ε ~ N(0, σε²)）、μ_t = μ_{t−1} + η_t（η ~ N(0, ση²)）。e = 予報 − 実績（＋は実績が予報より低い）。
  - 日付の順に、欠けた日は状態だけ進める（予測の分散が ση² ずつ増える）。
  - σε²・ση² は最尤法（予測誤差分解の対数尤度、L-BFGS）。作る期間 2024-02〜2025-10 で推定し、確かめる期間 2025-11〜2026-10 で使う。
  - 季節：(a) 一定、(b) e をふだんの標準偏差（何日前 × 月の前後2か月、fs04.baseline）で割ってから当てはめる（σε が季節で変わる形）。
各日の「今の偏り」：その日の時点で答えの分かっている誤差（対象日が昨日まで）までで更新した μ の推定と分散。
ばらつき（12）：log(e² + 0.1) のローカルレベル（確率的ボラティリティの近似、カルマンで毎日回せる）と、|e| の EWMA を比べる。
補正（13）：予報の時点（D−n の 17時）までに分かっていた誤差（対象日が D−n−1 まで）だけで偏りを推定し、引いた場合の MAE。
使い方：python3 -I fs04_ss.py <forecast の ZIP があるフォルダ>
"""
import math, os, statistics as st, sys
from collections import defaultdict
from datetime import timedelta

import numpy as np
from scipy.optimize import minimize
from scipy.stats import norm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs04 import ALL, END, KEYS, START, TRAIN_END, baseline, build, days, series, smoother  # noqa: E402

LOG_C = 0.1


def kalman(ys, q, r, m0=0.0, p0=10.0):
    """ys：日付の順の値（欠けは None）。返す：各日の「その日の値を見る前」の (平均, 分散) と、対数尤度。"""
    m, p = m0, p0
    prior, ll = [], 0.0
    for y in ys:
        p = p + q
        prior.append((m, p))
        if y is None:
            continue
        s = p + r
        ll += -0.5 * (math.log(2 * math.pi * s) + (y - m) ** 2 / s)
        k = p / s
        m, p = m + k * (y - m), (1 - k) * p
    return prior, ll


def fit(ys):
    """σε²・ση² の最尤推定（対数で）。最初の 30 日は尤度に入れない（初めの分散の影響を除く）。"""
    def nll(th):
        q, r = math.exp(th[0]), math.exp(th[1])
        m, p, ll = 0.0, 10.0, 0.0
        for i, y in enumerate(ys):
            p += q
            if y is None:
                continue
            s = p + r
            if i >= 30:
                ll += -0.5 * (math.log(2 * math.pi * s) + (y - m) ** 2 / s)
            k = p / s
            m, p = m + k * (y - m), (1 - k) * p
        return -ll
    v = np.nanvar([y for y in ys if y is not None])
    best = None
    for q0 in (1e-4, 1e-2, 1e-1):
        res = minimize(nll, [math.log(q0 * v), math.log(v)], method="L-BFGS-B", bounds=[(-20, 3), (-10, 5)])
        if best is None or res.fun < best.fun:
            best = res
    return math.exp(best.x[0]), math.exp(best.x[1]), -best.fun


def daily(D, key, lead, a, b, scale=None):
    """対象日の順に並べた値（無い日は None）。scale：日ごとに割る標準偏差（季節の形）。"""
    out, ts = [], list(days(a, b))
    for t in ts:
        x = D.get((key, lead, t))
        if x is not None and scale:
            x = x / scale[(key, lead, t.month)]["e"][1]
        out.append(x)
    return ts, out


def main(folder):
    E, F, obs = build(folder)
    J = E["気象庁"]
    base = baseline(J, TRAIN_END)

    # ---------------------------------------------------------------- 11a. 推定
    print("## 11a. ローカルレベルの推定（作る期間）：ση（偏りの1日の変わりやすさ）・σε（日ごとのばらつき）・信号雑音比 q=ση²/σε²・EWMA に直した半減期")
    params = {}
    for key, name in KEYS:
        for lead in ALL:
            row = []
            for form, sc in (("一定", None), ("季節", base)):
                ts, ys = daily(J, key, lead, START, TRAIN_END, sc)
                q, r, ll = fit(ys)
                # 季節の形の尤度を元の尺度に直す（ヤコビアン：Σ log σ_t を引く）
                if sc:
                    ll -= sum(math.log(sc[(key, lead, t.month)]["e"][1]) for t, y in zip(ts, ys) if y is not None and ts.index(t) >= 30)
                ratio = q / r
                # 定常のカルマンゲイン k → EWMA の λ に対応（半減期 = ln0.5/ln(1−k)）
                p = (q + math.sqrt(q * q + 4 * q * r)) / 2
                k = p / (p + r)
                hl = math.log(0.5) / math.log(1 - k) if 0 < k < 1 else float("inf")
                params[(key, lead, form)] = (q, r)
                row.append(f"{form}：ση {math.sqrt(q):.3f} σε {math.sqrt(r):.2f} q {ratio:.4f} 半減期相当 {hl:.0f}日 対数尤度 {ll:.1f}")
            print(f"  {name} {lead}日前｜" + "｜".join(row))

    # ---------------------------------------------------------------- 11b. 今の偏りと確率、EWMA との比べ
    print("\n## 11b. 偏りの検知：確かめる期間で、毎日の「今の偏り」から『0.5℃以上 上／下に偏っている確率 ≥ 80%』を警告にし、EWMA（半減期3日・2σ）と比べる")
    print("   当たり：その日から3日の実際の e の平均が同じ向き（ふだんの割合と比べる）。作る期間の警告の割合（誤った警告の目安）。1〜7日前は日ごとの e を平均した系列で当てはめ直す。")
    for key, name in KEYS:
        for label, leads in (("1日前", (1,)), ("1〜7日前まとめ", ALL)):
            # 系列：対象日ごとに、leads の e の平均
            ts = list(days(START, END))
            ys = []
            for t in ts:
                xs = [J[(key, l, t)] for l in leads if (key, l, t) in J]
                ys.append(st.mean(xs) if len(xs) == len(leads) else None)
            tr = [y for t, y in zip(ts, ys) if t <= TRAIN_END]
            q, r, _ = fit(tr)
            prior, _ = kalman(ys, q, r)
            # 判定（その日の値を見る前＝昨日までで更新）
            res = defaultdict(list)
            trn = defaultdict(int)
            ntr = 0
            for i, t in enumerate(ts):
                m, p = prior[i]
                pu = 1 - norm.cdf((0.5 - m) / math.sqrt(p))   # e が +0.5 以上＝実績が予報より 0.5℃以上低い（下に偏る）
                pd = norm.cdf((-0.5 - m) / math.sqrt(p))      # e が −0.5 以下＝実績が上に偏る
                lvl = "下に偏る" if pu >= 0.8 else ("上に偏る" if pd >= 0.8 else "なし")
                if START + timedelta(days=60) <= t <= TRAIN_END:
                    ntr += 1
                    trn[lvl] += 1
                if t > TRAIN_END and all(ys[i + k] is not None for k in range(3) if i + k < len(ys)) and i + 2 < len(ys):
                    nx = st.mean(ys[i:i + 3])
                    res[lvl].append(nx)
                    res["全部"].append(nx)
            n = len(res["全部"])
            def show(lv, f):
                v = res[lv]
                return f"{len(v) / n * 100:.0f}%の日 当たり {sum(1 for x in v if f(x)) / len(v) * 100:.0f}%（ふだん {sum(1 for x in res['全部'] if f(x)) / n * 100:.0f}%）" if v else "0%の日"
            p_last = prior[-1]
            print(f"  {name} {label}（ση {math.sqrt(q):.3f}・σε {math.sqrt(r):.2f}）：下に偏る {show('下に偏る', lambda x: x > 0)}／上に偏る {show('上に偏る', lambda x: x < 0)}"
                  f"／作る期間の警告 {(trn['下に偏る'] + trn['上に偏る']) / ntr * 100:.0f}%"
                  f"／2026-10-31 の今の偏り {p_last[0]:+.2f}℃（95% {p_last[0] - 1.96 * math.sqrt(p_last[1]):+.2f}〜{p_last[0] + 1.96 * math.sqrt(p_last[1]):+.2f}）")
            # 比べ：EWMA（半減期3日・2σ）の向き
            ser = series(J, (key,), leads, base)
            ew, sig = smoother(ser, 3, START, END)
            r2 = defaultdict(list)
            tr2 = 0
            for i, t in enumerate(ts):
                if START + timedelta(days=60) <= t <= TRAIN_END and abs(ew[t]["e"]) > 2 * sig:
                    tr2 += 1
                if t > TRAIN_END and i + 2 < len(ys) and all(ys[i + k] is not None for k in range(3)):
                    nx = st.mean(ys[i:i + 3])
                    lv = "下に偏る" if ew[t]["e"] > 2 * sig else ("上に偏る" if ew[t]["e"] < -2 * sig else "なし")
                    r2[lv].append(nx)
            def show2(lv, f):
                v = r2[lv]
                return f"{len(v) / n * 100:.0f}%の日 当たり {sum(1 for x in v if f(x)) / len(v) * 100:.0f}%" if v else "0%の日"
            print(f"     EWMA 半減期3・2σ：下 {show2('下に偏る', lambda x: x > 0)}／上 {show2('上に偏る', lambda x: x < 0)}／作る期間の警告 {tr2 / ntr * 100:.0f}%")
            # 気づく早さ：確かめる期間で、28日の中心移動平均の e が ±0.5 を越えた区間の始まりから、各方法の警告まで
            cm = {}
            for i, t in enumerate(ts):
                w = [ys[j] for j in range(max(0, i - 7), min(len(ys), i + 7)) if ys[j] is not None]
                cm[t] = st.mean(w) if len(w) >= 10 else 0
            starts = [t for i, t in enumerate(ts) if t > TRAIN_END and i > 0 and abs(cm[t]) >= 0.5 and abs(cm[ts[i - 1]]) < 0.5]
            dk, de = [], []
            for s in starts:
                sg = 1 if cm[s] > 0 else -1
                i0 = ts.index(s)
                for j in range(i0 - 7, min(len(ts), i0 + 15)):
                    m, p = prior[j]
                    pr = (1 - norm.cdf((0.5 - m) / math.sqrt(p))) if sg > 0 else norm.cdf((-0.5 - m) / math.sqrt(p))
                    if pr >= 0.8:
                        dk.append(j - i0)
                        break
                else:
                    dk.append(None)
                for j in range(i0 - 7, min(len(ts), i0 + 15)):
                    if sg * ew[ts[j]]["e"] > 2 * sig:
                        de.append(j - i0)
                        break
                else:
                    de.append(None)
            f = lambda v: f"{sum(1 for x in v if x is not None)}/{len(v)} 件、中央 {st.median([x for x in v if x is not None]):+.0f}日" if any(x is not None for x in v) else f"0/{len(v)} 件"
            print(f"     偏った時期（中心14日平均の e が ±0.5℃ を越えた所）に気づく：カルマン {f(dk)}／EWMA {f(de)}（負は始まりより前）")

    # ---------------------------------------------------------------- 12. ばらつきの変化
    print("\n## 12. ばらつき：|e| の EWMA（z、半減期3日）と、log(e²+0.1) のローカルレベルの比べ。後3日の実際の |e| の z の平均との相関（確かめる期間）")
    for key, name in KEYS:
        for label, leads in (("1日前", (1,)), ("1〜7日前まとめ", ALL)):
            ser = series(J, (key,), leads, base)
            ew, _ = smoother(ser, 3, START, END)
            ts = list(days(START, END))
            ys = [math.log(ser[t][1]["e"] ** 2 + LOG_C) if t in ser else None for t in ts]
            # 季節の形：log 尺度で、作る期間の月ごとの平均を引く
            mon = defaultdict(list)
            for t, y in zip(ts, ys):
                if y is not None and t <= TRAIN_END:
                    mon[t.month].append(y)
            mm = {m: st.mean(sum((mon[((m - 1 + k) % 12) + 1] for k in (-2, -1, 0, 1, 2)), [])) for m in range(1, 13)}
            ys2 = [None if y is None else y - mm[t.month] for t, y in zip(ts, ys)]
            q, r, _ = fit([y for t, y in zip(ts, ys2) if t <= TRAIN_END])
            prior, _ = kalman(ys2, q, r)
            a1, a2, fut = [], [], []
            for i, t in enumerate(ts):
                if t > TRAIN_END and i + 2 < len(ts) and all((ts[i + k]) in ser for k in range(3)):
                    fut.append(st.mean(ser[ts[i + k]][0]["abs"] for k in range(3)))
                    a1.append(ew[t]["abs"])
                    a2.append(prior[i][0])
            c1, c2 = np.corrcoef(a1, fut)[0, 1], np.corrcoef(a2, fut)[0, 1]
            print(f"  {name} {label}：EWMA の相関 {c1:+.2f}／log のローカルレベル {c2:+.2f}（ση {math.sqrt(q):.3f}・σε {math.sqrt(r):.2f}）")

    # ---------------------------------------------------------------- 13. 補正の確かめ
    print("\n## 13. 補正の確かめ（アプリには入れない）：予報の時点で分かっていた誤差だけで偏りを推定して引いた MAE（確かめる期間、同じ日）")
    for key, name in KEYS:
        for lead in ALL:
            ts = list(days(START, END))
            ys = [J.get((key, lead, t)) for t in ts]
            q, r, _ = fit([y for t, y in zip(ts, ys) if t <= TRAIN_END])
            # 予報の時点 = 対象日 − lead の 17時：分かっている誤差は対象日が t − lead − 1 まで。
            # prior[i] は対象日 ts[i−1] まで見た後の推定なので、対象日 t の補正には prior[i − lead] を使う（状態は random walk で、平均はそのまま）
            prior, _ = kalman(ys, q, r)
            ser = series(J, (key,), (lead,), base)
            lam = 1 - 0.5 ** (1 / 14)
            ewm, em = {}, 0.0
            for t in ts:
                ewm[t] = em
                if (key, lead, t) in J:
                    em = lam * J[(key, lead, t)] + (1 - lam) * em
            raw, kal, ew14, seas = [], [], [], []
            sm = defaultdict(list)
            for (k, l, t), x in J.items():
                if k == key and l == lead and t <= TRAIN_END:
                    sm[t.month].append(x)
            smm = {m: st.mean(sum((sm[((m - 1 + j) % 12) + 1] for j in (-2, -1, 0, 1, 2)), [])) for m in range(1, 13)}
            for i, t in enumerate(ts):
                if t <= TRAIN_END or ys[i] is None or i - lead < 0:
                    continue
                y = ys[i]
                raw.append(abs(y))
                kal.append(abs(y - prior[i - lead][0]))
                ew14.append(abs(y - ewm[ts[i - lead]]))
                seas.append(abs(y - smm[t.month]))
            print(f"  {name} {lead}日前：そのまま {st.mean(raw):.3f}／カルマンの偏りを引く {st.mean(kal):.3f}（ση {math.sqrt(q):.3f}）／EWMA（半減期14日）を引く {st.mean(ew14):.3f}／季節の平均（作る期間）を引く {st.mean(seas):.3f}")


if __name__ == "__main__":
    main(sys.argv[1])
