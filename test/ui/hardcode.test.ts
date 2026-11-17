// 段にない値・直書きの見張り (#142, docs/design-system.md「直書きの見張り」): the values written by hand in
// src/ (test/ui/hardcode.ts) must be exactly the list in test/ui/hardcode-budget.json. A new one fails
// (use a token, or put it on the list in the same PR with its reason); one taken away fails until the
// list is lowered too, so the list is always the true one. Rewrite it: HARDCODE_WRITE=1 npx vitest run
// test/ui/hardcode.test.ts (HARDCODE_CSV=<file> also writes where each one is).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { budgetOf, hardcodedValues } from "./hardcode";

const SRC = join(__dirname, "../../src");
const BUDGET = join(__dirname, "hardcode-budget.json");
const hits = hardcodedValues(SRC);
const now = budgetOf(hits);

describe("直書きの見張り (#142)", () => {
  if (process.env.HARDCODE_WRITE) it("writes the list", () => writeFileSync(BUDGET, JSON.stringify(now, null, 2) + "\n"));
  if (process.env.HARDCODE_CSV)
    it("writes where each one is", () =>
      writeFileSync(
        process.env.HARDCODE_CSV!,
        "﻿種類,値,ファイル,行,中身\n" + hits.map((h) => [h.kind, h.value, `src/${h.file}`, h.line, h.text].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n",
      ));

  it("text in the code takes its size from the type scale (TYPE_SIZE), never a number", () => {
    expect(hits.filter((h) => h.kind === "文字の大きさ").map((h) => `${h.file}:${h.line} ${h.text}`)).toEqual([]);
  });

  it("the values written by hand are the list (test/ui/hardcode-budget.json), no more and no fewer", () => {
    const listed: Record<string, Record<string, number>> = existsSync(BUDGET) ? JSON.parse(readFileSync(BUDGET, "utf8")) : {};
    const diff: string[] = [];
    for (const kind of new Set([...Object.keys(listed), ...Object.keys(now)]))
      for (const value of new Set([...Object.keys(listed[kind] ?? {}), ...Object.keys(now[kind] ?? {})])) {
        const a = listed[kind]?.[value] ?? 0;
        const b = now[kind]?.[value] ?? 0;
        if (a === b) continue;
        const where = hits.filter((h) => h.kind === kind && h.value === value).slice(0, 3).map((h) => `${h.file}:${h.line}`).join(" ");
        diff.push(b > a ? `増えた ${kind} ${value}: ${a} → ${b}（${where}）トークンを使うか、理由を添えて一覧に載せる` : `減った ${kind} ${value}: ${a} → ${b}：一覧も下げる（HARDCODE_WRITE=1）`);
      }
    expect(diff).toEqual([]);
  });
});
