// Writes docs/model-map.md from the catalog (#189): npm run model-map
import { writeFileSync } from "node:fs";
import { CATALOG } from "../src/model/catalog";
import { modelMap } from "../src/model/map";
writeFileSync(new URL("../docs/model-map.md", import.meta.url), modelMap(CATALOG) + "\n");
console.log("docs/model-map.md を書きました");
