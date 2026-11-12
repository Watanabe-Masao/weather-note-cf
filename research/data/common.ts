// Shared by the research data scripts: where files live, and how a file's hash is made.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Export } from "./transform";

export const HERE = new URL("./", import.meta.url);
export const RAW = new URL("./raw/", HERE);
export const PARQUET = new URL("./parquet/", HERE);
export const DB_FILE = new URL("./weather-note.duckdb", HERE).pathname;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function readExports(): { file: string; ex: Export; text: string }[] {
  if (!existsSync(RAW)) return [];
  return readdirSync(RAW)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const text = readFileSync(new URL(f, RAW), "utf8");
      return { file: f, ex: JSON.parse(text) as Export, text };
    });
}

export function writeExport(ex: Export) {
  mkdirSync(RAW, { recursive: true });
  // Written aside and moved in, so a run that stops halfway never leaves a broken file.
  const tmp = new URL(`${ex.datasetId}.json.tmp`, RAW);
  writeFileSync(tmp, JSON.stringify(ex));
  renameSync(tmp, new URL(`${ex.datasetId}.json`, RAW));
}
