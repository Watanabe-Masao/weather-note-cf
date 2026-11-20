// 端末の傾き（横向き・斜め）の確かめ：DeviceOrientation の alpha・beta・gamma（W3C、Z−X'−Y'' の内因的な回転）から
// 回転行列 R（端末の座標 → 地面の座標：X 東・Y 北・Z 上）を作り、背面カメラの方位・高さと、画面の回り（ロール）を出す。
// 画面の向き（screen.orientation.angle）で「画面の上」を端末の軸から選び直す。
//   node research/moon-appearance/orientation.mjs
const RAD = Math.PI / 180;
const norm = (d) => ((d % 360) + 360) % 360;

/** W3C の定義どおり R = Rz(α)·Rx(β)·Ry(γ)。列は端末の x・y・z 軸が地面の座標でどこを向くか。 */
export function matrix(a, b, g) {
  const [ca, sa, cb, sb, cg, sg] = [Math.cos(a * RAD), Math.sin(a * RAD), Math.cos(b * RAD), Math.sin(b * RAD), Math.cos(g * RAD), Math.sin(g * RAD)];
  return [
    [ca * cg - sa * sb * sg, -cb * sa, ca * sg + cg * sa * sb],
    [cg * sa + ca * sb * sg, ca * cb, sa * sg - ca * cg * sb],
    [-cb * sg, sb, cb * cg],
  ];
}
const col = (R, v) => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };

/**
 * 背面カメラの方位（真北 0、時計回り）・高さ・画面の回り（°、画面の上が右へ傾くと正）。
 * angle：screen.orientation.angle（0・90・180・270、反時計回りに回した画面で 90）。
 * 方位は absolute な alpha（北が基準）のとき。真上・真下（|高さ| > 89.9°）では方位とロールは決まらない（null）。
 */
export function look(R, angle) {
  const f = col(R, [0, 0, -1]);
  const th = angle * RAD;
  // 画面の中身の上・右（端末の軸で）：上 = cosθ·y + sinθ·x、右 = cosθ·x − sinθ·y
  const upDev = [Math.sin(th), Math.cos(th), 0];
  const U = col(R, upDev);
  const altitude = Math.asin(Math.max(-1, Math.min(1, f[2]))) / RAD;
  if (Math.abs(altitude) > 89.9) return { azimuth: null, altitude, roll: null };
  const azimuth = norm(Math.atan2(f[0], f[1]) / RAD);
  const u0 = unit([-f[2] * f[0], -f[2] * f[1], 1 - f[2] * f[2]]);
  const r0 = cross(f, u0);
  const roll = Math.atan2(dot(U, r0), dot(U, u0)) / RAD;
  return { azimuth, altitude, roll };
}

/** R から W3C の alpha・beta・gamma を戻す（beta は −180〜180、gamma は −90〜90）。 */
export function euler(R) {
  let b = Math.asin(Math.max(-1, Math.min(1, R[2][1])));
  let a, g;
  if (Math.abs(Math.cos(b)) > 1e-9) {
    a = Math.atan2(-R[0][1], R[1][1]);
    g = Math.atan2(-R[2][0], R[2][2]);
  } else { a = Math.atan2(R[1][0], R[0][0]); g = 0; }
  // gamma を −90〜90 に収める（同じ姿勢のもう一つの組：beta → ±180 − beta、gamma → gamma ∓ 180、alpha → alpha + 180）
  if (Math.abs(g) > Math.PI / 2) {
    b = (b >= 0 ? Math.PI : -Math.PI) - b;
    g = g > 0 ? g - Math.PI : g + Math.PI;
    a = a + Math.PI;
  }
  const bd = b / RAD >= 180 ? b / RAD - 360 : b / RAD;
  return [norm(a / RAD), bd, g / RAD];
}

const show = (name, R, angle) => {
  const e = euler(R).map((v) => v.toFixed(1)).join(", ");
  const l = look(R, angle);
  console.log(`| ${name} | ${angle} | ${e} | ${l.azimuth == null ? "—" : l.azimuth.toFixed(1)} | ${l.altitude.toFixed(1)} | ${l.roll == null ? "—" : l.roll.toFixed(1)} |`);
};
const byCols = (x, y, z) => [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("| 持ち方 | angle | alpha, beta, gamma（R から戻した値） | 方位 | 高さ | ロール |\n|---|---|---|---|---|---|");
  // 縦・まっすぐ立てて北を向く：端末 x→東、y→上、z（画面の表）→南
  show("縦・北・水平", byCols([1, 0, 0], [0, 0, 1], [0, -1, 0]), 0);
  // 横（反時計回り、上が左＝西）・北：x→上、y→西、z→南
  show("横（左回し）・北・水平", byCols([0, 0, 1], [-1, 0, 0], [0, -1, 0]), 90);
  // 横（時計回り、上が右＝東）・北：x→下、y→東、z→南
  show("横（右回し）・北・水平", byCols([0, 0, -1], [1, 0, 0], [0, -1, 0]), 270);
  // 横（左回し）で東を向き、30°見上げる
  { const f = [Math.cos(30 * RAD), 0, Math.sin(30 * RAD)]; const up = [-Math.sin(30 * RAD), 0, Math.cos(30 * RAD)]; const y = [0, 1, 0];
    show("横（左回し）・東・30°見上げ", byCols(up, y, f.map((v) => -v)), 90); }
  // 縦で 10° 右に傾けて北
  { const r = 10 * RAD; show("縦・北・右へ10°傾け", byCols([Math.cos(r), 0, -Math.sin(r)], [Math.sin(r), 0, Math.cos(r)], [0, -1, 0]), 0); }
  // 真上の近く：縦で北を向き 89.5° 見上げる → beta は 179.5 付近、alpha・gamma は不安定でも、R からの方位は続く
  for (const h of [85, 89.5, 89.95]) {
    const s = Math.sin(h * RAD), c = Math.cos(h * RAD);
    show(`縦・北・${h}°見上げ`, byCols([1, 0, 0], [0, -s, c], [0, -c, -s]), 0);
  }
  // beta = 90 の近く（縦に立てた姿勢）で、alpha と gamma が入れ替わること：同じ姿勢を2通りの角で
  const R1 = matrix(30, 89.99, 0), R2 = matrix(60, 89.99, -30);
  console.log(`\nbeta 89.99 の近く：(30, 89.99, 0) と (60, 89.99, −30) の行列の差の最大 ${Math.max(...R1.flat().map((v, i) => Math.abs(v - R2.flat()[i]))).toFixed(4)}`);
  console.log(`  方位：${look(R1, 0).azimuth.toFixed(2)} と ${look(R2, 0).azimuth.toFixed(2)}`);
}
