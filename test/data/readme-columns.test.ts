// README 8.5 lists every CSV column, in order (#86: the table had fallen behind the columns).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toCsv } from "../../src/beta/reports";

describe("README 8.5: the CSV columns", () => {
  it("names every column of the CSV", () => {
    const header = toCsv([]).replace(/^﻿/, "").split(/\r?\n/)[0].split(",");
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    const section = readme.slice(readme.indexOf("### 8.5 CSV"), readme.indexOf("### 8.6"));
    const named = (c: string) =>
      section.includes(`\`${c}\``) ||
      (/^d\d_/.test(c) && section.includes("`d1_*` 〜 `d7_*`") && section.includes(`\`${c.slice(3)}\``)) ||
      (/^p_(m\d|0|p\d)$/.test(c) && section.includes("`p_m3` 〜 `p_p3`"));
    const missing = header.filter((c) => !named(c));
    expect(missing).toEqual([]);
    expect(header.length).toBeGreaterThan(80);
  });
});
