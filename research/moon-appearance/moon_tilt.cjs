// 月の傾き（光っている縁が空のどちらを向くか）と見かけの大きさの確かめ。Astronomy Engine 2.1.19。
//   NODE_PATH=<astronomy-engine のある node_modules> node research/moon-appearance/moon_tilt.cjs
// A：Meeus 48章の χ（輝縁の位置角）と 14章の q（パララクティック角）から、天頂からの角 χ − q。
// B：地平の座標（東・北・上）で、月の方向に垂直な面へ太陽の方向を写し、画面の「上」からの角を直接出す。
const A = require("astronomy-engine");
const RAD = Math.PI / 180;
const norm = (d) => ((d % 360) + 360) % 360;
const signed = (d) => ((norm(d) + 180) % 360) - 180;

function geoEqd(body, t) {
  // 地球の中心から見た、その日の赤道座標（赤経・赤緯、°）
  const v = A.GeoVector(body, t, true);
  const r = A.RotateVector(A.Rotation_EQJ_EQD(t), v);
  const e = A.EquatorFromVector(r);
  return { ra: e.ra * 15, dec: e.dec, dist: e.dist };
}
function chi(sun, moon) {
  // Meeus (48.5)：tan χ = cos δ0 sin(α0−α) / (sin δ0 cos δ − cos δ0 sin δ cos(α0−α))
  const d = (sun.ra - moon.ra) * RAD;
  return norm(Math.atan2(Math.cos(sun.dec * RAD) * Math.sin(d), Math.sin(sun.dec * RAD) * Math.cos(moon.dec * RAD) - Math.cos(sun.dec * RAD) * Math.sin(moon.dec * RAD) * Math.cos(d)) / RAD);
}
function parallactic(t, lat, lon, ra, dec) {
  // Meeus (14.1)：tan q = sin H / (tan φ cos δ − sin δ cos H)、H は地方時角
  const H = (A.SiderealTime(t) * 15 + lon - ra) * RAD;
  return Math.atan2(Math.sin(H), Math.tan(lat * RAD) * Math.cos(dec * RAD) - Math.sin(dec * RAD) * Math.cos(H)) / RAD;
}
const vec = (az, alt) => [Math.cos(alt * RAD) * Math.sin(az * RAD), Math.cos(alt * RAD) * Math.cos(az * RAD), Math.sin(alt * RAD)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };

function tiltB(t, obs) {
  const em = A.Equator(A.Body.Moon, t, obs, true, true);
  const es = A.Equator(A.Body.Sun, t, obs, true, true);
  const hm = A.Horizon(t, obs, em.ra, em.dec, "normal");
  const hs = A.Horizon(t, obs, es.ra, es.dec, "normal");
  const f = vec(hm.azimuth, hm.altitude);
  const s = vec(hs.azimuth, hs.altitude);
  const up = unit([0 - f[2] * f[0], 0 - f[2] * f[1], 1 - f[2] * f[2]]); // 天頂を月の方向に垂直な面へ
  const right = cross(f, up);
  const d = [s[0] - dot(s, f) * f[0], s[1] - dot(s, f) * f[1], s[2] - dot(s, f) * f[2]];
  // 画面の上から、反時計回り（左へ）を正：A の χ − q と同じ向き
  return { angle: norm(Math.atan2(-dot(d, right), dot(d, up)) / RAD), moon: hm, sun: hs, em };
}

// 1. Meeus の例題（1992-04-12 0h TD）の月の赤経と χ
{
  const t = A.MakeTime(new Date(Date.UTC(1992, 3, 12, 0, 0, 0))).AddDays(-A.MakeTime(new Date(Date.UTC(1992, 3, 12))).tt + A.MakeTime(new Date(Date.UTC(1992, 3, 12))).ut);
  const m = geoEqd(A.Body.Moon, t), s = geoEqd(A.Body.Sun, t);
  const il = A.Illumination(A.Body.Moon, t);
  console.log(`1992-04-12 0h TD：月の赤経 ${m.ra.toFixed(6)}°・赤緯 ${m.dec.toFixed(6)}°、χ ${chi(s, m).toFixed(2)}°、輝面比 ${il.phase_fraction.toFixed(4)}`);
}

// 2. 高知（33.5597N, 133.5311E）で、A と B を比べる（2026-11 の毎日 20時・翌 2時 JST）
const lat = 33.5597, lon = 133.5311;
const obs = new A.Observer(lat, lon, 0);
let maxDiff = 0;
const rows = [];
for (let d = 1; d <= 30; d++) for (const hh of [20, 26]) {
  const t = A.MakeTime(new Date(Date.UTC(2026, 10, d, hh - 9, 0, 0)));
  const b = tiltB(t, obs);
  if (b.moon.altitude < 0) continue;
  const m = geoEqd(A.Body.Moon, t), s = geoEqd(A.Body.Sun, t);
  const c = chi(s, m);
  const q = parallactic(t, lat, lon, m.ra, m.dec);
  const a = norm(c - q);
  maxDiff = Math.max(maxDiff, Math.abs(signed(a - b.angle)));
  rows.push(`| 11/${d} ${hh % 24}時 | ${b.moon.altitude.toFixed(1)}° | ${b.moon.azimuth.toFixed(1)}° | ${c.toFixed(1)}° | ${q.toFixed(1)}° | ${a.toFixed(1)}° | ${b.angle.toFixed(1)}° | ${(A.Illumination(A.Body.Moon, t).phase_fraction * 100).toFixed(0)}% |`);
}
console.log("\n| 日時（JST） | 月の高さ | 方位 | χ（地心） | q | A：χ−q | B：地平の座標で直接 | 輝面比 |\n|---|---|---|---|---|---|---|---|");
for (const r of rows.filter((_, i) => i % 4 === 0)) console.log(r);
console.log(`A と B の差の最大：${maxDiff.toFixed(2)}°（${rows.length}回）`);

// 3. 見かけの大きさ：地球の中心から と 観測地から（高さによる違い）
{
  console.log("\n| 日時（JST） | 月の高さ | 地心の距離（km） | 観測地からの距離（km） | 地心の直径 | 観測地からの直径 | 比 |\n|---|---|---|---|---|---|---|");
  for (const [d, hh] of [[24, 18], [24, 21], [24, 23], [25, 1], [25, 4]]) {
    const t = A.MakeTime(new Date(Date.UTC(2026, 10, d, hh - 9, 0, 0)));
    const geo = A.GeoVector(A.Body.Moon, t, true);
    const gkm = Math.hypot(geo.x, geo.y, geo.z) * A.KM_PER_AU;
    const em = A.Equator(A.Body.Moon, t, obs, true, true);
    const hm = A.Horizon(t, obs, em.ra, em.dec, "normal");
    const tkm = em.dist * A.KM_PER_AU;
    const dia = (km) => 2 * Math.asin(1737.4 / km) / RAD * 60;
    console.log(`| 11/${d} ${hh}時 | ${hm.altitude.toFixed(1)}° | ${gkm.toFixed(0)} | ${tkm.toFixed(0)} | ${dia(gkm).toFixed(2)}′ | ${dia(tkm).toFixed(2)}′ | ${(gkm / tkm).toFixed(4)} |`);
  }
}
