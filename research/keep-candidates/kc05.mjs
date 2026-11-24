// KC-05：アメダスの天気の番号と、過去の気象データ（時別値）の天気（絵の alt の文字）を、同じ時間で突き合わせる（高知）。
// アメダスの JSON（約10日分）と時別値の表を日ごとに読み、番号 → 文字の組の数だけを出す。中身は保存しない。
const UA = { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); const t = await r.text(); await sleep(1000); return { s: r.status, t }; } catch (e) { await sleep(1000); return { s: 0, t: "" }; } };
const pairs = new Map();
const add = (k) => pairs.set(k, (pairs.get(k) ?? 0) + 1);
console.log("# KC-05", new Date().toISOString());
const now = Date.now();
for (let back = 1; back <= 9; back++) {
  const d = new Date(now + 9 * 3600e3 - back * 86400e3);
  const ymd = d.toISOString().slice(0, 10);
  const c = ymd.replaceAll("-", "");
  // アメダス：その日の 00〜21 時の8ファイルと、翌日の 00 時（24時の値）。
  const code = {};
  for (const h of ["00", "03", "06", "09", "12", "15", "18", "21"]) {
    const r = await get(`https://www.jma.go.jp/bosai/amedas/data/point/74182/${c}_${h}.json`);
    if (r.s !== 200) continue;
    for (const [k, v] of Object.entries(JSON.parse(r.t))) if (Array.isArray(v.weather) && k.endsWith("0000")) code[+k.slice(8, 10)] = v.weather;
  }
  // 時別値：1〜24時、天気の列（絵の alt）。
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
  const e = await get(`https://www.data.jma.go.jp/stats/etrn/view/hourly_s1.php?prec_no=74&block_no=47893&year=${y}&month=${m}&day=${dd}&view=`);
  const rows = [...e.t.matchAll(/<tr class="mtx"[^>]*>([\s\S]*?)<\/tr>/g)].map((x) => [...x[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]));
  let matched = 0;
  for (const r of rows) {
    const hour = +r[0]?.replace(/<[^>]+>/g, "");
    if (!(hour >= 1 && hour <= 24)) continue;
    const alt = r.map((c) => c.match(/alt="([^"]*)"/)?.[1]).find((a) => a && a !== "") ?? "";
    // アメダスの番号は、その時刻（正時）の値。時別値の n 時は n 時の値（アメダスの n 時と同じ時刻とみる）。
    const cd = code[hour % 24 === 0 ? 0 : hour];
    if (hour === 24) continue; // 24時は翌日の 00 時のファイル。今回は省く
    if (!cd) continue;
    add(`${cd[0]}(${cd[1]}) → ${alt || "(空)"}`);
    matched++;
  }
  console.log(`${ymd}: amedas hours ${Object.keys(code).length}, etrn rows ${rows.length}, matched ${matched}`);
}
console.log("\n## pairs (番号(品質) → 時別値の天気: 回数)");
for (const [k, n] of [...pairs].sort()) console.log(`${k}: ${n}`);
console.log("\n# end");
