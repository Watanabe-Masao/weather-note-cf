// データの地図（docs/data-map.md 5章）：作っている表は、どれも「気象・ユーザー・運用」のどこかに書いてある。
// 新しい表を足したら、そこに書き足す（いつか DB を分けるときの置き場所）。
import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("worker/src の表はすべてデータの地図の5章にある", () => {
  const tables = new Set<string>();
  for (const f of readdirSync("worker/src").filter((x) => x.endsWith(".ts")))
    for (const m of readFileSync(`worker/src/${f}`, "utf8").matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) tables.add(m[1]);
  const doc = readFileSync("docs/data-map.md", "utf8");
  const sec = doc.slice(doc.indexOf("## 5. データベースの表の置き場所"), doc.indexOf("## 6."));
  expect([...tables].filter((t) => !sec.includes(`\`${t}\``))).toEqual([]);
});
