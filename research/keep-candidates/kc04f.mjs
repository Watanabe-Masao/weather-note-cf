// KC-04 pass 6: そらまめくんの API で高知県（39）の今月の1時間値を一度だけ取り、測定局ごとの項目の有無だけを数える。
const UA = { "user-agent": "weather-note research (github.com/Watanabe-Masao/weather-note-cf)" };
const now = new Date(Date.now() + 9 * 3600e3);
const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const url = `https://soramame.env.go.jp/soramame/api/data_search?Start_YM=${ym}&End_YM=${ym}&TDFKN_CD=39&REQUEST_DATA=PM2_5,OX,SPM,NO2,WD,WS,TEMP,HUM`;
console.log("# KC-04f", url);
const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
const t = await r.text();
console.log(`HTTP ${r.status} ${r.headers.get("content-type")} ${t.length}B head: ${t.slice(0, 400)}`);
try {
  const j = JSON.parse(t);
  const rows = Array.isArray(j) ? j : Object.values(j).find(Array.isArray) ?? [];
  console.log(`rows ${rows.length}; keys ${Object.keys(rows[0] ?? {}).join(",")}`);
  const by = {};
  for (const x of rows) {
    const k = x["測定局コード"] ?? x.SKT_CD ?? x.stationCode ?? JSON.stringify(x).slice(0, 30);
    by[k] ??= { n: 0, filled: {}, first: null, last: null, sample: x };
    const b = by[k]; b.n++;
    for (const [f, v] of Object.entries(x)) if (v !== null && v !== "" && v !== undefined) b.filled[f] = (b.filled[f] ?? 0) + 1;
  }
  for (const [k, b] of Object.entries(by)) console.log(`\n${k}: rows ${b.n} filled ${JSON.stringify(b.filled)}\n  sample ${JSON.stringify(b.sample).slice(0, 300)}`);
} catch (e) { console.log("parse: " + e); }
console.log("\n# end");
