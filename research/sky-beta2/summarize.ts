// β2 の最初の比較の表（results.md の数字）：β1（今の空の絵の晴天大気）と OpenGL 参照（Bruneton、radiance）を、同じ視線で並べる。
// npx tsx research/sky-beta2/summarize.ts research/sky-beta2/webgl/data/ref.json [web.json]
// - 色：参照は放射輝度（680・550・440 nm）を白（太陽スペクトル）で割り 1 − exp(−E·L)（E は 3 事例で同じ 10）→ sRGB。β1 は表示の色のまま
// - 暖かさ：線形の (R − B) / (R + G + B)。色の向きを明るさと切り離して比べる（β1 も線形に戻して同じ式）
import { readFileSync } from "node:fs";
import { skyAt } from "../../shared/sky";
import { type SceneInput, skyRgb, skyWeatherFrom } from "../../shared/skyScene";

type Ref = { meta: { radiance: { white_point: string[] } }; cases: Record<string, Record<string, { radiance: number[]; transmittance: number[] }>> };
const ref = JSON.parse(readFileSync(process.argv[2], "utf8")) as Ref;
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8")) as {
  cases: { id: string; time: string; sunAlt: number; sunAz: number; views: { id: string; diff: number | null; az: number; alt: number }[] }[];
};
const web = process.argv[3] ? (JSON.parse(readFileSync(process.argv[3], "utf8")) as { results: { id: string; views: number[] }[] }) : null;
const E = 10;
const WHITE = ref.meta.radiance.white_point[0].split(" ").map(Number);
const srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const tone = (l: number[]) => l.map((x, i) => Math.min(1, Math.max(0, srgb(1 - Math.exp((-Math.max(0, x) / WHITE[i]) * E)))));
const wb = (l: number[]) => l.map((x, i) => x / WHITE[i]);
const hex = (c: number[]) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const warm = (lin: number[]) => {
  const p = lin.map((x) => Math.max(0, x));
  const s = p[0] + p[1] + p[2];
  return s > 0 ? (p[0] - p[2]) / s : 0;
};
const f = (v: number, d = 2) => (v >= 0 ? "+" : "") + v.toFixed(d);

const lines: string[] = [];
lines.push("| 事例 | 視線 | β1 | 参照（同じ露出） | 参照の放射輝度 550 nm（mW/m²/sr/nm） | 暖かさ β1 | 暖かさ 参照 | 透過率 550 nm | WebGL/OpenGL |");
lines.push("|---|---|---|---|---|---|---|---|---|");
for (const c of cases.cases) {
  const scene: SceneInput = { clear: skyAt(c.sunAlt, 1, 0, true), sunAlt: c.sunAlt, sunAz: c.sunAz, moonAlt: -30, moonAz: 0, moonLit: 0, wx: skyWeatherFrom([], 1, "47893"), seed: 1 };
  c.views.forEach((v, k) => {
    if (!(v.id === "zenith" || ([0, 90, 180].includes(v.diff ?? -1) && [3, 20].includes(v.alt)))) return;
    const r = ref.cases[c.id][v.id];
    const b1 = skyRgb(scene, v.az, v.alt);
    const name = v.id === "zenith" ? "天頂" : `${v.diff === 0 ? "太陽側" : v.diff === 90 ? "横" : "反対側"} ${v.alt}°`;
    const w = web?.results.find((x) => x.id === c.id);
    const ratio = w ? (w.views[k * 3 + 1] / r.radiance[1]).toFixed(4) : "—";
    lines.push(
      `| ${c.id}（${c.sunAlt.toFixed(1)}°） | ${name} | ${hex(b1)} | ${hex(tone(r.radiance))} | ${(r.radiance[1] * 1000).toFixed(2)} | ${f(warm(b1.map(toLin)))} | ${f(warm(wb(r.radiance)))} | ${r.transmittance[1].toFixed(3)} | ${ratio} |`,
    );
  });
}
// 太陽側と反対側の輝度の比（同じ高さ 3°）、方位を回したときの暖かさ（高さ 3°）
const ext: string[] = ["", "| 事例 | 高さ 3° の方位差ごとの暖かさ（参照） 0°・30°・60°・90°・100°・120°・150°・180° | 同じく β1 | 太陽側 / 反対側 の 550 nm（参照） |", "|---|---|---|---|"];
for (const c of cases.cases) {
  const scene: SceneInput = { clear: skyAt(c.sunAlt, 1, 0, true), sunAlt: c.sunAlt, sunAz: c.sunAz, moonAlt: -30, moonAz: 0, moonLit: 0, wx: skyWeatherFrom([], 1, "47893"), seed: 1 };
  const row = c.views.filter((v) => v.alt === 3 && v.diff != null);
  const rw = row.map((v) => f(warm(wb(ref.cases[c.id][v.id].radiance)))).join(" ");
  const bw = row.map((v) => f(warm(skyRgb(scene, v.az, v.alt).map(toLin)))).join(" ");
  const ratio = ref.cases[c.id]["d0-a3"].radiance[1] / ref.cases[c.id]["d180-a3"].radiance[1];
  ext.push(`| ${c.id} | ${rw} | ${bw} | ${ratio.toFixed(1)} 倍 |`);
}
console.log([...lines, ...ext].join("\n"));
