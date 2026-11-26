"""FS-10：雨の予報が外れた日の、その日と、その先の気温の予報の外れ方（高知、気象庁の府県・週間天気予報だけ）。

決め方は README の FS-10 の節（数える前に書いた）。材料は手元にあるものだけ。
使い方：
  python3 -I fs10.py train <フォルダ>     作る期間（2024-02〜2025-10）で、前日・当日の両方を数えて、1つと候補を決める
  python3 -I fs10.py confirm <フォルダ>   決めた方の候補を、確かめる期間と手前の期間で、それぞれ1回だけ数える
  python3 -I fs10.py train_b / confirm_b <フォルダ>   FS-10b（晴れ・くもりの予報＝番号の頭 1・2 で降った日）
  python3 -I fs10.py c <フォルダ>         FS-10c（雨の空振りの日は外れにくいか）
"""
import csv, io, math, os, random, sys
from collections import defaultdict
from datetime import date, timedelta

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fs03 import find_csv, load_forecasts  # noqa: E402
from fs08 import EARLY, TEST, TRAIN, days, load_obs_all  # noqa: E402

PASS = {"minRatio": 1.3, "ciLowAbove": 1, "minDays": 20, "directionShareAbove": 0.5}
GROUPS = (("雨の空振り", True, False), ("晴れ・くもりの見逃し", False, True))  # 名前, 雨の予報か, 降ったか
ITEMS_SAME = (("その日の最高", "max", 0), ("その日の最低", "min", 0))
ITEMS_NEXT = tuple((f"{k}日後の{n}", key, k) for k in (1, 2, 3) for n, key in (("最高", "max"), ("最低", "min")))
D = timedelta(days=1)


def load_rain_fc(folder):
    """{"前日": {t: {wx, pop}}, "当日": {t: {wx, pop, max}}}。"""
    reps = defaultdict(lambda: defaultdict(dict))  # (種類, t) -> rep -> {wx, pops[], max}
    for fn in sorted(os.listdir(folder)):
        ym = fn[9:15]
        raw = find_csv(open(os.path.join(folder, fn), "rb").read(), f"forecast_{ym}_390000.csv")
        if raw is None:
            continue
        for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
            rep, td = r["reportDatetime"], r["timeDefine"]
            d0, t = date.fromisoformat(rep[:10]), date.fromisoformat(td[:10])
            if t == d0 + D:
                kind = "前日"
            elif t == d0 and int(rep[11:13]) < 11:
                kind = "当日"
            else:
                continue
            s = reps[(kind, t)][rep]
            s.setdefault("pops", [])
            if r["areaCode"] == "390010":
                wx = r.get("weathers") or r.get("weather") or ""
                if wx:
                    s["wx"] = wx
                    s["code"] = r.get("weatherCodes") or r.get("weatherCode") or ""
                pop = r.get("pops") or r.get("pop") or ""
                if pop and td[11:13] in ("00", "06", "12", "18"):
                    s["pops"].append(int(pop))
            elif r["areaCode"] == "74182" and kind == "当日" and td[11:13] == "09":
                v = r.get("temps") or r.get("temp") or ""
                if v:
                    s["max"] = float(v)
    out = {"前日": {}, "当日": {}}
    for (kind, t), rs in reps.items():
        v = {}
        for rep in sorted(rs):  # 遅い発表で上書き（値のあるもの）
            s = rs[rep]
            if s.get("wx") and len(s["pops"]) >= 3:
                v["wx"], v["pop"], v["code"] = s["wx"], max(s["pops"]), s.get("code", "")
            if "max" in s:
                v["max"] = s["max"]
        if "wx" in v:
            out[kind][t] = v
    return out


def is_rain_fc(v):
    return ("雨" in v["wx"] or "雪" in v["wx"]) or v["pop"] >= 50


def is_rain_fc_b(v):
    """FS-10b：天気の番号の頭が 3・4、または降水確率 50% 以上。"""
    return v["code"][:1] in ("3", "4") or v["pop"] >= 50


def g_day(t, v):
    """FS-10b で除く、型 G の条件に当たる日（6〜8月、番号の頭が 2、降水確率 30〜40%）。"""
    return t.month in (6, 7, 8) and v["code"][:1] == "2" and 30 <= v["pop"] <= 40


def build(folder):
    rfc = load_rain_fc(folder)
    fc = load_forecasts(folder)
    obs, rain = load_obs_all()
    return rfc, fc, obs, rain


def item_cases(kind, item, per, rfc, fc, obs):
    """（対象日 t、予報、実際）。t はその日（雨の予報の対象日）。"""
    name, key, k = item
    out = []
    for t in days(*per):
        if k == 0:
            if kind == "前日":
                f = fc.get((t, 1), {}).get(key)
            else:
                f = rfc["当日"].get(t, {}).get("max") if key == "max" else None
            o = (obs.get(t) or {}).get(key)
        else:
            f = fc.get((t + k * D, k), {}).get(key)
            o = (obs.get(t + k * D) or {}).get(key)
        if f is not None and o is not None:
            out.append((t, o - f))
    return out


def ratio_ci(cal, grp, base, block=7, B=2000, seed=5):
    """grp, base：{t: [大外れ 0/1]}。暦日のブロックで両方を一緒に選び直し、（grp の割合）/（base の割合）の 95% の幅。"""
    rnd = random.Random(seed)
    n = len(cal)
    res = []
    for _ in range(B):
        a = b = c = d = 0
        for _ in range(math.ceil(n / block)):
            i = rnd.randrange(0, n - block + 1)
            for t in cal[i:i + block]:
                for y in grp.get(t, ()):
                    a += 1
                    b += y
                for y in base.get(t, ()):
                    c += 1
                    d += y
        if a and c and d:
            res.append((b / a) / (d / c))
    res.sort()
    if len(res) < 100:
        return float("nan"), float("nan")
    return res[int(0.025 * len(res))], res[int(0.975 * len(res))]


def evaluate(kind, group, item, per, data, direction=None, rule=is_rain_fc, exclude=None):
    rfc, fc, obs, rain = data
    gname, g_rainfc, g_rained = group
    cs = item_cases(kind, item, per, rfc, fc, obs)
    grp, base, alld = defaultdict(list), defaultdict(list), defaultdict(list)
    gr, br = [], []
    for t, r in cs:
        v = rfc[kind].get(t)
        if v is None or rain.get(t) is None or not v.get("code", "x")[:1].isdigit() and rule is is_rain_fc_b:
            continue
        if exclude and exclude(t, v):
            continue
        rf, rd = rule(v), rain[t] >= 1
        y = int(abs(r) > 2)
        alld[t].append(y)
        if rf == g_rainfc and rd == g_rained:
            grp[t].append(y)
            gr.append(r)
        elif rf == g_rainfc and rd != g_rained:
            base[t].append(y)
            br.append(r)
    ng, nb = len(gr), len(br)
    rg = sum(abs(x) > 2 for x in gr) / ng if ng else float("nan")
    rb = sum(abs(x) > 2 for x in br) / nb if nb else float("nan")
    ra = sum(sum(v) for v in alld.values()) / max(1, sum(len(v) for v in alld.values()))
    ratio = rg / rb if ng and nb and rb else float("nan")
    ci = ratio_ci(list(days(*per)), grp, base) if ng and nb else (float("nan"), float("nan"))
    miss = [x for x in gr if abs(x) > 2]
    hi = sum(1 for x in miss if x > 0) / len(miss) if miss else float("nan")
    q = (float(np.median(gr)), float(np.quantile(gr, 0.1)), float(np.quantile(gr, 0.9))) if ng else (float("nan"),) * 3
    qb = (float(np.median(br)), float(np.quantile(br, 0.1)), float(np.quantile(br, 0.9))) if nb else (float("nan"),) * 3
    ndays = len(grp)
    if ndays < PASS["minDays"]:
        verdict = "件数が足りず判断できない"
    else:
        why = []
        if not ratio >= PASS["minRatio"]:
            why.append("倍率 1.3 未満")
        if not ci[0] > PASS["ciLowAbove"]:
            why.append("幅の下の端が 1 以下")
        if direction:
            share = hi if direction == "高い" else 1 - hi
            if not share > PASS["directionShareAbove"]:
                why.append("同じ向きが半分以下")
        verdict = "合格" if not why else "不合格（" + "・".join(why) + "）"
    return {"日": ndays, "件": ng, "大外れ": rg, "ふだん": rb, "全部": ra, "倍率": ratio, "全部との倍率": rg / ra if ra else float("nan"),
            "幅": ci, "高い": hi, "大外れ件": len(miss), "q": q, "qb": qb, "判定": verdict}


def decide_direction(res):
    if res["大外れ件"] >= 20 and res["高い"] == res["高い"]:
        if res["高い"] >= 0.6:
            return "高い"
        if 1 - res["高い"] >= 0.6:
            return "低い"
    return None


def line(gname, iname, r, direction):
    d = "" if r["高い"] != r["高い"] else f"、大外れの向き 実際が高い {r['高い'] * 100:.0f}%（{r['大外れ件']}件）"
    return (f"  {gname}｜{iname}：日 {r['日']}、大外れ {r['大外れ'] * 100:.0f}%／ふだん {r['ふだん'] * 100:.0f}%（全部 {r['全部'] * 100:.0f}%）、"
            f"倍率 {r['倍率']:.2f}（{r['幅'][0]:.2f}〜{r['幅'][1]:.2f}）・全部との倍率 {r['全部との倍率']:.2f}、"
            f"実際−予報 {r['q'][0]:+.1f}（{r['q'][1]:+.1f}〜{r['q'][2]:+.1f}）／ふだん {r['qb'][0]:+.1f}（{r['qb'][1]:+.1f}〜{r['qb'][2]:+.1f}）{d}"
            f"、向き {direction or '決まらない'} → {r['判定']}")


def items_for(kind):
    return (ITEMS_SAME if kind == "前日" else ITEMS_SAME[:1]) + ITEMS_NEXT


def train(data, show=True):
    score, cands = {}, {}
    for kind in ("前日", "当日"):
        score[kind], cands[kind] = 0, []
        if show:
            print(f"\n## 作る期間・{kind}の予報（予報のある日 {sum(1 for t in days(*TRAIN) if t in data[0][kind])} 日、雨の予報 {sum(1 for t in days(*TRAIN) if t in data[0][kind] and is_rain_fc(data[0][kind][t]))} 日）")
        for g in GROUPS:
            for it in items_for(kind):
                r = evaluate(kind, g, it, TRAIN, data)
                dr = decide_direction(r)
                if dr:
                    r = evaluate(kind, g, it, TRAIN, data, dr)
                if show:
                    print(line(g[0], it[0], r, dr))
                if r["判定"] == "合格":
                    cands[kind].append((g, it, dr))
                    if it[0] != "その日の最低":
                        score[kind] += 1
    choice = "当日" if score["当日"] > score["前日"] else "前日"
    if show:
        print(f"\n共通の 14 での合格の数：前日 {score['前日']}・当日 {score['当日']} → {choice}の予報に決める")
        print("候補：", [(g[0], it[0], dr) for g, it, dr in cands[choice]])
    return choice, cands[choice]


def confirm(data):
    choice, cands = train(data, show=False)
    print(f"決めた材料：{choice}の予報。候補 {len(cands)} 個")
    keys = {(g[0], it[0]) for g, it, _ in cands}
    for pn, per in (("確かめる", TEST), ("手前", EARLY)):
        print(f"\n## {pn}の期間（予報のある日 {sum(1 for t in days(*per) if t in data[0][choice])} 日、雨の予報 {sum(1 for t in days(*per) if t in data[0][choice] and is_rain_fc(data[0][choice][t]))} 日）")
        for g in GROUPS:
            for it in items_for(choice):
                dr = next((d for gg, ii, d in cands if gg == g and ii == it), None)
                r = evaluate(choice, g, it, per, data, dr)
                tag = "【候補】" if (g[0], it[0]) in keys else "（参考）"
                if tag == "（参考）":
                    r["判定"] = "－"
                print(tag + line(g[0], it[0], r, dr).lstrip())


# ---------------------------------------------------------------- FS-10b：晴れ・くもりの予報（番号の頭 1・2）で降った日
MISS_B = ("晴れ・くもりの見逃し", False, True)


def train_b(data, show=True):
    score, cands = {}, {}
    for kind in ("前日", "当日"):
        score[kind], cands[kind] = 0, []
        n_sun = sum(1 for t in days(*TRAIN) if t in data[0][kind] and not is_rain_fc_b(data[0][kind][t]))
        n_miss = sum(1 for t in days(*TRAIN) if t in data[0][kind] and not is_rain_fc_b(data[0][kind][t]) and (data[3].get(t) or 0) >= 1)
        if show:
            print(f"\n## FS-10b 作る期間・{kind}の予報（晴れ・くもりの予報 {n_sun} 日、うち降った {n_miss} 日）")
        for it in items_for(kind):
            r = evaluate(kind, MISS_B, it, TRAIN, data, rule=is_rain_fc_b)
            dr = decide_direction(r)
            if dr:
                r = evaluate(kind, MISS_B, it, TRAIN, data, dr, rule=is_rain_fc_b)
            if show:
                print(line(MISS_B[0], it[0], r, dr))
                rx = evaluate(kind, MISS_B, it, TRAIN, data, dr, rule=is_rain_fc_b, exclude=g_day)
                print("    G の日を除く：" + line(MISS_B[0], it[0], rx, dr).split("：", 1)[1])
            if r["判定"] == "合格":
                cands[kind].append((it, dr))
                if it[0] != "その日の最低":
                    score[kind] += 1
    choice = "当日" if score["当日"] > score["前日"] else "前日"
    if show:
        print(f"\n共通の 7 での合格の数：前日 {score['前日']}・当日 {score['当日']} → {choice}の予報に決める")
        print("候補：", [(it[0], dr) for it, dr in cands[choice]])
    return choice, cands[choice]


def confirm_b(data):
    choice, cands = train_b(data, show=False)
    print(f"FS-10b 決めた材料：{choice}の予報。候補 {len(cands)} 個")
    keys = {it[0] for it, _ in cands}
    for pn, per in (("確かめる", TEST), ("手前", EARLY)):
        print(f"\n## {pn}の期間")
        for it in items_for(choice):
            dr = next((d for ii, d in cands if ii == it), None)
            for label, ex in (("", None), ("G の日を除く ", g_day)):
                r = evaluate(choice, MISS_B, it, per, data, dr, rule=is_rain_fc_b, exclude=ex)
                tag = "【候補】" if it[0] in keys and not ex else "（参考）"
                if tag == "（参考）":
                    r["判定"] = "－"
                print(tag + label + line(MISS_B[0], it[0], r, dr).lstrip())


# ---------------------------------------------------------------- FS-10c：雨の空振りの日は外れにくいか
def run_c(data):
    g = GROUPS[0]
    for pn, per in (("作る", TRAIN), ("確かめる", TEST), ("手前", EARLY)):
        for it in ITEMS_SAME:
            r = evaluate("前日", g, it, per, data)
            if r["日"] < 20:
                v = "件数が足りず判断できない"
            else:
                v = "外れにくいと言える" if r["倍率"] <= 1 / 1.3 and r["幅"][1] < 1 else "外れにくいとは言えない"
            print(f"{pn}｜{it[0]}：日 {r['日']}、大外れ {r['大外れ'] * 100:.0f}%／雨が当たった日 {r['ふだん'] * 100:.0f}%、"
                  f"倍率 {r['倍率']:.2f}（{r['幅'][0]:.2f}〜{r['幅'][1]:.2f}） → {v}")


if __name__ == "__main__":
    data = build(sys.argv[2])
    {"train": train, "confirm": confirm, "train_b": train_b, "confirm_b": confirm_b, "c": run_c}[sys.argv[1]](data)
