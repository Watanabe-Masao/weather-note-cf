# 多波長の5回（README の 3）。kochi_ref と cases.txt のあるフォルダで動かす。15 波長（375.67〜814.33 nm、31.33 nm 刻み）を
# R・G・B の枠に 3 つずつ（g0 の R＝438.33、G＝407、B＝375.67 nm …）。tools/spectral.py がこの順を前提にする。
set -e
L="375.67 407.0 438.33 469.67 501.0 532.33 563.67 595.0 626.33 657.67 689.0 720.33 751.67 783.0 814.33"
set -- $L
k=0
run() { mkdir -p spec/$1; ./kochi_ref cases.txt spec/$1 "spectral:$2,$3,$4" > spec/$1.log 2>&1; rm -f spec/$1/*.dat; }
run g0 $3 $2 $1 & run g1 $6 $5 $4 & wait
run g2 $9 $8 $7 & run g3 ${12} ${11} ${10} & wait
run g4 ${15} ${14} ${13}
echo all-done
