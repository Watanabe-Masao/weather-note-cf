// MA-02：代表例の太陽・月の位置（高知、2026-11-20）。Astronomy Engine 2.1.19。JSON を出す（ma02_visibility.py の入力）。
//   NODE_PATH=<astronomy-engine のある node_modules> node research/moon-appearance/ma02_positions.cjs > /tmp/ma02_pos.json
const A = require("astronomy-engine");
const obs = new A.Observer(33.5597, 133.5311, 0);
const RAD = Math.PI / 180;
const out = [];
for (const [label, iso] of [["14時", "2026-11-20T05:00:00Z"], ["15時", "2026-11-20T06:00:00Z"], ["16時半", "2026-11-20T07:30:00Z"], ["17時", "2026-11-20T08:00:00Z"], ["17時半", "2026-11-20T08:30:00Z"], ["18時", "2026-11-20T09:00:00Z"], ["21時", "2026-11-20T12:00:00Z"]]) {
  const t = A.MakeTime(new Date(iso));
  const hor = (b) => { const e = A.Equator(b, t, obs, true, true); return { ...A.Horizon(t, obs, e.ra, e.dec, "normal"), dist: e.dist }; };
  const m = hor(A.Body.Moon), s = hor(A.Body.Sun);
  const v = (h) => [Math.cos(h.altitude * RAD) * Math.sin(h.azimuth * RAD), Math.cos(h.altitude * RAD) * Math.cos(h.azimuth * RAD), Math.sin(h.altitude * RAD)];
  const [a, b] = [v(m), v(s)];
  const sep = Math.acos(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / RAD;
  const il = A.Illumination(A.Body.Moon, t);
  out.push({ label, iso, moonAlt: +m.altitude.toFixed(2), moonAz: +m.azimuth.toFixed(1), sunAlt: +s.altitude.toFixed(2), sunAz: +s.azimuth.toFixed(1), sep: +sep.toFixed(1), phaseAngle: +il.phase_angle.toFixed(1), fraction: +il.phase_fraction.toFixed(3), moonKm: Math.round(m.dist * A.KM_PER_AU) });
}
console.log(JSON.stringify(out, null, 1));
