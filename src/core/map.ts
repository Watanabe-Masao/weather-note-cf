// 依存の図 (principles 5, 8 DRY): drawn from the formulas themselves — their needs, series and
// params — never written by hand. docs/core-map.md is this file's output (npm run core-map), and a
// test fails when the two differ.

import { historyEma } from "./estimate/history-ema/formula";
import { historyMean } from "./estimate/history-mean/formula";
import type { AnyFormula } from "./estimate/engine";
import { feelShade } from "./estimate/feel-shade/formula";
import { feelSun } from "./estimate/feel-sun/formula";
import { radSunshine } from "./estimate/sun/formula";
import { windTen } from "./estimate/wind-ten/formula";
import { windPerson } from "./estimate/wind-person/formula";
import { level7 } from "./judge/level7/formula";
import { seasonShift } from "./judge/season-shift/formula";
import { CONCEPTS, HYPOTHESES } from "./hypotheses";
import { DAY_FIELDS, HOUR_FIELDS } from "./material/fields";

/** Every formula in the core (a test checks none is left out). */
export const FORMULAS: readonly AnyFormula[] = [windPerson, feelShade, radSunshine, windTen, feelSun, historyMean, historyEma, seasonShift, level7];

/** The inputs that come from the material, by the name formulas use for them. */
export const MATERIAL_INPUTS: Record<string, string> = {
  ...Object.fromEntries(HOUR_FIELDS.map((f) => [f.id, `${f.label}（毎時）`])),
  windHeight: "風速計の高さ（場所）",
  lat: "緯度（場所）",
  lon: "経度（場所）",
  hourStart: "時刻",
  dayMeans: `${DAY_FIELDS.find((f) => f.id === "temp")!.label}（前の日から）`,
};

export interface Edge {
  from: string;
  to: string;
  kind: "need" | "series" | "choice";
}

/** Every dependency: from a material input or a formula (by key) to the formula that needs it. A need
 *  with choices comes from each formula that can fill it. */
export function edges(formulas: readonly AnyFormula[] = FORMULAS): Edge[] {
  return formulas.flatMap((f) => [
    ...f.needs.flatMap((n: string): Edge[] => {
      const c: readonly string[] | undefined = f.choices?.[n];
      return c ? c.map((from) => ({ from, to: f.key, kind: "choice" as const })) : [{ from: n, to: f.key, kind: "need" }];
    }),
    ...(f.series ?? []).map((n: string): Edge => ({ from: n, to: f.key, kind: "series" })),
  ]);
}

const ARROW: Record<Edge["kind"], string> = { need: "-->", series: "-. 前の日から .->", choice: "== どれか ==>" };

const node = (k: string) => k.replace(/[^A-Za-z0-9]/g, "_");

/** The map as Mermaid: materials on the left, each formula with its version and its numbers' names. */
export function mermaid(formulas: readonly AnyFormula[] = FORMULAS): string {
  const used = new Set(edges(formulas).map((e) => e.from));
  const lines = ["flowchart LR", "  subgraph 材料"];
  for (const [k, label] of Object.entries(MATERIAL_INPUTS)) if (used.has(k)) lines.push(`    ${node(k)}["${label}<br><code>${k}</code>"]`);
  const judge = (f: AnyFormula) => f.id.startsWith("judge.");
  lines.push("  end", "  subgraph 推測値");
  for (const f of formulas.filter((f) => !judge(f))) lines.push(`    ${node(f.key)}["${f.label}<br><code>${f.id}@${f.version}</code> ${f.unit}<br><small>数：${f.params.join("・")}</small>"]`);
  lines.push("  end", "  subgraph 判定");
  for (const f of formulas.filter(judge)) lines.push(`    ${node(f.key)}["${f.label}<br><code>${f.id}@${f.version}</code> ${f.unit}<br><small>数：${f.params.join("・")}</small>"]`);
  lines.push("  end");
  for (const e of edges(formulas)) lines.push(`  ${node(e.from)} ${ARROW[e.kind]} ${node(e.to)}`);
  return lines.join("\n");
}

/** The hypotheses as Mermaid: what is thought to act on what, apart from the computation. */
export function hypothesisMermaid(): string {
  const label = (k: string) => (k in CONCEPTS ? CONCEPTS[k as keyof typeof CONCEPTS] : (FORMULAS.find((f) => f.key === k)?.label ?? k));
  const nodes = [...new Set(HYPOTHESES.flatMap((h) => [h.from, h.to]))];
  const lines = ["flowchart LR"];
  for (const k of nodes) lines.push(`  ${node(k)}${k in CONCEPTS ? `(["${label(k)}"])` : `["${label(k)}<br><code>${k}</code>"]`}`);
  for (const h of HYPOTHESES) lines.push(`  ${node(h.from)} -. "${h.status}<br><code>${h.id}</code>" .-> ${node(h.to)}`);
  return lines.join("\n");
}

/** docs/core-map.md, whole. */
export function coreMapDoc(): string {
  return [
    "# core の依存の図",
    "",
    "`src/core/map.ts` が計算式の `needs`・`series`・`params` から作る図（`npm run core-map`）。手で直さない。計算式を足す・変えると、テストがこの文書との違いを知らせる。",
    "",
    "## 計算上の依存",
    "",
    "どの値から計算するか。コード（計算式の `needs`・`series`・`choices`）からだけ作る。線があることは、効くことが確かめられたという意味ではない。",
    "",
    "```mermaid",
    mermaid(),
    "```",
    "",
    "## 仮説上の影響",
    "",
    "何が何に効くと考えているか（研究上の主張、`src/core/hypotheses.ts`）。状態は、答えの1歩先の予測で比べた結果だけが変える（仮説 → 確かめ中 → 支持／支持されない）。",
    "",
    "```mermaid",
    hypothesisMermaid(),
    "```",
    "",
    "## 確かめられた関係",
    "",
    "まだない。学習あり版の比べた結果（効果の大きさと幅つき）から作る。手で書かない。",
    "",
  ].join("\n");
}
