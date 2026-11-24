"""FS-08：固定した「予報が外れやすい型」（shared/forecastTypes.ts、11/24 固定）を、まだ見ていない手前の期間
（2021-11-01〜2024-01-31）で確かめる（高知、気象庁の府県・週間天気予報だけ）。決め方は README の FS-08 の節（数える前に書いた）。

使い方：
  python3 fs08.py fetch <書き出す CSV>     最高・最低（気象庁 過去の気象データ、高知 47893）を取る。Actions で1回だけ。
                                          ログには件数・欠けの数だけを出し、URL や値の一覧は出さない。
  python3 -I fs08.py check <フォルダ>      2024-02〜2026-10 で、リポジトリの型の判定（node）と、ここの判定が同じか確かめる
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


if __name__ == "__main__" and sys.argv[1] == "fetch":
    fetch(sys.argv[2])
    sys.exit(0)
