#!/usr/bin/env bash
# #250 FH-01: JMA's forecast telegrams in the XML feed (定時 regular feed): which titles, from whom,
# how far back the long feed reaches, and one 高知 telegram of each kind. Read-only. 出典：気象庁。
set -u
for f in regular regular_l; do
  curl -s --max-time 60 -o $f.xml https://www.data.jma.go.jp/developer/xml/feed/$f.xml
  echo "## $f.xml: $(wc -c < $f.xml) bytes, $(grep -c '<entry>' $f.xml) entries"
  python3 - $f.xml <<'PY'
import re,sys,collections
x=open(sys.argv[1],encoding="utf-8").read()
es=re.findall(r"<entry>(.*?)</entry>",x,re.S)
ts=[re.search(r"<updated>(.*?)</updated>",e).group(1) for e in es]
print("updated:",min(ts),"〜",max(ts))
c=collections.Counter(re.search(r"<title>(.*?)</title>",e).group(1) for e in es)
for t,n in c.most_common(40): print(f"  {n:5} {t}")
k=[e for e in es if "高知" in e]
print("高知:",len(k))
for e in k[:12]:
    print("  ",re.search(r"<title>(.*?)</title>",e).group(1),re.search(r"<updated>(.*?)</updated>",e).group(1),re.search(r'href="([^"]+)"',e).group(1))
PY
done
echo "## 高知の天気予報・週間天気予報の電文"
for t in 府県天気予報 府県週間天気予報; do
  u=$(python3 - regular_l.xml "$t" <<'PY'
import re,sys
x=open(sys.argv[1],encoding="utf-8").read()
for e in re.findall(r"<entry>(.*?)</entry>",x,re.S):
    if sys.argv[2] in e and "高知" in e:
        print(re.search(r'href="([^"]+)"',e).group(1)); break
PY
)
  echo "--- $t $u"
  [ -n "$u" ] && curl -s --max-time 60 "$u" | head -c 6000 && echo && echo "(bytes: $(curl -s --max-time 60 "$u" | wc -c))"
done
