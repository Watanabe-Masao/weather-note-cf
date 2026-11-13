// 空の色（模式）のカラーチャート：資料（research/sky/model.md）。shared/sky.ts の skyTrace から作る。
// Run:  research/data/node_modules/.bin/vite-node research/sky/write-colour-chart.ts   (writes research/sky/colour-chart.html)
// test/data/sky.test.ts checks that the committed chart matches the code (regenerate after changing shared/sky.ts).

import { CLOUD, rainFactor } from "../../shared/brightness";
import { SKY_GLOW, skyTrace } from "../../shared/sky";

/** The conditions across: clear, partly sunny, overcast, light and heavy rain (cloud factor, mm). */
export const CHART_CONDS: [string, number, number][] = [
  ["晴れ", CLOUD.clear, 0],
  ["半分晴れ", CLOUD.cloudy ** 0.5, 0],
  ["曇り", CLOUD.cloudy, 0],
  ["小雨 0.5mm", rainFactor(0.5), 0.5],
  ["強い雨 20mm", rainFactor(20), 20],
];
/** The sun's altitudes down (degrees, with a note). The day grid is drawn for 住宅地 (alpha 0.2). */
export const CHART_ALTS: [number, string][] = [[60, "夏の昼"], [38, "冬の昼"], [20, ""], [10, "朝・夕"], [4, ""], [1, "日の出入り"], [-2, ""], [-5, "市民薄明"], [-8, "航海薄明"], [-12, ""], [-30, "夜"]];

/** The chart's data: the day grid and the night by surroundings, each cell with its trace. */
export function colourChartData() {
  const grid = CHART_ALTS.map(([a, l]) => ({ alt: a, label: l, cells: CHART_CONDS.map(([, f, mm]) => skyTrace(a, f, mm, true, 0.2)) }));
  const night = SKY_GLOW.map((g) => ({ label: g.label, cells: CHART_CONDS.map(([, f, mm]) => skyTrace(-30, f, mm, true, g.alpha)) }));
  return { conds: CHART_CONDS.map((c) => c[0]), grid, night };
}

const TEMPLATE = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>空の色の追跡</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root{--bg:#f4f6fa;--surface:#ffffff;--inset:#e8edf4;--ink:#16202c;--ink2:#4c5b6c;--line:#d3dbe6;--accent:#2563c9;--warn:#9a5b00;--warn-bg:#fff1d6;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0a1420;--surface:#15243a;--inset:#0d1826;--ink:#eaf0f7;--ink2:#a9b9cb;--line:#2a3f58;--accent:#7cc4ff;--warn:#f5c865;--warn-bg:#3a2f12;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0a1420;--surface:#15243a;--inset:#0d1826;--ink:#eaf0f7;--ink2:#a9b9cb;--line:#2a3f58;--accent:#7cc4ff;--warn:#f5c865;--warn-bg:#3a2f12;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;line-height:1.6}
.wrap{max-width:1040px;margin:0 auto;padding-block:24px 48px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:18px}
h1{font-size:22px;margin:0;text-wrap:balance}h2{font-size:15px;margin:0}
p{margin:0;color:var(--ink2);font-size:13px;max-width:68ch}
.layout{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start}
.tables{flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:14px}
.scroll{overflow-x:auto;border-radius:12px;background:var(--surface);padding:10px}
table{border-collapse:separate;border-spacing:4px;min-width:520px;width:100%}
th{font-size:11px;color:var(--ink2);font-weight:600;text-align:left;white-space:nowrap}
th small{display:block;font-weight:400}
td{padding:0}
.cell{display:block;width:100%;min-width:72px;height:46px;border-radius:7px;border:1px solid rgba(127,127,127,.25);cursor:pointer;padding:0;position:relative}
.cell[aria-pressed="true"]{outline:3px solid var(--accent);outline-offset:1px}
.cell span{position:absolute;left:4px;bottom:3px;font-size:10px;padding:0 4px;border-radius:4px;background:rgba(0,0,0,.45);color:#fff}
.panel{flex:1 1 320px;min-width:0;background:var(--surface);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;position:sticky;top:env(safe-area-inset-top,0px)}
.panel h2 small{font-weight:400;color:var(--ink2);font-size:12px;margin-left:6px}
.step{display:grid;grid-template-columns:44px minmax(0,1fr);gap:10px;align-items:start;padding-top:10px;border-top:1px solid var(--line)}
.sw{width:44px;height:52px;border-radius:7px;border:1px solid rgba(127,127,127,.25)}
.step b{font-size:13px}.step .n{font-size:12px;color:var(--ink);margin-top:2px}.step .s{font-size:11px;color:var(--ink2)}
.tag{display:inline-block;font-size:10px;font-weight:700;padding:0 6px;border-radius:4px;background:var(--warn-bg);color:var(--warn);margin-left:6px;letter-spacing:.04em}
.hex{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink2)}
.tabs{display:flex;gap:6px;flex-wrap:wrap}
.tabs button{min-height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink2);font:inherit;font-size:13px;cursor:pointer}
.tabs button[aria-selected="true"]{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:700}
</style>
</head>
<body>
<div class="wrap">
  <h1>空の色の追跡</h1>
  <p>Weather Note の「明るさと空」の帯の色（模式）を、条件ごとに並べた資料です（\`research/sky/colour-chart.ts\` で \`shared/sky.ts\` から作る。手で直さない）。マスを押すと、その色が5段階（基準色 → 雲・雨 → 街の明かり → 明るさ → 鮮やかさ）でどう作られたか、式の数値と根拠が右（狭い画面では下）に出ます。「仮」は文献や実測ではなく、仮に置いた値です。最後の段階より前の色は、色合いが見えるよう同じ明るさで表示しています。</p>
  <div class="tabs" role="tablist" aria-label="表">
    <button role="tab" id="t-grid" aria-selected="true">太陽の高さ × 雲・雨（住宅地）</button>
    <button role="tab" id="t-night" aria-selected="false">夜（−30°）× 周りの様子</button>
  </div>
  <div class="layout">
    <div class="tables"><div class="scroll"><table id="table"></table></div></div>
    <aside class="panel" id="panel" aria-live="polite"></aside>
  </div>
</div>
<script>
const D = __DATA__;
let view = "grid", sel = { r: 3, c: 0 };
const esc = (t) => String(t).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m]);
const grad = (z, h) => \`linear-gradient(180deg, \${z} 0 60%, \${h} 60% 100%)\`;
function rows() { return view === "grid" ? D.grid.map((g) => ({ head: \`\${g.alt > 0 ? "+" : ""}\${g.alt}°\`, sub: g.label, cells: g.cells })) : D.night.map((g) => ({ head: g.label, sub: "", cells: g.cells })); }
function draw() {
  const rs = rows();
  if (sel.r >= rs.length) sel.r = 0;
  let h = \`<tr><th>\${view === "grid" ? "太陽の高さ" : "周りの様子"}</th>\${D.conds.map((c) => \`<th>\${esc(c)}</th>\`).join("")}</tr>\`;
  rs.forEach((r, i) => {
    h += \`<tr><th>\${esc(r.head)}<small>\${esc(r.sub)}</small></th>\`;
    r.cells.forEach((t, j) => {
      h += \`<td><button class="cell" data-r="\${i}" data-c="\${j}" aria-pressed="\${i === sel.r && j === sel.c}" aria-label="\${esc(r.head + " " + D.conds[j] + "：" + t.sky.word)}" style="background:\${grad(t.sky.zenith, t.sky.horizon)}"><span>\${esc(t.sky.word)}</span></button></td>\`;
    });
    h += "</tr>";
  });
  document.getElementById("table").innerHTML = h;
  const r = rs[sel.r], t = r.cells[sel.c];
  let p = \`<h2>\${esc(r.head)}・\${esc(D.conds[sel.c])}<small>\${esc(t.sky.word)}</small></h2><div class="hex">天頂 \${t.sky.zenith}・地平 \${t.sky.horizon}</div>\`;
  t.steps.forEach((s, k) => {
    p += \`<div class="step"><div class="sw" style="background:\${grad(s.zenith, s.horizon)}"></div><div><b>\${k + 1}. \${esc(s.label)}</b>\${s.provisional ? '<span class="tag">仮</span>' : ""}<div class="n">\${esc(s.note)}</div><div class="s">\${esc(s.source)}</div></div></div>\`;
  });
  document.getElementById("panel").innerHTML = p;
}
document.getElementById("table").addEventListener("click", (e) => {
  const b = e.target.closest(".cell"); if (!b) return;
  sel = { r: +b.dataset.r, c: +b.dataset.c }; draw();
});
for (const [id, v] of [["t-grid", "grid"], ["t-night", "night"]]) document.getElementById(id).addEventListener("click", () => {
  view = v; sel = { r: v === "grid" ? 3 : 1, c: 0 };
  document.getElementById("t-grid").setAttribute("aria-selected", v === "grid");
  document.getElementById("t-night").setAttribute("aria-selected", v === "night");
  draw();
});
draw();
</script>

</body>
</html>
`;

/** The chart as one self-contained HTML page. */
export function colourChartHtml(): string {
  return TEMPLATE.replace("__DATA__", JSON.stringify(colourChartData()).replace(/<\//g, "<\\/"));
}
