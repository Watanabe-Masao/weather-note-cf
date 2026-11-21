// KC-04: what is kept where and for how long — AMeDAS point/map JSON, the past-weather tables
// (hourly / 10-minute) for 高知, the UV index pages, Open-Meteo forecast & air quality, そらまめ君.
// Only status, sizes, times and counts are logged; nothing is saved. Run once by a push to
// research/keep-candidates-2. 出典：気象庁ホームページ、Open-Meteo.com（CAMS）、環境省。
const UA = { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000), redirect: "follow" });
    const t = Buffer.from(await r.arrayBuffer());
    await sleep(1200);
    return { s: r.status, type: r.headers.get("content-type") ?? "", t, loc: r.headers.get("location") ?? "" };
  } catch (e) {
    await sleep(1200);
    return { s: 0, type: String(e), t: Buffer.alloc(0), loc: "" };
  }
}
const jst = (ms) => new Date(ms + 9 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll("-", "");
const now = Date.now();
console.log("# KC-04", new Date().toISOString());

// 1. AMeDAS point JSON (高知 74182), 00 block of each day going back.
if (!process.env.PASS2) {
console.log("\n## 1 amedas point 74182 (block 00 of each day)");
for (const back of [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 20, 30]) {
  const d = ymd(jst(now - back * 86400e3));
  const r = await get(`https://www.jma.go.jp/bosai/amedas/data/point/74182/${d}_00.json`);
  let info = "";
  if (r.s === 200) {
    try {
      const j = JSON.parse(r.t.toString("utf8"));
      const keys = Object.keys(j);
      const vis = keys.filter((k) => Array.isArray(j[k].visibility) && j[k].visibility[1] === 0);
      const wx = keys.filter((k) => Array.isArray(j[k].weather) && j[k].weather[1] === 0);
      const vals = [...new Set(vis.map((k) => j[k].visibility[0]))].slice(0, 8);
      info = `times ${keys.length} (${keys[0]}…${keys.at(-1)}), visibility ok ${vis.length} values ${vals.join("/")}, weather ok ${wx.length} values ${[...new Set(wx.map((k) => j[k].weather[0]))].join("/")}; fields ${Object.keys(j[keys[0]] ?? {}).length}`;
    } catch (e) { info = "parse error " + e; }
  }
  console.log(`-${back}d ${d}: HTTP ${r.s} ${r.t.length}B ${info}`);
}

// 2. AMeDAS map JSON (all stations at one time), 12:00 JST of each day going back.
console.log("\n## 2 amedas map (12:00 JST)");
for (const back of [0, 1, 2, 3, 5, 7, 10, 14, 30]) {
  const d = ymd(jst(now - back * 86400e3));
  const r = await get(`https://www.jma.go.jp/bosai/amedas/data/map/${d}120000.json`);
  let info = "";
  if (r.s === 200) {
    try { const j = JSON.parse(r.t.toString("utf8")); info = `stations ${Object.keys(j).length}, 74182 has visibility: ${!!j["74182"]?.visibility}`; } catch { info = "parse error"; }
  }
  console.log(`-${back}d ${d}: HTTP ${r.s} ${r.t.length}B ${info}`);
}

}
// 3/4. Past-weather tables for 高知 (47893): hourly and 10-minute. Header cells and, per column,
// how many data rows have a value.
function table(html) {
  const ths = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
  const rows = [...html.matchAll(/<tr class="mtx"[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim()))
    .filter((r) => r.length > 3);
  const width = Math.max(0, ...rows.map((r) => r.length));
  const filled = Array.from({ length: width }, (_, i) => rows.filter((r) => r[i] && r[i] !== "--" && r[i] !== "×" && r[i] !== "///").length);
  const sample = Array.from({ length: width }, (_, i) => [...new Set(rows.map((r) => r[i]).filter(Boolean))].slice(0, 3).join("|"));
  return { ths, rows: rows.length, width, filled, sample };
}
for (const kind of ["hourly", "10min"]) {
  console.log(`\n## ${kind === "hourly" ? 3 : 4} etrn ${kind}_s1 高知 47893`);
  for (const back of [3, 30, 400, 2400]) {
    const t = jst(now - back * 86400e3);
    const url = `https://www.data.jma.go.jp/obd/stats/etrn/view/${kind}_s1.php?prec_no=74&block_no=47893&year=${t.getUTCFullYear()}&month=${t.getUTCMonth() + 1}&day=${t.getUTCDate()}&view=`;
    const r = await get(url);
    if (r.s !== 200) { console.log(`-${back}d: HTTP ${r.s}`); continue; }
    const x = table(r.t.toString("utf8"));
    console.log(`-${back}d ${t.toISOString().slice(0, 10)}: rows ${x.rows} width ${x.width}`);
    console.log(`  headers: ${x.ths.join(" / ")}`);
    console.log(`  filled per column: ${x.filled.join(",")}`);
    console.log(`  samples: ${x.sample.map((s, i) => `[${i}]${s}`).join(" ")}`);
  }
}

// 5. UV index (気象庁): the page and the links it gives.
console.log("\n## 5 UV index pages");
for (const u of ["https://www.data.jma.go.jp/env/uvindex/", "https://www.data.jma.go.jp/env/uvhp/info_uv.html"]) {
  const r = await get(u);
  const html = r.t.toString("utf8");
  const links = [...new Set([...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]))].filter((l) => !/\.(css|ico)$/.test(l)).slice(0, 40);
  console.log(`${u}: HTTP ${r.s} ${r.t.length}B ${r.loc}\n  links: ${links.join(" ")}`);
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  console.log(`  scripts: ${scripts.join(" ")}`);
  const urls = [...new Set([...html.matchAll(/["'](\/?[\w./-]*(?:json|csv|txt|png|gif)[^"']*)["']/g)].map((m) => m[1]))].slice(0, 20);
  console.log(`  data-like: ${urls.join(" ")}`);
}

// 6. Open-Meteo: forecast visibility & uv_index, air quality.
console.log("\n## 6 open-meteo");
const LAT = 33.5667, LON = 133.5483;
const om = [
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=visibility,uv_index&past_days=3&forecast_days=16&timezone=Asia%2FTokyo`,
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=visibility&models=jma_seamless&past_days=1&forecast_days=3&timezone=Asia%2FTokyo`,
  `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}&hourly=pm2_5,pm10,dust,aerosol_optical_depth,uv_index&past_days=3&forecast_days=7&timezone=Asia%2FTokyo`,
  `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}&hourly=pm2_5,aerosol_optical_depth&start_date=2022-08-01&end_date=2022-08-02&timezone=Asia%2FTokyo`,
];
for (const u of om) {
  const r = await get(u);
  let info = r.t.toString("utf8").slice(0, 200);
  if (r.s === 200) {
    const j = JSON.parse(r.t.toString("utf8"));
    const h = j.hourly ?? {};
    info = `times ${h.time?.length} (${h.time?.[0]}…${h.time?.at(-1)})` + Object.keys(h).filter((k) => k !== "time").map((k) => {
      const v = h[k].filter((x) => x != null);
      return ` ${k}: ${v.length} non-null, min ${Math.min(...v)} max ${Math.max(...v)}, last non-null ${h.time[h[k].map((x, i) => (x != null ? i : -1)).filter((i) => i >= 0).at(-1)]}`;
    }).join(";");
  }
  console.log(`${u.split("?")[0]} ${u.includes("models=") ? "(jma)" : ""}${u.includes("start_date") ? "(2022-08)" : ""}: HTTP ${r.s} ${info}`);
}

// 7. そらまめ君（環境省）・JMA oxidant / kosa pages: reachability only.
console.log("\n## 7 soramame / oxidant / kosa");
for (const u of ["https://soramame.env.go.jp/", "https://soramame.env.go.jp/robots.txt", "https://soramame.env.go.jp/preview/top", "https://www.data.jma.go.jp/gmd/env/oxidant/index.html", "https://www.data.jma.go.jp/env/kosateller/", "https://www.data.jma.go.jp/env/kosahp/kosa_data_index.html"]) {
  const r = await get(u);
  const html = r.t.toString("utf8");
  const title = html.match(/<title>([^<]*)/)?.[1] ?? "";
  const apiish = [...new Set([...html.matchAll(/["']([^"']*(?:api|json|data)[^"']*)["']/gi)].map((m) => m[1]))].slice(0, 15);
  console.log(`${u}: HTTP ${r.s} ${r.type} ${r.t.length}B ${r.loc} title=${title.trim()}${u.endsWith("robots.txt") && r.s === 200 ? "\n" + html.slice(0, 500) : ""}\n  api-like: ${apiish.join(" ")}`);
}
if (process.env.PASS2) {
// 8 (pass 2). UV scripts, soramame bundle, older air quality.
console.log("\n## 8 UV scripts");
for (const f of ["updatetime_uvi_anal.js", "updatetime_uvi_f.js", "jmahp_uv_a.js", "chiten.js"]) {
  const r = await get(`https://www.data.jma.go.jp/env/uvindex/uvjs/${f}`);
  const t = r.t.toString("utf8");
  const paths = [...new Set([...t.matchAll(/["'`]([^"'`\s]*(?:\.json|\.csv|\.txt|\.png|\.geojson|\.kml|\/data\/)[^"'`\s]*)["'`]/g)].map((m) => m[1]))].slice(0, 25);
  console.log(`${f}: HTTP ${r.s} ${r.t.length}B head=${t.slice(0, 160).replace(/\s+/g, " ")}\n  paths: ${paths.join(" ")}`);
}
console.log("\n## 9 soramame bundle");
{
  const r = await get("https://soramame.env.go.jp/");
  const js = [...r.t.toString("utf8").matchAll(/src=([^ >]+\.js)/g)].map((m) => m[1].replace(/"/g, ""));
  console.log(`scripts: ${js.join(" ")}`);
  for (const j of js.filter((x) => /app|index|main|chunk/.test(x)).slice(0, 4)) {
    const u = j.startsWith("http") ? j : `https://soramame.env.go.jp${j.startsWith("/") ? "" : "/"}${j}`;
    const b = await get(u);
    const t = b.t.toString("utf8");
    const apis = [...new Set([...t.matchAll(/["'`](\/?(?:soramame\/)?api[^"'`]{0,80}|[^"'`]{0,40}\/data\/[^"'`]{0,60}|[^"'`]{0,60}download[^"'`]{0,60})["'`]/gi)].map((m) => m[1]))].slice(0, 30);
    console.log(`${u}: HTTP ${b.s} ${b.t.length}B\n  api-like: ${apis.join(" | ")}`);
  }
}
console.log("\n## 10 air quality history");
for (const d of ["2022-09-01", "2023-01-01", "2024-01-01", "2025-06-01"]) {
  const r = await get(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=33.5667&longitude=133.5483&hourly=pm2_5,aerosol_optical_depth,dust&start_date=${d}&end_date=${d}&timezone=Asia%2FTokyo`);
  const j = r.s === 200 ? JSON.parse(r.t.toString("utf8")) : null;
  const h = j?.hourly ?? {};
  console.log(`${d}: HTTP ${r.s} ` + ["pm2_5", "aerosol_optical_depth", "dust"].map((k) => `${k} ${(h[k] ?? []).filter((x) => x != null).length}/24`).join(" "));
}
{
  const r = await get(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=33.5667&longitude=133.5483&hourly=pm2_5,aerosol_optical_depth&past_days=92&forecast_days=1&timezone=Asia%2FTokyo`);
  const h = r.s === 200 ? JSON.parse(r.t.toString("utf8")).hourly : {};
  const idx = (h.pm2_5 ?? []).map((x, i) => (x != null ? i : -1)).filter((i) => i >= 0);
  console.log(`past_days=92: HTTP ${r.s} pm2_5 non-null ${idx.length}/${h.time?.length}, first ${h.time?.[idx[0]]} last ${h.time?.[idx.at(-1)]}`);
}
}
console.log("\n# end");
