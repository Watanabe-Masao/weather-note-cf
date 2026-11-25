// データの形の版の見張り（2026-11-25 外部レビュー：「同じ版の期待一覧を書き換えると通るため、版を上げたこと自体は保証されない」）。
// PR のとき、ベース（main）の test/data-shape.json・shared/versions.ts と比べる：
//   - ベースにある版の一覧を書き換えていたら止める（前の版は記録なので書き換えない）
//   - 一覧に新しい版を足したのに DATA_SHAPE がそれになっていなければ止める（逆も）
// 使い方：node scripts/check-data-shape.mjs <ベースの ref>（例 origin/main）。ベースが読めなければ何もしない（main への push など）。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const base = process.argv[2];
const show = (path) => {
  try {
    return execFileSync("git", ["show", `${base}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};
const shapeOf = (src) => Number(/export const DATA_SHAPE = (\d+);/.exec(src ?? "")?.[1] ?? NaN);

const baseJson = base ? show("test/data-shape.json") : null;
if (!baseJson) {
  console.log("データの形：ベースの一覧が読めないので比べません");
  process.exit(0);
}
const before = JSON.parse(baseJson);
const after = JSON.parse(readFileSync("test/data-shape.json", "utf8"));
const beforeShape = shapeOf(show("shared/versions.ts"));
const afterShape = shapeOf(readFileSync("shared/versions.ts", "utf8"));
const problems = [];
for (const v of Object.keys(before).filter((k) => /^\d+$/.test(k)))
  if (JSON.stringify(before[v]) !== JSON.stringify(after[v])) problems.push(`版 ${v} の一覧が書き換えられています。項目が変わったなら DATA_SHAPE を上げ、新しい版として足してください。`);
const latest = Math.max(...Object.keys(after).filter((k) => /^\d+$/.test(k)).map(Number));
if (latest !== afterShape) problems.push(`一覧のいちばん新しい版（${latest}）と DATA_SHAPE（${afterShape}）が合いません。`);
if (afterShape < beforeShape) problems.push(`DATA_SHAPE が下がっています（${beforeShape} → ${afterShape}）。`);
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`データの形：版 ${afterShape}（ベース ${beforeShape}）、前の版の一覧は変わっていません`);
