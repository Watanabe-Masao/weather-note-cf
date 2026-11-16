#!/usr/bin/env bash
# #249 天気図の調査 (WX-01): what JMA serves, from where, how far back, in which form. Read-only;
# nothing is kept beyond this run's artifact (a few sample files). 出典：気象庁ホームページ。
set -u
out=${GITHUB_STEP_SUMMARY:-/dev/stdout}
mkdir -p samples
head_of() { curl -s -o /dev/null -L -w '%{http_code} %{content_type} %{size_download}' --max-time 30 "$1"; }
row() { echo "| \`$1\` | $(head_of "$1") |" >> "$out"; }
jst() { TZ=Asia/Tokyo date -d "$1" +"$2"; }
Q=https://www.data.jma.go.jp/fcd/yoho/data/wxchart/quick
Q2=https://www.data.jma.go.jp/yoho/data/wxchart/quick
D=$(jst "yesterday" +%Y%m%d); M=$(jst "yesterday" +%Y%m)
{
echo "# WX-01 天気図の調査（$(TZ=Asia/Tokyo date '+%F %R') JST）"
echo
echo "## 1. 実況天気図（quick）: 名前の時刻は JST か UTC か・形式"
echo "| URL | status type bytes |"; echo "|---|---|"
} >> "$out"
for base in $Q $Q2; do
  for hh in 09 00 12 21; do
    for ext in png svgz pdf; do row "$base/$M/SPAS_COLOR_${D}${hh}0000.$ext"; done
  done
  row "$base/$M/ASAS_COLOR_${D}090000.png"
  row "$base/$M/SPAS_MONO_${D}090000.png"
done
{ echo; echo "## 2. 実況天気図はどこまで遡れるか（各月1日 09 と 00）"; echo "| URL | status type bytes |"; echo "|---|---|"; } >> "$out"
for k in 0 1 2 3 4 5 6 8 12; do
  d=$(jst "$(TZ=Asia/Tokyo date +%Y-%m-01) -$k month" +%Y%m%d); m=${d:0:6}
  for hh in 09 00; do row "$Q/$m/SPAS_COLOR_${d}${hh}0000.png"; done
done
{ echo; echo "## 3. 保存用天気図（PDF）と日々の天気図（PDF）"; echo "| URL | status type bytes |"; echo "|---|---|"; } >> "$out"
for ym in 2026_08 2026_07 2025_08 2025_01 2024_06; do y=${ym:0:4}; m=${ym:5:2}
  row "https://www.data.jma.go.jp/yoho/data/wxchart/archive/$ym/PDFDATA/JSMAP/Js_${y}${m}0100.pdf"; done
for ym in 2610 2609 2608 2607 2512 0503; do y=20${ym:0:2}
  row "https://www.data.jma.go.jp/yoho/data/hibiten/$y/$ym.pdf"; done
{ echo; echo "## 4. 防災情報の天気図ページ（予想天気図を含む）"; } >> "$out"
for u in https://www.jma.go.jp/bosai/weather_map/data/list.json https://www.jma.go.jp/bosai/weather_map/; do
  echo "- \`$u\`: $(head_of "$u")" >> "$out"
done
curl -s --max-time 30 https://www.jma.go.jp/bosai/weather_map/data/list.json -o samples/list.json
if [ -s samples/list.json ]; then
  { echo; echo '```'; head -c 2500 samples/list.json; echo; echo '```'; } >> "$out"
fi
{ echo; echo "## 5. 過去の実況天気図ページの中の参照（quick）"; echo '```'; } >> "$out"
curl -s --max-time 30 https://www.data.jma.go.jp/yoho/wxchart/quickdaily.html | grep -oE '[^"'"'"' ]*(wxchart|quick|SPAS|ASAS|\.js)[^"'"'"' ]*' | sort -u | head -40 >> "$out"
for js in $(curl -s --max-time 30 https://www.data.jma.go.jp/yoho/wxchart/quickdaily.html | grep -oE 'src="[^"]+\.js"' | sed 's/src="//;s/"//'); do
  case "$js" in http*) u=$js;; /*) u=https://www.data.jma.go.jp$js;; *) u=https://www.data.jma.go.jp/yoho/wxchart/$js;; esac
  echo "--- $u" >> "$out"; curl -s --max-time 30 "$u" | grep -oE '.{0,80}(SPAS|ASAS|quick|COLOR|MONO).{0,80}' | head -15 >> "$out"
done
echo '```' >> "$out"
# A few samples to look at.
for f in "$Q/$M/SPAS_COLOR_${D}090000.png" "$Q2/$M/SPAS_COLOR_${D}090000.png" "$Q/$M/SPAS_COLOR_${D}000000.png"; do
  curl -s -L --max-time 30 -o "samples/$(echo "$f" | md5sum | cut -c1-6)-$(basename "$f")" "$f"
done
curl -s -L --max-time 60 -o samples/Js_2026070100.pdf "https://www.data.jma.go.jp/yoho/data/wxchart/archive/2026_07/PDFDATA/JSMAP/Js_2026070100.pdf"
ls -la samples >> "$out"
