// The map (docs/model-map.md), written from the catalog (#189). `npm run model-map` writes it; a
// test fails when the file is not what the catalog says.

import { type Catalog, type DriverPath, leaves, ruleGaps } from "./registry";

const cell = (s: string | undefined) => (s ?? "").replace(/\|/g, "／").replace(/\n/g, " ");
const code = (ids: string[]) => ids.map((i) => `\`${i}\``).join("<br>") || "—";

export function modelMap(c: Catalog): string {
  const ids = new Map<string, string>();
  const nid = (id: string) => {
    if (!ids.has(id)) ids.set(id, `n${ids.size}`);
    return ids.get(id)!;
  };
  const families = [...new Set(c.parts.map((p) => p.family))];
  // Parts and what reads them; the sources are in the tables (drawn too, the picture is a thicket).
  const mer: string[] = ["flowchart LR", `  ${nid("答え")}[["人の答え"]]`];
  for (const f of families) {
    mer.push(`  subgraph ${f}`);
    for (const p of c.parts.filter((x) => x.family === f)) mer.push(`    ${nid(p.id)}["${p.id}${p.status === "使用中" ? "" : `<br>（${p.status}）`}"]`);
    mer.push("  end");
  }
  mer.push("  subgraph 判定", `    ${nid("β")}(["β（学習）<br>${c.recipes.filter((r) => r.family === "温冷感").length}のレシピを混ぜる"])`, `    ${nid("選好")}(["選好（学習）"])`);
  for (const r of c.rules) mer.push(`    ${nid(`rule:${r.id}`)}(["${r.id}（決まり）"])`);
  mer.push("  end");
  const node = (id: string) => {
    const s = c.sources.find((x) => x.id === id);
    return s?.kind === "答え" ? nid("答え") : s ? null : nid(id);
  };
  const edges = new Set<string>();
  const edge = (from: string, to: string) => {
    const n = node(from);
    if (n) edges.add(`  ${n} --> ${to}`);
  };
  for (const p of c.parts) for (const i of p.inputs) edge(i, nid(p.id));
  const into = (target: string, keys: string[]) => {
    for (const k of keys) {
      const d = c.drivers.find((x) => x.key === k);
      for (const f of [...(d?.learn.from ?? []), ...(d?.predict?.from ?? [])]) edge(f, target);
    }
  };
  into(nid("β"), [...new Set(c.recipes.filter((r) => r.family === "温冷感").flatMap((r) => [...r.base, ...Object.values(r.roles).flat()]))] as string[]);
  into(nid("選好"), [...new Set(c.recipes.filter((r) => r.family === "選好").flatMap((r) => r.base))]);
  for (const r of c.rules) for (const p of r.reads) edge(p, nid(`rule:${r.id}`));
  mer.push(...edges);

  const out: string[] = [];
  out.push("# モデルの地図（計算の変数・計算式・使う所）", "");
  out.push("<!-- このファイルは src/model/catalog.ts から作る（npm run model-map）。手で直さない。 -->", "");
  out.push(
    "体感の計算を、**部品**（1つの量を出す計算）・**要因**（部品をモデルに入れる形に）・**レシピ**（学ぶモデルが、どの要因で何を動かすか）・**決まり**（学ばずに部品を使う規則：従来版）に分けて登録してある（#189）。",
    "",
    "- **決まり**：計算式を足す・変える・外すときは `src/model/catalog.ts` を同じ PR で直し、`npm run model-map` でこの地図を作り直す（テストが見張る）",
    "- ID（`慣れ/重み付き` など）で呼ぶ。数式の正本は `research/comfort-model/mathematical-contract.md`（MATH-01〜09）",
    "- 状態：**使用中**（画面か学習に効く）／**候補**（研究用）／**表示用**（見せるだけ）",
    `- 学ぶモデルの版は1つ：\`${c.modelVersion}\`（レシピの集まり・要因の作り方・出発点をまとめた版）`,
    "- S1（今）：登録は今のコードを説明しているだけ。S2 で計算そのものを部品に移す",
    "",
  );
  out.push("## 全体の流れ", "", "部品と、それを読む判定（入力からの線は省き、下の表に書く）。", "", "```mermaid", ...mer, "```", "");

  out.push("## 入力", "", "| ID | 中身 | 種類 | 実績 | 予報 | メモ |", "|---|---|---|---|---|---|");
  for (const s of c.sources) out.push(`| \`${s.id}\` | ${s.label} | ${s.kind} | ${s.kind === "気象" ? (s.record ? "○" : "—") : ""} | ${s.kind === "気象" ? (s.forecast ? "○" : "—") : ""} | ${cell(s.note)} |`);
  out.push("");

  out.push("## 部品");
  for (const f of families) {
    out.push("", `### ${f}`, "", "| ID | 中身 | 状態 | 入力 | 単位 | 期間・条件 | 値 | 実装 | メモ |", "|---|---|---|---|---|---|---|---|---|");
    for (const p of c.parts.filter((x) => x.family === f))
      out.push(
        `| \`${p.id}\` | ${cell(p.label)} | ${p.status} | ${code(p.inputs)} | ${p.unit} | ${cell(p.span) || "—"} | ${p.params?.map((x) => `${x.name}：${cell(x.value)}${x.learnedBy ? `（学ぶ：${cell(x.learnedBy)}）` : ""}`).join("<br>") || "—"} | ${cell(p.impl)} | ${cell([p.note, p.issues?.map((n) => `#${n}`).join("・")].filter(Boolean).join(" "))} |`,
      );
  }
  out.push("");

  const path = (p: DriverPath | null) => (p ? `${code(p.from)}${p.stored ? "<br>（記録に保存した値）" : ""}` : "—");
  out.push("## 要因", "", "学習は保存した記録から、日ごとの予測はストアから組み立てる。違いのある要因は下の「学習と予測の違い」にも載せる。", "");
  out.push("| 要因 | 中身 | 単位 | 学習 | 日ごとの予測 |", "|---|---|---|---|---|");
  for (const d of c.drivers) out.push(`| \`${d.key}\` | ${cell(d.label)} | ${cell(d.unit)} | ${path(d.learn)} | ${path(d.predict)} |`);
  out.push("");

  out.push("## 学習と予測の違い", "", "同じ要因でも、学習と日ごとの予測で材料が違うもの。S2 で1つの組み立てにそろえ、残る違いはテストで固定する。", "", "| 要因 | 違い |", "|---|---|");
  for (const d of c.drivers.filter((x) => x.differs)) out.push(`| \`${d.key}\` | ${cell(d.differs)} |`);
  out.push("");

  out.push(`## レシピ（学ぶモデル、版 \`${c.modelVersion}\`）`, "", "| レシピ | 中身 | 共通の要因 | 中心 | 幅 | 場所 | メモ |", "|---|---|---|---|---|---|---|");
  for (const r of c.recipes)
    out.push(`| \`${r.id}\` | ${cell(r.label)} | ${r.base.join(", ")} | ${(r.roles.中心 ?? []).join(", ") || "—"} | ${(r.roles.幅 ?? []).join(", ") || "—"} | ${(r.roles.場所 ?? []).join(", ") || "—"} | ${cell(r.note)} |`);
  out.push("");

  out.push("## 決まり（学ばない）", "", "| 決まり | 中身 | 読む部品 | 値 | 実装 | メモ |", "|---|---|---|---|---|---|");
  for (const r of c.rules) out.push(`| \`${r.id}\` | ${cell(r.label)} | ${code(r.reads)} | ${r.params?.map((x) => `${x.name}：${cell(x.value)}`).join("<br>") || "—"} | ${cell(r.impl)} | ${cell(r.note)} |`);
  out.push("");

  out.push("## データの原則（実績と予報の両方にある入力）", "");
  const gaps = ruleGaps(c);
  if (!gaps.length) out.push("使用中の部品と日ごとの予測の要因は、すべて実績と予報の両方にある気象の入力から作られている。");
  else {
    out.push("| 部品・要因 | 片方にしかない入力 | 決める課題 |", "|---|---|---|");
    for (const g of gaps) out.push(`| \`${g.what}\` | ${code(g.sources)} | ${g.known ? `#${g.known}` : "**未登録**"} |`);
  }
  out.push("");

  out.push("## 慣れを読む部品（どれがどこへ）", "", "| 部品 | 期間・条件 | 使う決まり・要因 |", "|---|---|---|");
  for (const p of c.parts.filter((x) => x.family === "慣れ")) {
    const ds = c.drivers.filter((d) => [...d.learn.from, ...(d.predict?.from ?? [])].includes(p.id)).map((d) => `\`${d.key}\``);
    const rs = c.rules.filter((r) => r.reads.includes(p.id)).map((r) => `\`${r.id}\``);
    out.push(`| \`${p.id}\` | ${cell(p.span) || "—"} | ${[...rs, ...ds].join("、") || (p.status === "表示用" ? "（表示だけ）" : "—")} |`);
  }
  out.push("");
  return out.join("\n");
}

/** Every source a driver's prediction path reads in the end (for checks). */
export const driverSources = (c: Catalog, key: string) => {
  const d = c.drivers.find((x) => x.key === key);
  return [...new Set((d?.predict?.from ?? []).flatMap((p) => leaves(c, p).map((s) => s.id)))];
};
