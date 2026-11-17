# The computed look before and after a change that should not change it (#142 A): two files written by
# e2e/e2e.py with WN_STYLES, compared snapshot by snapshot (the same check in the same order) and
# element by element. Prints every difference; exits 1 when there is one.
#   python3 e2e/style_diff.py before.jsonl after.jsonl [noise.jsonl]
# noise.jsonl: a second run before the change; what differs between the two runs before (a moving
# cursor, a clock) is left out.
import json, sys

def load(p):
    return {s["n"]: s for s in map(json.loads, open(p))}

def diffs(a, b):
    out = []
    for n in sorted(set(a) & set(b)):
        sa, sb = a[n], b[n]
        if sa["where"] != sb["where"]:
            out.append((n, "*", "snapshot", sa["where"], sb["where"])); continue
        for k in set(sa["rows"]) & set(sb["rows"]):
            va, vb = sa["rows"][k].split("|"), sb["rows"][k].split("|")
            for p, x, y in zip(sa["props"], va, vb):
                if x != y: out.append((n, k, p, x, y))
    return out

a, b = load(sys.argv[1]), load(sys.argv[2])
noise = {(n, k, p) for n, k, p, *_ in diffs(a, load(sys.argv[3]))} if len(sys.argv) > 3 else set()
d = [x for x in diffs(a, b) if (x[0], x[1], x[2]) not in noise]
common = set(a) & set(b)
elements = sum(len(set(a[n]["rows"]) & set(b[n]["rows"])) for n in common)
print(f"snapshots {len(common)} (before {len(a)}, after {len(b)}), elements compared {elements}, values {elements * len(next(iter(a.values()))['props']) if a else 0}, left out as noise {len(noise)}")
for n, k, p, x, y in d[:60]:
    print(f"#{n} {k[-90:]} {p}: {x} → {y}")
print(f"differences: {len(d)}")
sys.exit(1 if d else 0)
