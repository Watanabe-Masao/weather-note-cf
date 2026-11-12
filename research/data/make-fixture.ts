// npm run fixture: writes raw/ds-fixture.json, a small made-up export, to try the scripts on.
import { writeExport } from "./common";
import { makeExport } from "./fixture";

writeExport(makeExport());
console.log("raw/ds-fixture.json を作りました（作り物のデータ）。");
