"""FS-09：予報が外れやすい型（FS-08 で合格した候補の 6 つ）の日に、実際はどのくらいになったか（範囲）。

決め方は README の FS-09 の節（数える前に書いた）。型の判定は fs08.match（shared/forecastTypes.ts と同じ）。
材料は手元にあるものだけ（shiromatz の記録、fs03/fs08 の最高・最低、fs04/fs07 の日降水量）。
使い方：python3 -I fs09.py <forecast の ZIP があるフォルダ>
"""
import os, sys
from datetime import date

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs03 import load_forecasts  # noqa: E402
from fs08 import EARLY, TEST, TRAIN, days, load_obs_all, lookup, match  # noqa: E402

MIN_N = 20
CANDIDATES = [  # id, 項目, 何日前
    ("A-min-raised-L1", "min", (1,)),
    ("B-max-rain-L2-3", "max", (2, 3)),
    ("B-max-rain-L4-7", "max", (4, 5, 6, 7)),
    ("G-rain-summer-cloudy-L2-3", "rainMiss", (2, 3)),
    ("G-rain-summer-cloudy-L4-7", "rainMiss", (4, 5, 6, 7)),
    ("C-max-moved-L2-3", "max", (2, 3)),
]
PERIODS = (("手前", EARLY), ("作る", TRAIN), ("確かめる", TEST), ("全部", (EARLY[0], TEST[1])))


def q(xs):
    if len(xs) < MIN_N:
        return {"n": len(xs), "足りない": True}
    a = np.array(xs, float)
    return {"n": len(xs), "中央": float(np.median(a)), "10": float(np.quantile(a, 0.1)), "90": float(np.quantile(a, 0.9))}


def collect(tid, item, leads, per, fc, rng, obs, rain):
    inr, base = [], []
    for t in days(*per):
        for L in leads:
            f = fc.get((t, L), {})
            if item == "rainMiss":
                if f.get("pop") is None or f["pop"] >= 50 or rain.get(t) is None:
                    continue
                c = {"rain": rain[t]}
            else:
                o = (obs.get(t) or {}).get(item)
                if f.get(item) is None or o is None:
                    continue
                c = {"r": o - f[item]}
                r = rng.get((t, L), {})
                if L >= 2 and r.get(item + "_up") is not None:
                    lo, up = r[item + "_lo"], r[item + "_up"]
                    c["cov"] = "中" if lo <= o <= up else ("上" if o > up else "下")
            base.append(c)
            if match(tid, t, L, fc):
                inr.append(c)
    return inr, base


def fmt(s, unit="℃", sign=True):
    if s.get("足りない"):
        return f"{s['n']}件（件数が足りず判断できない）"
    f = (lambda v: f"{v:+.1f}") if sign else (lambda v: f"{v:.1f}")
    return f"{f(s['中央'])}{unit}（{f(s['10'])}〜{f(s['90'])}、{s['n']}件）"


def cover(cs):
    cs = [c for c in cs if "cov" in c]
    if len(cs) < MIN_N:
        return {"n": len(cs), "足りない": True}
    n = len(cs)
    out = [c for c in cs if c["cov"] != "中"]
    return {"n": n, "中": sum(c["cov"] == "中" for c in cs) / n,
            "上": (sum(c["cov"] == "上" for c in out) / len(out)) if out else float("nan"), "外": len(out)}


def fmt_cov(s):
    if s.get("足りない"):
        return f"{s['n']}件（件数が足りず判断できない）"
    return f"収まった {s['中'] * 100:.0f}%（{s['n']}件。外れた {s['外']}件のうち 上 {s['上'] * 100:.0f}%・下 {(1 - s['上']) * 100:.0f}%）"


def main(folder):
    fc = lookup(folder)
    rng = load_forecasts(folder)
    obs, rain = load_obs_all()
    for tid, item, leads in CANDIDATES:
        print(f"\n## {tid}")
        res = {}
        for pn, per in PERIODS:
            inr, base = collect(tid, item, leads, per, fc, rng, obs, rain)
            if item == "rainMiss":
                wi = [c["rain"] for c in inr if c["rain"] >= 1]
                wb = [c["rain"] for c in base if c["rain"] >= 1]
                si, sb = q(wi), q(wb)
                res[pn] = {"s": si}
                print(f"  {pn}：型 降った {len(wi)}/{len(inr)}（{len(wi) / max(len(inr), 1) * 100:.0f}%）、降水量 {fmt(si, 'mm', False)}"
                      f"／ふだん 降った {len(wb)}/{len(base)}（{len(wb) / max(len(base), 1) * 100:.0f}%）、降水量 {fmt(sb, 'mm', False)}")
            else:
                si, sb = q([c["r"] for c in inr]), q([c["r"] for c in base])
                ci, cb = cover(inr), cover(base)
                res[pn] = {"s": si, "c": ci}
                line = f"  {pn}：実際−予報 型 {fmt(si)}／ふだん {fmt(sb)}"
                if min(leads) >= 2:
                    line += f"\n      予測範囲 型 {fmt_cov(ci)}／ふだん {fmt_cov(cb)}"
                print(line)
        # 3. 期間で大きく変わるか（手前・作る・確かめる、20件以上どうし）
        ps = [p for p in ("手前", "作る", "確かめる") if not res[p]["s"].get("足りない")]
        flags = []
        for i in range(len(ps)):
            for j in range(i + 1, len(ps)):
                a, b = res[ps[i]]["s"], res[ps[j]]["s"]
                if item == "rainMiss":
                    hi, lo = max(a["中央"], b["中央"]), min(a["中央"], b["中央"])
                    if lo > 0 and hi / lo >= 2:
                        flags.append(f"{ps[i]}と{ps[j]}：降水量の中央値 {a['中央']:.1f}mm と {b['中央']:.1f}mm")
                    continue
                if abs(a["中央"] - b["中央"]) >= 1:
                    flags.append(f"{ps[i]}と{ps[j]}：中央値 {a['中央']:+.1f} と {b['中央']:+.1f}")
                wa, wb_ = a["90"] - a["10"], b["90"] - b["10"]
                if abs(wa - wb_) >= 2:
                    flags.append(f"{ps[i]}と{ps[j]}：10〜90% の幅 {wa:.1f} と {wb_:.1f}")
                ca, cb_ = res[ps[i]].get("c", {}), res[ps[j]].get("c", {})
                if min(leads) >= 2 and not ca.get("足りない") and not cb_.get("足りない") and abs(ca["中"] - cb_["中"]) >= 0.15:
                    flags.append(f"{ps[i]}と{ps[j]}：予測範囲に収まった {ca['中'] * 100:.0f}% と {cb_['中'] * 100:.0f}%")
        skipped = [p for p in ("手前", "作る", "確かめる") if p not in ps]
        print("  期間で大きく変わるか：", "変わる → " + "；".join(flags) if flags else "大きくは変わらない",
              f"（件数が足りず比べなかった期間：{'・'.join(skipped)}）" if skipped else "")


if __name__ == "__main__":
    main(sys.argv[1])
