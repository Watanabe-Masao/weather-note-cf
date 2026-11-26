"""FS-02 の3：府県天気予報の臨時の修正（5時・11時・17時の定時でない発表）の傾向。

元：shiromatz/Japan-Meteorological-Agency-Weather-Forecast（CC BY-SA 4.0）の月ごとの ZIP の
forecast_YYYYMM_390000.csv（気象庁 /bosai/forecast/data/forecast/390000.json の記録）。
使い方：python3 fs02_revisions.py <forecast の ZIP があるフォルダ>
定時でない発表ごとに、その直前の発表と同じ（区域・時刻）の値を比べ、変わった項目を数える。
"""
import csv, io, os, sys, zipfile
from collections import Counter, defaultdict

FIELDS = {  # 列（2024年は単数の名前）→ 項目
    "weather": "天気（文）", "weatherCode": "天気コード", "wind": "風", "wave": "波",
    "pops": "降水確率", "pop": "降水確率", "temps": "気温", "temp": "気温",
}


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


def main(folder):
    reps = defaultdict(dict)  # 発表 → (区域, 時刻, 項目) → 値（府県天気予報の部分だけ＝週間の列が空の行）
    for fn in sorted(os.listdir(folder)):
        ym = fn[9:15]
        raw = find_csv(open(os.path.join(folder, fn), "rb").read(), f"forecast_{ym}_390000.csv")
        if raw is None:
            continue
        for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
            if any(r.get(k) for k in ("tempsMax", "tempMax", "tempsMin", "tempMin", "reliability")):
                continue  # 週間の行
            for col, item in FIELDS.items():
                v = r.get(col)
                if v:
                    reps[r["reportDatetime"]][(r["areaCode"], r["timeDefine"], item)] = v
    order = sorted(reps)
    regular = {"05", "11", "17"}
    extra = [t for t in order if t[11:13] not in regular]
    days = sorted({t[:10] for t in order})
    print(f"発表 {len(order)} 本（{order[0][:10]}〜{order[-1][:10]}、{len(days)} 日）、定時でない発表 {len(extra)} 本、その日数 {len({t[:10] for t in extra})}")
    print("時刻（時）:", dict(sorted(Counter(t[11:13] for t in extra).items())))
    by_month = Counter(int(t[5:7]) for t in extra)
    days_month = Counter(int(d[5:7]) for d in days)
    print("月ごと（本／その月の日数）:", {m: f"{by_month[m]}/{days_month[m]}" for m in range(1, 13)})
    print("1日に定時でない発表が何本:", dict(Counter(Counter(t[:10] for t in extra).values())))
    changed = Counter()
    changed_any = Counter()
    changed_day = Counter()
    nothing = 0
    examples = []
    for t in extra:
        prev = order[order.index(t) - 1]
        a, b = reps[prev], reps[t]
        diff = defaultdict(int)
        for k, v in b.items():
            if k in a and a[k] != v:
                diff[k[2]] += 1
        if not diff:
            nothing += 1
        for item in diff:
            changed[item] += 1
        for k, v in b.items():
            if k in a and a[k] != v:
                which = "今日" if k[1][:10] == t[:10] else ("明日" if k[1][:10] > t[:10] and (int(k[1][8:10]) - int(t[8:10])) % 31 == 1 else "明後日")
                changed_day[(k[2], which)] += 1
        changed_any[tuple(sorted(diff))] += 1
        if diff and len(examples) < 6 and "天気（文）" in diff:
            k = next(k for k in b if k in a and a[k] != b[k] and k[2] == "天気（文）")
            examples.append(f"{t[:16]}（前 {prev[11:16]}）{k[0]} {k[1][5:16]}：「{a[k]}」→「{b[k]}」")
    print("変わった項目（その項目が1つでも変わった発表の本数）:", dict(changed.most_common()))
    print("変わった項目の組み合わせ:", dict(changed_any.most_common(8)))
    print("変わった値の数（項目, どの日）:", dict(sorted(changed_day.items())))
    print("直前と同じ値の範囲で変化なし（時刻の重なる値が同じ）:", nothing)
    for e in examples:
        print("  例", e)


if __name__ == "__main__":
    main(sys.argv[1])
