"""FS-04 の 14（雨）のための、高知の日降水量（気象庁 過去の気象データ、2024-02〜2026-10）をログに出すスクリプト。

まだ動かしていない（FS-04 は「外部のサイトは新しく読まない」ため。渡辺さんの OK が出たら Actions で1回だけ動かす）。
形：RAIN,日付,降水量の合計（mm、「--」は降水なし＝0）。
"""
import re
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from fs01 import get  # noqa: E402  robots.txt を先に確かめる


def month(y, m):
    u = f"https://www.data.jma.go.jp/obd/stats/etrn/view/daily_s1.php?prec_no=74&block_no=47893&year={y}&month={m}&day=&view="
    res = get(u)
    if not res:
        return
    for row in re.findall(r"<tr class=\"mtx\"[^>]*>(.*?)</tr>", res[0], re.S):
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if cells and cells[0].isdigit():
            v = cells[3]  # daily_s1：0日 1-2気圧 3降水量の合計
            v = "0" if v.startswith("--") else re.sub(r"[)\]#×/ ]", "", v)
            print(f"RAIN,{y:04d}-{m:02d}-{int(cells[0]):02d},{v}")


for y in (2024, 2025, 2026):
    for m in range(1, 13):
        if (2024, 2) <= (y, m) <= (2026, 10):
            month(y, m)
