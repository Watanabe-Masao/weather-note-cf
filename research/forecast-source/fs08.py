"""FS-08：固定した「予報が外れやすい型」（shared/forecastTypes.ts、11/24 固定）を、まだ見ていない手前の期間
（2021-11-01〜2024-01-31）で確かめる（高知、気象庁の府県・週間天気予報だけ）。決め方は README の FS-08 の節（数える前に書いた）。

使い方：
  python3 fs08.py fetch <書き出す CSV>     最高・最低（気象庁 過去の気象データ、高知 47893）を取る。Actions で1回だけ。
                                          ログには件数・欠けの数だけを出し、URL や値の一覧は出さない。
  python3 -I fs08.py check <フォルダ> <main の shared>  2024-02〜2026-10 で、リポジトリの型の判定（node）と、ここの判定が同じか確かめる
  python3 -I fs08.py run <フォルダ>        手前の期間で1回だけ数える（前の期間の値も並べる）
"""
import contextlib
import io
import os
import sys
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

EARLY = (date(2021, 11, 1), date(2024, 1, 31))
TRAIN = (date(2024, 2, 1), date(2025, 10, 31))
TEST = (date(2025, 11, 1), date(2026, 10, 31))


def months(a, b):
    y, m = a.year, a.month
    while (y, m) <= (b.year, b.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def fetch(path):
    from fs01 import etrn_month  # robots.txt を先に確かめる get() を使う
    obs, failed = {}, 0
    for y, m in months(*EARLY):
        with contextlib.redirect_stdout(io.StringIO()):  # URL をログに出さない
            r = etrn_month(y, m)
        if not r:
            failed += 1
        obs.update({d: v for d, v in r.items() if EARLY[0] <= d <= EARLY[1]})
    with open(path, "w", encoding="utf-8") as f:
        f.write("date,max,min\n")
        for d in sorted(obs):
            mx, mn = obs[d]
            f.write(f"{d.isoformat()},{'' if mx is None else mx},{'' if mn is None else mn}\n")
    n = (EARLY[1] - EARLY[0]).days + 1
    print(f"期間の日数 {n}／取れた日 {len(obs)}／最高の欠け {sum(1 for v in obs.values() if v[0] is None)}"
          f"／最低の欠け {sum(1 for v in obs.values() if v[1] is None)}／取れなかった月 {failed}")


# ---------------------------------------------------------------- 型（shared/forecastTypes.ts を、そのまま書き写したもの）
# 書き写しが同じかは check で、リポジトリの match を node で動かして全部の件で比べる。
TYPES = [  # id, 項目, 何日前, 向き, FS-05 の全期間の倍率（固定した期待）
    ("A-min-raised-L1", "min", (1,), "low", 2.63),
    ("B-max-rain-L2-3", "max", (2, 3), "low", 1.73),
    ("B-max-rain-L4-7", "max", (4, 5, 6, 7), None, 1.56),
    ("G-rain-summer-cloudy-L2-3", "rainMiss", (2, 3), None, 2.94),
    ("G-rain-summer-cloudy-L4-7", "rainMiss", (4, 5, 6, 7), None, 1.97),
    ("E-min-turning-drop-L4-7", "min", (4, 5, 6, 7), "high", 1.98),
    ("C-max-moved-L2-3", "max", (2, 3), None, 1.67),
    ("C-max-moved-L4-6", "max", (4, 5, 6), None, 1.59),
    ("W-max-autumn-falling-L1-3", "max", (1, 2, 3), None, 2.04),
]
PASS = {"minRatio": 1.3, "ciLowAbove": 1, "minDays": 20, "directionShareAbove": 0.5}


def lookup(folder):
    """(対象日, 何日前) → {max, min, pop, wx}。気温は fs03.load_forecasts、降水確率・天気は fs04_season.load_wx_pop。"""
    from fs03 import load_forecasts
    from fs04_season import load_wx_pop
    fc, wp = load_forecasts(folder), load_wx_pop(folder)
    out = {}
    for k in set(fc) | set(wp):
        v = {}
        for key in ("max", "min"):
            if fc.get(k, {}).get(key) is not None:
                v[key] = fc[k][key]
        for key in ("pop", "wx"):
            if wp.get(k, {}).get(key) is not None:
                v[key] = wp[k][key]
        if v:
            out[k] = v
    return out


def seq(t, L, fc, k):
    if L > 6:
        return None
    s = []
    for l in range(L, 8):
        v = fc.get((t, l), {}).get(k)
        if v is None:
            return None
        s.append(v)
    return s


def day_change(t, L, fc, k):
    a = fc.get((t, L), {}).get(k)
    b = fc.get((t - timedelta(days=1), max(L - 1, 1)), {}).get(k)
    return None if a is None or b is None else a - b


def summer_cloudy(t, f):
    return t.month in (6, 7, 8) and f.get("pop") is not None and 30 <= f["pop"] <= 40 and f.get("wx") == "くもり"


def moved(t, L, fc):
    s = seq(t, L, fc, "max")
    if not s:
        return False
    d = abs(s[0] - s[1])
    return 1 < d <= 3


def match(tid, t, L, fc):
    f = fc.get((t, L), {})
    if tid == "A-min-raised-L1":
        s = seq(t, L, fc, "min")
        return bool(s) and s[0] - s[-1] >= 2
    if tid == "B-max-rain-L2-3":
        return f.get("pop") is not None and f["pop"] >= 50
    if tid == "B-max-rain-L4-7":
        return f.get("pop") is not None and 50 <= f["pop"] <= 60
    if tid.startswith("G-"):
        return summer_cloudy(t, f)
    if tid == "E-min-turning-drop-L4-7":
        if t.month not in (3, 4, 10, 11):
            return False
        d = day_change(t, L, fc, "min")
        return d is not None and -4 < d <= -2
    if tid.startswith("C-"):
        return moved(t, L, fc)
    if tid == "W-max-autumn-falling-L1-3":
        if t.month not in (8, 9, 10, 11):
            return False
        s = seq(t, L, fc, "max")
        if not s:
            return False
        if any(s[i] > s[i + 1] for i in range(len(s) - 1)):
            return False
        return s[0] - s[-1] <= -2
    raise KeyError(tid)


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


# ---------------------------------------------------------------- 使う前の確かめ（リポジトリの match と同じか）
def check(folder, shared_dir):
    """2024-02〜2026-10 の全部の（対象日・何日前）で、TS の match（node、tsx）と、ここの match を比べる。"""
    import json, subprocess, tempfile
    fc = lookup(folder)
    a, b = date(2024, 2, 1), date(2026, 10, 31)
    data = {f"{t.isoformat()}|{L}": v for (t, L), v in fc.items() if a - timedelta(days=2) <= t <= b}
    with tempfile.TemporaryDirectory() as td:
        jp = os.path.join(td, "fc.json")
        json.dump(data, open(jp, "w", encoding="utf-8"), ensure_ascii=False)
        js = os.path.join(td, "run.ts")
        open(js, "w").write(f"""
import {{ readFileSync }} from "node:fs";
import {{ FORECAST_TYPES }} from "{shared_dir}/forecastTypes";
const data = JSON.parse(readFileSync("{jp}", "utf8"));
const fc = (t: string, L: number) => data[`${{t}}|${{L}}`];
const out: string[] = [];
for (let d = Date.parse("{a}T00:00:00Z"); d <= Date.parse("{b}T00:00:00Z"); d += 86400000) {{
  const t = new Date(d).toISOString().slice(0, 10);
  for (const ty of FORECAST_TYPES) for (const L of ty.leads) if (ty.match(t, L, fc)) out.push(`${{ty.id}}|${{t}}|${{L}}`);
}}
console.log(JSON.stringify(out));
""")
        res = subprocess.run(["npx", "--yes", "tsx", js], capture_output=True, text=True, cwd=td)
        if res.returncode:
            print(res.stderr[-2000:])
            raise SystemExit("node で動かせなかった")
        ts = set(json.loads(res.stdout.strip().splitlines()[-1]))
    py = {f"{tid}|{t.isoformat()}|{L}" for tid, _, leads, _, _ in TYPES for t in days(a, b) for L in leads if match(tid, t, L, fc)}
    ids = [x[0] for x in TYPES]
    if set(ty.split("|")[0] for ty in ts) - set(ids):
        print("リポジトリにある型が、ここに無い：", set(ty.split("|")[0] for ty in ts) - set(ids))
    for tid in ids:
        a1 = {x for x in ts if x.startswith(tid + "|")}
        b1 = {x for x in py if x.startswith(tid + "|")}
        print(f"{tid}：リポジトリ {len(a1)} 件／ここ {len(b1)} 件／違い {len(a1 ^ b1)}")
    print("全部同じ" if ts == py else f"違いあり：{len(ts ^ py)} 件（例 {sorted(ts ^ py)[:5]}）")
    return ts == py


# ---------------------------------------------------------------- 数える
def load_obs_all():
    from fs03 import load_obs
    from fs04_rain import load_rain
    from fs07 import load_early_rain
    obs = load_obs()
    with open(os.path.join(HERE, "fs08_obs_47893_early.csv"), encoding="utf-8") as f:
        next(f)
        for line in f:
            d, mx, mn = line.strip().split(",")
            obs[date.fromisoformat(d)] = {"max": float(mx) if mx else None, "min": float(mn) if mn else None}
    rain = dict(load_rain())
    rain.update(load_early_rain())
    return obs, rain


def cases(tid, item, leads, period, fc, obs, rain):
    out = []
    for t in days(*period):
        for L in leads:
            f = fc.get((t, L), {})
            if item == "rainMiss":
                if f.get("pop") is None or rain.get(t) is None or f["pop"] >= 50:
                    continue
                y, e = rain[t] >= 1, None
            else:
                o = (obs.get(t) or {}).get(item)
                if f.get(item) is None or o is None:
                    continue
                e = f[item] - o
                y = abs(e) > 2
            out.append({"t": t, "L": L, "y": y, "e": e, "in": match(tid, t, L, fc)})
    return out


def summarize(tid, item, leads, direction, period, fc, obs, rain):
    from fs05 import block_ratio_ci
    cs = cases(tid, item, leads, period, fc, obs, rain)
    inr = [c for c in cs if c["in"]]
    mdays = len({c["t"] for c in inr})
    base = sum(c["y"] for c in cs) / len(cs) if cs else float("nan")
    hit = sum(c["y"] for c in inr) / len(inr) if inr else float("nan")
    ratio = hit / base if inr and base else float("nan")
    ci = (float("nan"), float("nan"))
    if inr and sum(c["y"] for c in inr):
        try:
            ci = block_ratio_ci([c["t"] for c in cs], [c["in"] for c in cs], [int(c["y"]) for c in cs])
        except IndexError:
            pass
    share = None
    if direction:
        miss = [c for c in inr if c["y"]]
        if miss:
            share = sum(1 for c in miss if (c["e"] > 0 if direction == "low" else c["e"] < 0)) / len(miss)
    if mdays < PASS["minDays"]:
        verdict = "件数が足りず判断できない"
    else:
        why = []
        if not ratio >= PASS["minRatio"]:
            why.append("倍率 1.3 未満")
        if not ci[0] > PASS["ciLowAbove"]:
            why.append("幅の下の端が 1 以下")
        if direction and not (share is not None and share > PASS["directionShareAbove"]):
            why.append("同じ向きが半分以下")
        verdict = "合格" if not why else "不合格（" + "・".join(why) + "）"
    return {"件": len(inr), "対象日": mdays, "大外れ": hit, "ふだん": base, "倍率": ratio, "幅": ci, "向き": share, "判定": verdict, "全件": len(cs)}


def calib(fc, rain, period):
    bands = [("0%", 0, 0), ("10%", 10, 10), ("20%", 20, 20), ("30%", 30, 30), ("40%", 40, 40), ("50%", 50, 50), ("60〜70%", 60, 70), ("80〜100%", 80, 100)]
    out = []
    for name, lo, hi in bands:
        ys = [rain[t] >= 1 for t in days(*period) for L in range(1, 8)
              if fc.get((t, L), {}).get("pop") is not None and lo <= fc[(t, L)]["pop"] <= hi and rain.get(t) is not None]
        out.append((name, sum(ys) / len(ys) if ys else float("nan"), len(ys)))
    return out


def run(folder):
    fc = lookup(folder)
    obs, rain = load_obs_all()
    periods = (("手前", EARLY), ("作る", TRAIN), ("確かめる", TEST))
    for tid, item, leads, direction, exp in TYPES:
        print(f"\n## {tid}（項目 {item}、何日前 {leads}、向き {direction}、固定した期待の倍率 {exp}）")
        for pn, per in periods:
            r = summarize(tid, item, leads, direction, per, fc, obs, rain)
            sh = "" if r["向き"] is None else f"、向き {r['向き'] * 100:.0f}%"
            print(f"  {pn}：対象日 {r['対象日']}（{r['件']}件／全 {r['全件']}件）、大外れ {r['大外れ'] * 100:.0f}%、ふだん {r['ふだん'] * 100:.0f}%、"
                  f"倍率 {r['倍率']:.2f}（{r['幅'][0]:.2f}〜{r['幅'][1]:.2f}）{sh} → {r['判定']}")
    print("\n## 降水確率の読み方（1〜7日前まとめ、実際に降った割合（件数））")
    for pn, per in (("手前", EARLY), ("前の期間（2024-02〜2026-10）", (TRAIN[0], TEST[1]))):
        print(" ", pn, "  ".join(f"{n} {v * 100:.0f}%（{c}）" for n, v, c in calib(fc, rain, per)))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "fetch":
        fetch(sys.argv[2])
    elif cmd == "check":
        sys.exit(0 if check(sys.argv[2], sys.argv[3]) else 1)
    elif cmd == "run":
        run(sys.argv[2])
