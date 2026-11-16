// The coast the typhoon sheet draws on (#220): Natural Earth's land (1:10m, public domain), as
// packaged by world-atlas 2.0.2 (land-10m.json, TopoJSON), cut to the seas around Japan and thinned
// to about 2 km. Run once by hand; the output is kept in the repository (public/data/coast-japan.json).
//
//   npm pack world-atlas@2.0.2 && tar xzf world-atlas-2.0.2.tgz
//   npx --yes tsx@4.19.2 scripts/coast.ts package/land-10m.json public/data/coast-japan.json
//
// 出典：Natural Earth（パブリックドメイン）。

import { readFileSync, writeFileSync } from "node:fs";

const [src, out] = process.argv.slice(2);
const BOX = { w: 116, e: 158, s: 16, n: 52 };
/** Points closer than this to the last kept one are dropped (degrees; about 2 km). */
const STEP = 0.02;

interface Topo {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: {
    land: {
      geometries: { type: string; arcs: number[][][] | number[][][][] }[];
    };
  };
}
const topo = JSON.parse(readFileSync(src, "utf8")) as Topo;
const { scale, translate } = topo.transform;
// The arcs, delta-decoded into lon/lat.
const arcs = topo.arcs.map((a) => {
  let x = 0;
  let y = 0;
  return a.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
});
const arc = (i: number) => (i < 0 ? [...arcs[~i]].reverse() : arcs[i]);
const ring = (ids: number[]) =>
  ids.flatMap((i, k) => (k ? arc(i).slice(1) : arc(i)));

const rings: number[][] = [];
for (const g of topo.objects.land.geometries) {
  const polys = (g.type === "Polygon" ? [g.arcs] : g.arcs) as number[][][];
  for (const poly of polys)
    for (const ids of poly) {
      const pts = ring(ids);
      if (
        !pts.some(([x, y]) => x > BOX.w && x < BOX.e && y > BOX.s && y < BOX.n)
      )
        continue;
      // Points outside the box are pulled onto its edge (the ring stays closed), then thinned.
      const kept: number[][] = [];
      for (const [x0, y0] of pts) {
        const p = [
          Math.min(BOX.e, Math.max(BOX.w, x0)),
          Math.min(BOX.n, Math.max(BOX.s, y0)),
        ];
        const q = kept[kept.length - 1];
        if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= STEP) kept.push(p);
      }
      const xs = kept.map((p) => p[0]);
      const ys = kept.map((p) => p[1]);
      if (
        kept.length < 4 ||
        Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) <
          0.08
      )
        continue;
      // lon, lat ×100 as integers, one flat list per ring.
      rings.push(
        kept.flatMap(([x, y]) => [Math.round(x * 100), Math.round(y * 100)]),
      );
    }
}
writeFileSync(
  out,
  JSON.stringify({
    v: 1,
    source: "Natural Earth（1:10m、パブリックドメイン）",
    box: BOX,
    rings,
  }),
);
console.log(
  `${rings.length} rings, ${rings.reduce((n, r) => n + r.length / 2, 0)} points`,
);
