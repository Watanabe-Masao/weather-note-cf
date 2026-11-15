// The smallest of a function by Nelder–Mead: no derivatives, a few parameters — enough for the
// learned versions' handful of numbers. Deterministic: the same start, the same result.

import { NELDER_MEAD } from "./constants";

export function minimize(f: (x: number[]) => number, start: number[], step: number, iterations: number, tolerance: number): number[] {
  const n = start.length;
  let simplex = [start, ...start.map((_, i) => start.map((v, j) => (i === j ? v + step : v)))].map((x) => ({ x, y: f(x) }));
  for (let it = 0; it < iterations; it++) {
    simplex.sort((a, b) => a.y - b.y);
    if (Math.abs(simplex[n].y - simplex[0].y) < tolerance) break;
    const centroid = start.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const along = (t: number) => centroid.map((c, j) => c + t * (simplex[n].x[j] - c));
    const r = along(-NELDER_MEAD.reflect);
    const yr = f(r);
    if (yr < simplex[0].y) {
      const e = along(-NELDER_MEAD.expand);
      const ye = f(e);
      simplex[n] = ye < yr ? { x: e, y: ye } : { x: r, y: yr };
    } else if (yr < simplex[n - 1].y) {
      simplex[n] = { x: r, y: yr };
    } else {
      const c = along(NELDER_MEAD.contract);
      const yc = f(c);
      if (yc < simplex[n].y) simplex[n] = { x: c, y: yc };
      else simplex = simplex.map((p, i) => (i === 0 ? p : ((x) => ({ x, y: f(x) }))(p.x.map((v, j) => simplex[0].x[j] + NELDER_MEAD.shrink * (v - simplex[0].x[j])))));
    }
  }
  simplex.sort((a, b) => a.y - b.y);
  return simplex[0].x;
}
