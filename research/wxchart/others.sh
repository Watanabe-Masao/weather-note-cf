#!/usr/bin/env bash
# #249 WX-03: JMA's other maps (雲・雨雲・推計・分布予報 …): how far back each one keeps, from their
# targetTimes lists. Read-only. 出典：気象庁ホームページ。
set -u
B=https://www.jma.go.jp/bosai
show() { # name url
  local j; j=$(curl -s --max-time 30 "$2")
  if [ -z "$j" ] || [ "${j:0:1}" != "[" ] && [ "${j:0:1}" != "{" ]; then echo "- $1: $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$2") $2"; return; fi
  python3 - "$1" "$2" <<PY
import json,sys
d=json.loads('''$j''')
rows=d if isinstance(d,list) else d.get("data",d)
if isinstance(rows,dict): print("-",sys.argv[1],"keys",list(rows)[:8]); sys.exit()
bt=sorted({r.get("basetime") for r in rows if isinstance(r,dict)}); vt=sorted({r.get("validtime") for r in rows if isinstance(r,dict)})
els=sorted({str(r.get("elements",r.get("member","")))[:60] for r in rows if isinstance(r,dict)})[:4]
print(f"- {sys.argv[1]}: {len(rows)} 件, basetime {bt[0] if bt else None} 〜 {bt[-1] if bt else None}, validtime {vt[0] if vt else None} 〜 {vt[-1] if vt else None}, elements {els}")
PY
}
echo "## WX-03（$(TZ=Asia/Tokyo date '+%F %R') JST）"
show "ひまわり 全球" $B/himawari/data/satimg/targetTimes_fd.json
show "ひまわり 日本域" $B/himawari/data/satimg/targetTimes_jp.json
show "雨雲の動き N1（実況）" $B/jmatile/data/nowc/targetTimes_N1.json
show "雨雲の動き N2（予測）" $B/jmatile/data/nowc/targetTimes_N2.json
show "雨雲の動き N3" $B/jmatile/data/nowc/targetTimes_N3.json
show "今後の雨（解析雨量・降水短時間予報）" $B/jmatile/data/rasrf/targetTimes.json
show "推計気象分布" $B/jmatile/data/wdist/targetTimes.json
show "推計気象分布2" $B/suikei/data/targetTimes.json
show "天気分布予報" $B/wdist/data/targetTimes.json
show "今後の雪" $B/jmatile/data/snow/targetTimes.json
show "線状降水帯予測" $B/jmatile/data/sjfcstmap/targetTimes.json
for p in suikei wdist snow kaikotan nowc; do
  echo "--- $p の js が読むファイル"
  for js in $(curl -s --max-time 30 $B/$p/ | grep -oE 'src="[^"]+\.js"' | sed 's/src="//;s/"//' | head -6); do
    case "$js" in http*) u=$js;; /*) u=https://www.jma.go.jp$js;; *) u=$B/$p/$js;; esac
    curl -s --max-time 30 "$u" | grep -oE '[a-zA-Z0-9_/.-]*targetTimes[a-zA-Z0-9_.-]*' | sort -u | head -8
  done
done
echo "## ひまわりの画像1枚（日本域の赤外 または 可視）の大きさ"
curl -s --max-time 30 $B/himawari/data/satimg/targetTimes_jp.json | head -c 400; echo
