"""FS-11：週間予報の雨の日が前後にずれる（高知、気象庁の府県・週間天気予報だけ）。

決め方は README の FS-11 の節（数える前に書いた）。材料は手元にあるものだけ。
使い方：
  python3 -I fs11.py describe <フォルダ> <main の shared>   1. 外れ方の分け方（数えるだけ）
  python3 -I fs11.py train <フォルダ> <main の shared>      2. 作る期間で、切り口を偽の発見率と合格の基準で選ぶ
  python3 -I fs11.py confirm <フォルダ> <main の shared>    2. 候補を、確かめる期間と手前の期間で1回ずつ数える
  python3 -I fs11.py rel_train|rel_confirm <フォルダ> <main の shared>   FS-11b（信頼度ごと）
"""
import csv, io, os, re, sys
from collections import Counter, defaultdict
from datetime import date, timedelta

from scipy.stats import binom

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs03 import find_csv  # noqa: E402
from fs05 import bh, block_ratio_ci  # noqa: E402
from fs08 import EARLY, TEST, TRAIN, days, load_obs_all  # noqa: E402

D1 = timedelta(days=1)
PASS = {"minRatio": 1.3, "ciLowAbove": 1, "minDays": 20, "directionShareAbove": 0.5}
SEASON4 = {12: "冬", 1: "冬", 2: "冬", 3: "春", 4: "春", 5: "春", 6: "夏", 7: "夏", 8: "夏", 9: "秋", 10: "秋", 11: "秋"}
SHIFT = ("早まった", "遅れた", "前後とも")


def code_texts(shared):
    src = open(os.path.join(shared, "weatherCode.ts"), encoding="utf-8").read()
    return {m.group(1): m.group(2) for m in re.finditer(r'"(\d{3})": \["[^"]*", "[^"]*", "\d{3}", "([^"]*)"', src)}


def load(folder):
    """週間：(D, t) → {code, pop, rel}（D の日のいちばん遅い発表で、値のあるもの）。府県：(D, t) → 番号（中部、t＝D+2）。"""
    wk = defaultdict(dict)
    pf = defaultdict(dict)
    for fn in sorted(os.listdir(folder)):
        ym = fn[9:15]
        raw = find_csv(open(os.path.join(folder, fn), "rb").read(), f"forecast_{ym}_390000.csv")
        if raw is None:
            continue
        for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
            rep, td = r["reportDatetime"], r["timeDefine"]
            d0, t = date.fromisoformat(rep[:10]), date.fromisoformat(td[:10])
            lead = (t - d0).days
            code = r.get("weatherCodes") or r.get("weatherCode") or ""
            if r["areaCode"] == "390000" and 1 <= lead <= 7:
                pop = r.get("pops") or r.get("pop") or ""
                rel = r.get("reliabilities") or r.get("reliability") or ""
                s = wk[(d0, t)].setdefault(rep, {})
                if code:
                    s["code"] = code
                if pop:
                    s["pop"] = int(pop)
                if rel:
                    s["rel"] = rel
            elif r["areaCode"] == "390010" and lead == 2 and code:
                pf[(d0, t)][rep] = code
    W = {}
    for k, reps in wk.items():
        v = {}
        for rep in sorted(reps):
            s = reps[rep]
            if "code" in s and "pop" in s:
                v = {"code": s["code"], "pop": s["pop"], "rel": s.get("rel", "")}
        if v:
            W[k] = v
    P = {k: reps[max(reps)] for k, reps in pf.items()}
    return W, P


def is_rain(v):
    return v is not None and (v["code"][:1] in ("3", "4") or v["pop"] >= 50)


def wet(rain, t):
    v = rain.get(t)
    return None if v is None else v >= 1


def outcome_rainfc(rain, t):
    a, b, c = wet(rain, t - D1), wet(rain, t), wet(rain, t + D1)
    if b is None:
        return None
    if b:
        return "当たり"
    if a is None or c is None:
        return None
    if a and c:
        return "前後とも"
    if a:
        return "早まった"
    if c:
        return "遅れた"
    return "空振り"


def units(W, P, rain, per, leads=range(3, 8)):
    """雨の予報の件：{t, L, out, f: 特徴}。降らない予報で降った件：{t, L, out2}。"""
    R, M = [], []
    for t in days(*per):
        for L in leads:
            D = t - L * D1
            v = W.get((D, t))
            if v is None:
                continue
            if is_rain(v):
                o = outcome_rainfc(rain, t)
                if o is None:
                    continue
                R.append({"t": t, "L": L, "out": o, "v": v, "D": D})
            elif wet(rain, t):
                prev_r = is_rain(W.get((D, t - D1))) if L >= 2 else False
                next_r = is_rain(W.get((D, t + D1))) if L <= 6 else False
                M.append({"t": t, "L": L, "out2": "前後とも" if prev_r and next_r else ("早まった" if next_r else ("遅れた" if prev_r else "見逃し"))})
    return R, M


def features(u, W, P, texts):
    t, L, D, v = u["t"], u["L"], u["D"], u["v"]
    f = {}
    if L <= 6:
        a, c = W.get((D, t - D1)), W.get((D, t + D1))
        f["1 となりの日も中くらい"] = bool(a and c and all(30 <= x["pop"] <= 60 for x in (a, v, c)))
    if L <= 6:
        Dp = D - D1
        pt = W.get((Dp, t))
        pa = W.get((Dp, t - D1))
        pc = W.get((Dp, t + D1)) if L <= 5 else None
        moved = pt is not None and not is_rain(pt) and (is_rain(pa) or is_rain(pc))
        f["2 雨の日が動いてきた"] = moved
        if moved:
            u["move"] = "遅く" if is_rain(pa) and not is_rain(pc) else ("早く" if is_rain(pc) and not is_rain(pa) else None)
    f["3 信頼度 B・C"] = v["rel"] in ("B", "C")
    txt = texts.get(v["code"], "")
    f["5 時々・一時・のち"] = any(w in txt for w in ("時々", "一時", "後"))
    f["6 梅雨（6〜7月）"] = t.month in (6, 7)
    f["7 秋雨（9〜10月）"] = t.month in (9, 10)
    f["8 冬（12〜2月）"] = t.month in (12, 1, 2)
    return f


def f4_units(W, P, rain, per):
    R, _ = units(W, P, rain, per, leads=(2,))
    for u in R:
        c = P.get((u["D"], u["t"]))
        u["f4"] = None if c is None else c[:1] in ("1", "2")
    return [u for u in R if u["f4"] is not None]


# ---------------------------------------------------------------- 1. 外れ方
def describe(W, P, rain, texts):
    for pn, per in (("作る", TRAIN), ("確かめる", TEST), ("手前", EARLY)):
        R, M = units(W, P, rain, per)
        print(f"\n## {pn}：雨の予報の件 {len(R)}（当たり {sum(u['out'] == '当たり' for u in R)}）")
        for key, groups in (("何日前", lambda u: f"{u['L']}日前"), ("季節", lambda u: SEASON4[u["t"].month])):
            by = defaultdict(Counter)
            for u in R:
                by[groups(u)][u["out"]] += 1
            for g in sorted(by, key=lambda x: ("春夏秋冬".find(x[0]) if key == "季節" else x)):
                c = by[g]
                miss = sum(c[k] for k in SHIFT) + c["空振り"]
                sh = sum(c[k] for k in SHIFT)
                print(f"  {g}：外れ {miss}/{sum(c.values())}、うちずれ {sh}（{sh / miss * 100 if miss else float('nan'):.0f}%：早まった {c['早まった']}・遅れた {c['遅れた']}・前後とも {c['前後とも']}）、空振り {c['空振り']}")
        tot = Counter(u["out"] for u in R)
        miss = sum(tot[k] for k in SHIFT) + tot["空振り"]
        print(f"  まとめ：外れ {miss}、うちずれ {sum(tot[k] for k in SHIFT)}（{sum(tot[k] for k in SHIFT) / miss * 100:.0f}%）")
        dry = [t for t in days(*per) if wet(rain, t) is False and wet(rain, t - D1) is not None and wet(rain, t + D1) is not None]
        nb = sum(1 for t in dry if wet(rain, t - D1) or wet(rain, t + D1))
        print(f"  参考（予報と関係なく）：降らなかった日 {len(dry)} 日のうち、前か次の日に降った {nb} 日（{nb / len(dry) * 100:.0f}%）")
        byL = defaultdict(Counter)
        for m in M:
            byL[m["L"]][m["out2"]] += 1
        print("  降らない予報で降った件：" + "、".join(
            f"{L}日前 {sum(c.values())}件（ずれ {sum(c[k] for k in SHIFT)}＝{sum(c[k] for k in SHIFT) / sum(c.values()) * 100:.0f}%、見逃し {c['見逃し']}）" for L, c in sorted(byL.items())))


# ---------------------------------------------------------------- 2. 切り口
NAMES = ["1 となりの日も中くらい", "2 雨の日が動いてきた", "3 信頼度 B・C", "4 府県と週間で食い違う（2日前）",
         "5 時々・一時・のち", "6 梅雨（6〜7月）", "7 秋雨（9〜10月）", "8 冬（12〜2月）"]


def stat(name, per, W, P, rain, texts):
    if name.startswith("4"):
        R = f4_units(W, P, rain, per)
        mask = [u["f4"] for u in R]
    else:
        R, _ = units(W, P, rain, per)
        fs = [features(u, W, P, texts) for u in R]
        mask = [f.get(name) is True for f in fs]
        if name.startswith("1") or name.startswith("2"):  # 切り口がある何日前だけを母集団に
            keep = [name in f for f in fs]
            R = [u for u, k in zip(R, keep) if k]
            mask = [m for m, k in zip(mask, keep) if k]
    y = [u["out"] in SHIFT for u in R]
    n, k = sum(mask), sum(1 for m, yy in zip(mask, y) if m and yy)
    base = sum(y) / len(y)
    rate = k / n if n else float("nan")
    p = binom.sf(k - 1, n, base) if n else 1.0
    ndays = len({u["t"] for u, m in zip(R, mask) if m})
    try:
        ci = block_ratio_ci([u["t"] for u in R], mask, [int(v) for v in y]) if n and k else (float("nan"),) * 2
    except IndexError:
        ci = (float("nan"),) * 2
    share = None
    if name.startswith("2"):
        sh = [u for u, m, yy in zip(R, mask, y) if m and yy and u.get("move") and u["out"] in ("早まった", "遅れた")]
        same = sum(1 for u in sh if (u["move"], u["out"]) in (("遅く", "遅れた"), ("早く", "早まった")))
        share = (same / len(sh), len(sh)) if sh else (float("nan"), 0)
    return {"n": n, "k": k, "rate": rate, "base": base, "ratio": rate / base if base else float("nan"), "ci": ci,
            "p": p, "days": ndays, "N": len(R), "share": share}


def verdict(s, name):
    if s["days"] < PASS["minDays"]:
        return "件数が足りず判断できない"
    why = []
    if not s["ratio"] >= PASS["minRatio"]:
        why.append("倍率 1.3 未満")
    if not s["ci"][0] > PASS["ciLowAbove"]:
        why.append("幅の下の端が 1 以下")
    if name.startswith("2") and not (s["share"][0] > PASS["directionShareAbove"]):
        why.append("同じ向きが半分以下")
    return "合格" if not why else "不合格（" + "・".join(why) + "）"


def show(name, s, v):
    sh = "" if s["share"] is None else f"、動いた向きと同じ {s['share'][0] * 100:.0f}%（{s['share'][1]}件）"
    return (f"  {name}：日 {s['days']}（{s['n']}件／母集団 {s['N']}）、ずれ {s['rate'] * 100:.0f}%／ふだん {s['base'] * 100:.0f}%、"
            f"倍率 {s['ratio']:.2f}（{s['ci'][0]:.2f}〜{s['ci'][1]:.2f}）、p {s['p']:.4f}{sh} → {v}")


def train(W, P, rain, texts, out=True):
    S = {n: stat(n, TRAIN, W, P, rain, texts) for n in NAMES}
    thr = bh([S[n]["p"] for n in NAMES])
    cands = []
    for n in NAMES:
        v = verdict(S[n], n)
        bhok = S[n]["p"] <= thr
        if bhok and v == "合格":
            cands.append(n)
        if out:
            print(show(n, S[n], v) + f"、偽の発見率で{'残った' if bhok else '残らない'}")
    if out:
        print(f"\n偽の発見率の線 p ≤ {thr:.4f}。候補：{cands}")
    return cands


def confirm(W, P, rain, texts):
    cands = train(W, P, rain, texts, out=False)
    print("候補：", cands)
    for pn, per in (("確かめる", TEST), ("手前", EARLY)):
        print(f"\n## {pn}")
        for n in NAMES:
            s = stat(n, per, W, P, rain, texts)
            print(("【候補】" if n in cands else "（参考）") + show(n, s, verdict(s, n) if n in cands else "－").lstrip())


# ---------------------------------------------------------------- FS-11b：信頼度ごと
def rel_units(W, P, rain, per):
    R, _ = units(W, P, rain, per)
    return [u for u in R if u["v"]["rel"] in ("A", "B", "C")]


def rel_table(W, P, rain, per):
    R = rel_units(W, P, rain, per)
    for rel in ("A", "B", "C"):
        parts = []
        for L in list(range(3, 8)) + ["3〜7"]:
            us = [u for u in R if u["v"]["rel"] == rel and (L == "3〜7" or u["L"] == L)]
            n = len(us)
            if not n:
                parts.append(f"{L}日前 0件")
                continue
            hit = sum(u["out"] == "当たり" for u in us) / n
            sh = sum(u["out"] in SHIFT for u in us) / n
            kv = sum(u["out"] == "空振り" for u in us) / n
            parts.append(f"{L}日前 {n}件 当たり{hit * 100:.0f}%・ずれ{sh * 100:.0f}%・空振り{kv * 100:.0f}%")
        print(f"  信頼度 {rel}：" + "／".join(parts))


def rel_compare(W, P, rain, per):
    from fs10 import ratio_ci
    R = rel_units(W, P, rain, per)
    out = {}
    for name, pred in (("ずれ", lambda u: u["out"] in SHIFT), ("空振り", lambda u: u["out"] == "空振り")):
        grp, base = defaultdict(list), defaultdict(list)
        for u in R:
            (grp if u["v"]["rel"] == "C" else base)[u["t"]].append(int(pred(u)))
        n = sum(len(v) for v in grp.values())
        k = sum(sum(v) for v in grp.values())
        nb = sum(len(v) for v in base.values())
        kb = sum(sum(v) for v in base.values())
        rc, rb = (k / n if n else float("nan")), (kb / nb if nb else float("nan"))
        ci = ratio_ci(list(days(*per)), grp, base) if n and nb else (float("nan"),) * 2
        p = binom.sf(k - 1, n, rb) if n else 1.0
        out[name] = {"n": n, "k": k, "nb": nb, "kb": kb, "rc": rc, "rb": rb, "ratio": rc / rb if rb else float("nan"),
                     "ci": ci, "p": p, "days": len(grp)}
    return out


def rel_verdict(s):
    if s["days"] < PASS["minDays"]:
        return "件数が足りず判断できない"
    why = []
    if not s["ratio"] >= PASS["minRatio"]:
        why.append("倍率 1.3 未満")
    if not s["ci"][0] > PASS["ciLowAbove"]:
        why.append("幅の下の端が 1 以下")
    return "合格" if not why else "不合格（" + "・".join(why) + "）"


def rel_line(name, s, v):
    return (f"  C 対 A・B の{name}：C {s['k']}/{s['n']}（{s['rc'] * 100:.0f}%、{s['days']} 日）、A・B {s['kb']}/{s['nb']}（{s['rb'] * 100:.0f}%）、"
            f"倍率 {s['ratio']:.2f}（{s['ci'][0]:.2f}〜{s['ci'][1]:.2f}）、p {s['p']:.4f} → {v}")


def rel_train(W, P, rain, texts, out=True):
    S = rel_compare(W, P, rain, TRAIN)
    thr = bh([S[n]["p"] for n in S])
    cands = [n for n in S if S[n]["p"] <= thr and rel_verdict(S[n]) == "合格"]
    if out:
        print("## FS-11b 作る期間")
        rel_table(W, P, rain, TRAIN)
        for n in S:
            print(rel_line(n, S[n], rel_verdict(S[n])) + f"、偽の発見率で{'残った' if S[n]['p'] <= thr else '残らない'}")
        print("候補：", cands)
    return cands


def rel_confirm(W, P, rain, texts):
    cands = rel_train(W, P, rain, texts, out=False)
    print("FS-11b 候補：", cands)
    for pn, per in (("確かめる", TEST), ("手前", EARLY)):
        print(f"\n## {pn}")
        rel_table(W, P, rain, per)
        S = rel_compare(W, P, rain, per)
        for n in S:
            print(("【候補】" if n in cands else "（参考）") + rel_line(n, S[n], rel_verdict(S[n]) if n in cands else "－").lstrip())


if __name__ == "__main__":
    W, P = load(sys.argv[2])
    _, rain = load_obs_all()
    texts = code_texts(sys.argv[3])
    if sys.argv[1] == "train":
        print("## 作る期間")
    {"describe": describe, "train": train, "confirm": confirm, "rel_train": rel_train, "rel_confirm": rel_confirm}[sys.argv[1]](W, P, rain, texts)
