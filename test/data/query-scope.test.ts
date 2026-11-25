// TanStack Query を使う範囲の見張り（2026-11-25 渡辺さん「使用用途と範囲は明文化させた上で範囲を限って使用しているか？」
// 「範囲に限って入れてないかのテストは必要」）。docs/data-fetching.md の「使ってよいファイル」の表と、実際に
// @tanstack/react-query を読み込んでいるファイルを比べる。表に無い所で使う・表にあるのに使っていない、のどちらでも落ちる。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules") return [];
    return statSync(join(ROOT, p)).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
const uses = (p: string) => /from\s+["']@tanstack\/react-query["']/.test(readFileSync(join(ROOT, p), "utf8"));

const doc = readFileSync(join(ROOT, "docs", "data-fetching.md"), "utf8");
const section = doc.slice(doc.indexOf("## 使ってよいファイル"), doc.indexOf("## 置き換える順"));
const allowed = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]).sort();

describe("TanStack Query を使う範囲（docs/data-fetching.md）", () => {
  it("使ってよいファイルの表がある", () => {
    expect(allowed.length).toBeGreaterThan(0);
  });
  it("表に無いファイルでは使わない・表にあるファイルは使っている", () => {
    const actual = ["src", "worker", "shared"].flatMap(files).filter(uses).map((p) => relative(".", p)).sort();
    expect(actual, "TanStack Query を使うファイルは docs/data-fetching.md の表と同じに（足すなら表にも、用途とともに）").toEqual(allowed);
  });
  it("比較の表の日別・時別（store.ts ほか）と Worker・共有では使わない", () => {
    for (const p of ["src/data/store.ts", "src/data/db.ts", "src/data/queue.ts", "src/data/plan.ts", "src/state.ts"]) expect(allowed).not.toContain(p);
    expect(allowed.every((p) => p.startsWith("src/"))).toBe(true);
  });
});
