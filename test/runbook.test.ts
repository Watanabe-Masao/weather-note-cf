// 障害とイレギュラーの手引き（docs/runbook.md、shared/runbook.ts）：知らせの key のどれにも手順があり、手引きに
// その番号の節があること。新しい知らせを足して手順を足し忘れると、ここで落ちる（仕組みで回す）。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUNBOOK, runbookOf, runbookTag } from "../shared/runbook";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** 知らせの key を、出しているコードから拾う（problem("…")・note(`…:`)・key: "…"・kind: "…"）。 */
function keysIn(src: string, re: RegExp): string[] {
  return [...new Set([...src.matchAll(re)].map((m) => m[1]))];
}

describe("手引き", () => {
  const judge = keysIn(read("shared/healthJudge.ts"), /(?:problem|note)\(["`]([a-zA-Z0-9]+)/g);
  const forecast = keysIn(read("worker/src/forecastWatch.ts"), /\bkey: ["`]([a-z]+)/g).concat(["fetch", "missing"]);
  const typhoon = keysIn(read("worker/src/typhoonWatch.ts"), /\bkey: ["`]([a-z]+)/g);
  const doc = read("docs/runbook.md");

  it("毎時の見張りのどの知らせにも手順がある", () => {
    expect(judge.length).toBeGreaterThan(15);
    for (const k of judge) if (k !== "alert") expect(runbookOf(k), k).not.toBeNull();
  });
  it("予報と台風の見張りのどの知らせにも手順がある（alert: を付けて引く）", () => {
    for (const k of [...forecast, ...typhoon]) expect(runbookOf(`alert:${k}`), k).not.toBeNull();
  });
  it("手順の番号ごとに手引きに節があり、知らせの key が書いてある", () => {
    for (const e of RUNBOOK) {
      expect(doc, e.code).toContain(`### ${e.code} ${e.title}（${e.severity}）`);
      for (const k of e.keys.filter((k) => k !== "import" && !k.startsWith("alert:"))) expect(doc, `${e.code} ${k}`).toContain(k);
    }
  });
  it("知らせの1行に番号と重さを添える。手順が無いものはそう言う", () => {
    expect(runbookTag("radarStale")).toBe("（手順 R-03・S1）");
    expect(runbookTag("cronFailed:notify")).toBe("（手順 R-06・S2）");
    expect(runbookTag("alert:missing:VPFD51")).toBe("（手順 R-01・S1）");
    expect(runbookTag("month:r2Bytes")).toBe("（手順 R-09・S3）");
    expect(runbookTag("somethingNew")).toBe("（手順 なし：手引きに足す）");
  });
});
