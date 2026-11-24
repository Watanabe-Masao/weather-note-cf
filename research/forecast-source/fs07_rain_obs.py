"""FS-07（手前の期間）のための、高知 47893 の日降水量（気象庁 過去の気象データ、2021-10-25〜2024-01-31）を CSV に書くスクリプト。

取り方は fs04_rain_obs.py と同じ（daily_s1 の「降水量の合計」、「--」は降水なし＝0）。期間だけ変える。
11/24 渡辺さん OK。Actions で1回だけ動かす。出力（ログ）には件数・欠けの数だけを出し、URL や値の一覧は出さない。
使い方：python fs07_rain_obs.py <書き出す CSV>
"""
import contextlib
import io
import re
import sys
from datetime import date

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from fs01 import get  # noqa: E402  robots.txt を先に確かめる

START, END = date(2021, 10, 25), date(2024, 1, 31)


def month(y, m):
    u = f"https://www.data.jma.go.jp/obd/stats/etrn/view/daily_s1.php?prec_no=74&block_no=47893&year={y}&month={m}&day=&view="
    with contextlib.redirect_stdout(io.StringIO()):  # get が出す URL をログに出さない
        res = get(u)
    if not res:
        return None
    out = []
    for row in re.findall(r"<tr class=\"mtx\"[^>]*>(.*?)</tr>", res[0], re.S):
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if cells and cells[0].isdigit():
            v = cells[3]  # daily_s1：0日 1-2気圧 3降水量の合計
            v = "0" if v.startswith("--") else re.sub(r"[)\]#×/ ]", "", v)
            d = date(y, m, int(cells[0]))
            if START <= d <= END:
                out.append((d.isoformat(), v))
    return out


def main(path):
    rows, failed = [], 0
    y, m = START.year, START.month
    while (y, m) <= (END.year, END.month):
        r = month(y, m)
        if r is None:
            failed += 1
        else:
            rows += r
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    def num(v):
        try:
            float(v)
            return True
        except ValueError:
            return False
    blank = sum(1 for _, v in rows if not num(v))
    with open(path, "w", encoding="utf-8") as f:
        f.write("date,precip_mm\n")
        for d, v in rows:
            f.write(f"{d},{v}\n")
    days = (END - START).days + 1
    print(f"期間の日数 {days}／取れた日 {len(rows)}／値が数でない日 {blank}／取れなかった月 {failed}")


if __name__ == "__main__":
    main(sys.argv[1])
