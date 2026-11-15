// The map (docs/model-map.md), written from the catalog (#189). `npm run model-map` writes it; a
// test fails when the file is not what the catalog says.

import { type Catalog, leaves, ruleGaps } from "./registry";

const cell = (s: string | undefined) => (s ?? "").replace(/\|/g, "／");

export function modelMap(c: Catalog): string {
  const ids = new Map<string, string>();
  const nid = (id: string) => {
    if (!ids.has(id)) ids.set(id, `n${ids.size}`);
    return ids.get(id)!;
  };
  const families = [...new Set(c.parts.map((p) => p.family))];
  const mer: string[] = ["flowchart LR"];
  mer.push("  subgraph 入力");
  for (const s of c.sources) mer.push(`    ${nid(s.id)}["${s.label}${s.record && s.forecast ? "" : s.record ? "<br>（実績だけ）" : "<br>（予報だけ）"}"]`);
  mer.push("  end");
  for (const f of families) {
    mer.push(`  subgraph ${f}`);
    for (const p of c.parts.filter((x) => x.family === f)) mer.push(`    ${nid(p.id)}["${p.id}${p.status === "使用中" ? "" : `<br>（${p.status}）`}"]`);
    mer.push("  end");
  }
  mer.push("  subgraph レシピ");
  const groups = [...new Set(c.recipes.map((r) => r.id.split("/")[0]))];
  for (const g of groups) mer.push(`    ${nid(`recipe:${g}`)}(["${g}${g === "β" ? `<br>${c.recipes.filter((r) => r.id.startsWith("β/")).length} のレシピ` : ""}"])`);
  mer.push("  end");
  for (const p of c.parts) for (const i of p.inputs) mer.push(`  ${nid(i)} --> ${nid(p.id)}`);
  for (const g of groups) {
    const rs = c.recipes.filter((r) => r.id.split("/")[0] === g);
    const used = new Set<string>();
    for (const r of rs) {
      used.add(r.base);
      for (const p of r.parts ?? []) used.add(p);
      for (const k of Object.values(r.roles).flat()) for (const p of c.drivers.find((d) => d.key === k)?.from ?? []) used.add(p);
    }
    for (const p of used) mer.push(`  ${nid(p)} --> ${nid(`recipe:${g}`)}`);
  }

  const out: string[] = [];
  out.push("# モデルの地図（計算の変数・計算式・使う所）", "");
  out.push("<!-- このファイルは src/model/catalog.ts から作る（npm run model-map）。手で直さない。 -->", "");
  out.push(
    "体感の計算を、**部品**（1つの量を出す計算）・**要因**（部品の出力をモデルに入れる形に）・**レシピ**（どの要因で何を動かすか）に分けて登録してある（#189）。モデルはレシピで、候補を足すときはレシピを1行足す。",
    "",
    "- **決まり**：計算式を足す・変える・外すときは `src/model/catalog.ts` を同じ PR で直し、`npm run model-map` でこの地図を作り直す（テストが見張る）",
    "- ID（`慣れ/重み付き` など）で呼ぶ。数式の正本は `research/comfort-model/mathematical-contract.md`（MATH-01〜09）",
    "- 状態：**使用中**（画面か学習に効く）／**候補**（研究用）／**表示用**（見せるだけで、ほかの計算に入らない）",
    "",
  );
  out.push("## 全体の流れ", "", "```mermaid", ...mer, "```", "");

  out.push("## 入力", "", "| ID | 中身 | 実績 | 予報 | メモ |", "|---|---|---|---|---|");
  for (const s of c.sources) out.push(`| \`${s.id}\` | ${s.label} | ${s.record ? "○" : "—"} | ${s.forecast ? "○" : "—"} | ${cell(s.note)} |`);
  out.push("");

  out.push("## 部品");
  for (const f of families) {
    out.push("", `### ${f}`, "", "| ID | 中身 | 状態 | 入力 | 単位 | 期間 | 実装 | メモ |", "|---|---|---|---|---|---|---|---|");
    for (const p of c.parts.filter((x) => x.family === f))
      out.push(
        `| \`${p.id}\` | ${cell(p.label)} | ${p.status} | ${p.inputs.map((i) => `\`${i}\``).join("<br>")} | ${p.unit} | ${cell(p.span) || "—"} | ${cell(p.impl)} | ${cell([p.note, p.issues?.map((n) => `#${n}`).join("・")].filter(Boolean).join(" "))} |`,
      );
  }
  out.push("");

  out.push("## 要因（β）", "", "| 要因 | 中身 | 単位 | 部品 |", "|---|---|---|---|");
  for (const d of c.drivers) out.push(`| \`${d.key}\` | ${cell(d.label)} | ${cell(d.unit)} | ${d.from.map((p) => `\`${p}\``).join("<br>")} |`);
  out.push("");

  out.push("## レシピ", "", "| レシピ | 値 | 肌感 | 中心 | 幅 | 場所 | 部品を直接 | 版 | メモ |", "|---|---|---|---|---|---|---|---|---|");
  for (const r of c.recipes)
    out.push(
      `| \`${r.id}\` ${cell(r.label.replace(/^[^：]*：/, ""))} | ${r.kind} | \`${r.base}\` | ${(r.roles.中心 ?? []).join(", ") || "—"} | ${(r.roles.幅 ?? []).join(", ") || "—"} | ${(r.roles.場所 ?? []).join(", ") || "—"} | ${(r.parts ?? []).map((p) => `\`${p}\``).join(", ") || "—"} | ${cell(r.version)} | ${cell(r.note)} |`,
    );
  out.push("");

  out.push("## データの原則（実績と予報の両方にある入力）", "");
  const gaps = ruleGaps(c);
  if (!gaps.length) out.push("使用中の部品はすべて、実績と予報の両方にある入力から作られている。");
  else {
    out.push("| 部品 | 片方にしかない入力 | 決める課題 |", "|---|---|---|");
    for (const g of gaps) out.push(`| \`${g.part}\` | ${g.sources.map((s) => `\`${s}\``).join("、")} | ${g.known ? `#${g.known}` : "**未登録**"} |`);
  }
  out.push("");

  out.push("## 慣れを読む部品（どれがどこへ）", "", "| 部品 | 期間 | 使うレシピ・要因 |", "|---|---|---|");
  for (const p of c.parts.filter((x) => x.family === "慣れ")) {
    const drivers = c.drivers.filter((d) => d.from.includes(p.id)).map((d) => `\`${d.key}\``);
    const recipes = c.recipes.filter((r) => r.parts?.includes(p.id)).map((r) => `\`${r.id}\``);
    out.push(`| \`${p.id}\` | ${cell(p.span) || "—"} | ${[...recipes, ...drivers].join("、") || (p.status === "表示用" ? "（表示だけ）" : "—")} |`);
  }
  out.push("");
  return out.join("\n");
}

/** Every source a recipe reads in the end (for checks). */
export const recipeSources = (c: Catalog, id: string) => {
  const r = c.recipes.find((x) => x.id === id);
  if (!r) return [];
  const parts = [r.base, ...(r.parts ?? []), ...Object.values(r.roles).flat().flatMap((k) => c.drivers.find((d) => d.key === k)?.from ?? [])];
  return [...new Set(parts.flatMap((p) => leaves(c, p).map((s) => s.id)))];
};
