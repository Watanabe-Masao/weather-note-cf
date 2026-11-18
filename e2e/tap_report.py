# The things to press smaller than 44px (design-system 3), from a run of e2e/e2e.py with WN_TAPS=<file>:
# one line a kind (tag and classes), its sizes seen and a few of their names, smallest first.
#   python3 e2e/tap_report.py taps.jsonl
import collections, json, sys

seen = collections.defaultdict(lambda: [set(), set(), set()])
for line in open(sys.argv[1]):
    d = json.loads(line)
    for kind, name, w, h in d["rows"]:
        s = seen[kind]
        s[0].add((w, h)); s[1].add(name); s[2].add(d["where"].split(" ")[0])
rows = sorted(seen.items(), key=lambda kv: min(min(w, h) for w, h in kv[1][0]))
print("| 種類 | 大きさ（幅×高さ px） | 例 | 出た検査 |")
print("| --- | --- | --- | --- |")
for kind, (sizes, names, where) in rows:
    print(f"| `{kind}` | {'、'.join(f'{w}×{h}' for w, h in sorted(sizes)[:4])} | {'、'.join(sorted(names)[:3])} | {'・'.join(sorted(where)[:4])} |")
print(f"\n{len(rows)} 種類")
