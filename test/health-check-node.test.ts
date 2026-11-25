// 監視の脚本（scripts/health-check.mjs）は GitHub Actions で Node がそのまま動かす（バンドラーを通さない）。
// Vitest は拡張子の無い import も解いてしまうので、ほかのテストでは気づけない（11/25、shared/healthJudge.ts の
// "./airSchedule" で health.yml が ERR_MODULE_NOT_FOUND で止まった）。ここでは本物の Node で読み込みだけを確かめる。

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("監視の脚本を Node がそのまま読み込める", () => {
  it("imports scripts/health-check.mjs (and what it imports) without a bundler", () => {
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", 'const m = await import("./scripts/health-check.mjs"); console.log(typeof m.importIssueActions);'],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(out.trim().split("\n").pop()).toBe("function");
  });
});
