"""FS-03：高知の日最高・日最低（気象庁 過去の気象データ、2024-02〜2026-10）を、ログに1日1行で出す（Actions で1回）。

形：OBS,日付,最高,最低。統計は手元で fs03.py が、このログの行と shiromatz の記録から計算する。
"""
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from fs01 import etrn_month  # noqa: E402  robots.txt を先に確かめる get() を使う

obs = {}
for y in (2024, 2025, 2026):
    for m in range(1, 13):
        if (y, m) < (2024, 2) or (y, m) > (2026, 10):
            continue
        obs.update(etrn_month(y, m))
for d in sorted(obs):
    mx, mn = obs[d]
    print(f"OBS,{d},{'' if mx is None else mx},{'' if mn is None else mn}")
print("OBS_DAYS", len(obs))
