#!/usr/bin/env bash
# #249 WX-02: how far back each source really goes (one probe a month), and what a 日々の天気図 PDF
# holds (its pictures). Read-only; nothing is kept. 出典：気象庁ホームページ。
set -u
H=https://www.data.jma.go.jp/yoho/data
st() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1"; }
echo "## quick（実況 PNG、各月1日 9時）"
for y in $(seq 2026 -1 2010); do line="$y:"; for m in 12 11 10 09 08 07 06 05 04 03 02 01; do
  [ "$y$m" -gt "$(TZ=UTC date +%Y%m)" ] && continue
  line="$line $m=$(st "$H/wxchart/quick/$y$m/SPAS_COLOR_$y${m}010000.png")"; done; echo "$line"
  case "$line" in *=200*) ;; *) [ "$y" -lt 2024 ] && break;; esac
done
echo "## 保存用天気図（PDF、各月1日 9時）"
for y in $(seq 2026 -1 2005); do line="$y:"; for m in 12 06 01; do
  line="$line $m=$(st "$H/wxchart/archive/${y}_$m/PDFDATA/JSMAP/Js_$y${m}0100.pdf")"; done; echo "$line"
  case "$line" in *=200*) ;; *) [ "$y" -lt 2022 ] && break;; esac
done
echo "## 日々の天気図（月 PDF）"
for y in 2026 2020 2015 2010 2005 2004 2003; do yy=${y:2:2}; echo "$y: 01=$(st "$H/hibiten/$y/${yy}01.pdf") 06=$(st "$H/hibiten/$y/${yy}06.pdf")"; done
for u in https://www.data.jma.go.jp/fcd/yoho/data/hibiten/2004/0412.pdf https://www.data.jma.go.jp/fcd/yoho/hibiten/index.html https://www.data.jma.go.jp/yoho/hibiten/index.html; do echo "$u $(st $u)"; done
echo "## 日々の天気図の中身"
sudo apt-get -qq install -y poppler-utils >/dev/null 2>&1
for f in 2026/2607 2015/1506 2005/0503; do
  curl -s --max-time 60 -o h.pdf "$H/hibiten/$f.pdf"
  echo "--- $f: $(pdfinfo h.pdf 2>/dev/null | grep -E 'Pages|Page size' | tr '\n' ' ')"
  pdfimages -list h.pdf 2>/dev/null | head -8
  echo "images: $(pdfimages -list h.pdf 2>/dev/null | tail -n +3 | wc -l)"
  pdftotext -f 1 -l 1 h.pdf - 2>/dev/null | head -12
done
# One page as a picture, to look at (base64 in the log).
curl -s --max-time 60 -o h.pdf "$H/hibiten/2026/2607.pdf"
pdftoppm -f 2 -l 2 -r 60 -png h.pdf p >/dev/null 2>&1
echo "=== B64 PAGE ==="; base64 -w0 p-*.png 2>/dev/null | head -c 400000; echo; echo "=== END ==="
curl -s --max-time 60 -o j.pdf "$H/wxchart/archive/2025_01/PDFDATA/JSMAP/Js_2025011500.pdf"
pdfinfo j.pdf | grep -E 'Page size|Pages'; pdfimages -list j.pdf | head -5
