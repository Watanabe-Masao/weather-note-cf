// KC-04 pass 4: そらまめくんの画面の JavaScript から、API の説明（URL の形・引数）を探す。中身は保存しない。
const UA = { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" };
const r = await fetch("https://soramame.env.go.jp/js/app.c4669626.js", { headers: UA });
const t = await r.text();
console.log("# KC-04d", r.status, t.length);
for (const re of [/https?:\/\/[^"'`\s]*soramame[^"'`\s]*/g, /["'`](\/soramame\/[^"'`]{0,120})["'`]/g, /["'`]([^"'`]{0,40}(?:api|Api|API)[^"'`]{0,80})["'`]/g, /Start_YM|TDFKN_CD|SKT_CD|REQUEST_DATA|Time|ITEM[^"'`]{0,40}/g]) {
  const found = [...new Set([...t.matchAll(re)].map((m) => m[1] ?? m[0]))].slice(0, 40);
  console.log(`\n## ${re}\n${found.join("\n")}`);
}
// API の説明の文（日本語）を前後ごと。
for (const w of ["APIの", "パラメータ", "リクエスト", "取得できる", "JSON", "CSV"]) {
  let i = -1, n = 0;
  while ((i = t.indexOf(w, i + 1)) >= 0 && n < 4) { console.log(`\n[${w}] ${t.slice(Math.max(0, i - 200), i + 300).replace(/\s+/g, " ")}`); n++; }
}
console.log("\n# end");
