import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Read a file from test/fixtures (tests run from the repository root). */
export const fixture = (name: string): string => readFileSync(resolve("test/fixtures", name), "utf8");

export const fixtureJson = <T>(name: string): T => JSON.parse(fixture(name)) as T;
