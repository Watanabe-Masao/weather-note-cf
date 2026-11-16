// Builds public/data/typhoon-tracks.json (shared/typhoon.ts compactTracks) from JMA's RSMC Tokyo best
// track text (bst_all.txt, unpacked from bst_all.zip). Run by the "typhoon-tracks" workflow, which
// downloads the zip, runs this, and puts the file on a branch for a pull request.
//   npx --yes tsx@4.19.2 scripts/typhoon-tracks.ts bst_all.txt public/data/typhoon-tracks.json
// 出典：気象庁 RSMC Tokyo ベストトラック。

import { readFileSync, writeFileSync } from "node:fs";
import { FIRST_DAY } from "../shared/dates";
import { compactTracks, parseBestTrack } from "../shared/typhoon";

const [src, dst] = process.argv.slice(2);
if (!src || !dst) throw new Error("usage: typhoon-tracks.ts <bst_all.txt> <out.json>");
// From the year before the first day the app reads (a storm of late December reaches into January).
const first = Number(FIRST_DAY.slice(0, 4)) - 1;
const storms = parseBestTrack(readFileSync(src, "latin1")).filter((s) => s.year >= first);
const out = compactTracks(storms, new Date().toISOString());
const text = JSON.stringify(out);
writeFileSync(dst, text);
console.log(`${out.storms.length} storms (of ${storms.length} since ${first}), ${(text.length / 1024).toFixed(0)} kB`);
