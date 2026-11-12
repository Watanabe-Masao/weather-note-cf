// UTCI, the Universal Thermal Climate Index (Bröde et al. 2012, Int J Biometeorol 56:481): the
// sixth-order polynomial approximation of the UTCI–Fiala model, as published with the index and
// transcribed from pythermalcomfort 4.8.1 (MIT licence; models/utci.py, _utci_optimized). Inputs:
// air temperature t (℃), mean radiant temperature tr (℃), wind at 10 m v (m/s), relative humidity
// rh (%). Valid for −50 ≤ t ≤ 50, tr − t from −30 to +70, 0.5 ≤ v ≤ 17: the wind is held inside its
// range here (calm air still has the body's own convection), the rest is left to the caller.
// test/data/utci.test.ts checks it against values computed with pythermalcomfort.

/** Saturation vapour pressure (hPa) over water at t ℃ (Hardy 1998, as in the UTCI code). */
export function saturationHpa(t: number): number {
  const g = [-2836.5744, -6028.076559, 19.54263612, -0.02737830188, 0.000016261698, 7.0229056e-10, -1.8680009e-13];
  const tk = t + 273.15;
  let es = 2.7150305 * Math.log(tk);
  g.forEach((gi, k) => (es += gi * tk ** (k - 2)));
  return Math.exp(es) * 0.01;
}

export const UTCI_WIND = [0.5, 17] as const;

/** UTCI (℃-equivalent) from air temperature, mean radiant temperature, 10 m wind and humidity. */
export function utci(t: number, tr: number, v: number, rh: number): number {
  const w = Math.min(UTCI_WIND[1], Math.max(UTCI_WIND[0], v));
  return poly(t, w, tr - t, (saturationHpa(t) * (rh / 100)) / 10);
}

function poly(t: number, v: number, d: number, pa: number): number {
  return (
    t
    + 0.607562052
    + (-0.0227712343) * t
    + 8.06470249e-4 * t * t
    + -1.54271372e-4 * t * t * t
    + -3.24651735e-6 * t * t * t * t
    + 7.32602852e-8 * t * t * t * t * t
    + 1.35959073e-9 * t * t * t * t * t * t
    + (-2.25836520) * v
    + 0.0880326035 * t * v
    + 0.00216844454 * t * t * v
    + -1.53347087e-5 * t * t * t * v
    + -5.72983704e-7 * t * t * t * t * v
    + -2.55090145e-9 * t * t * t * t * t * v
    + (-0.751269505) * v * v
    + (-0.00408350271) * t * v * v
    + -5.21670675e-5 * t * t * v * v
    + 1.94544667e-6 * t * t * t * v * v
    + 1.14099531e-8 * t * t * t * t * v * v
    + 0.158137256 * v * v * v
    + -6.57263143e-5 * t * v * v * v
    + 2.22697524e-7 * t * t * v * v * v
    + -4.16117031e-8 * t * t * t * v * v * v
    + (-0.0127762753) * v * v * v * v
    + 9.66891875e-6 * t * v * v * v * v
    + 2.52785852e-9 * t * t * v * v * v * v
    + 4.56306672e-4 * v * v * v * v * v
    + -1.74202546e-7 * t * v * v * v * v * v
    + -5.91491269e-6 * v * v * v * v * v * v
    + 0.398374029 * d
    + 1.83945314e-4 * t * d
    + -1.73754510e-4 * t * t * d
    + -7.60781159e-7 * t * t * t * d
    + 3.77830287e-8 * t * t * t * t * d
    + 5.43079673e-10 * t * t * t * t * t * d
    + (-0.0200518269) * v * d
    + 8.92859837e-4 * t * v * d
    + 3.45433048e-6 * t * t * v * d
    + -3.77925774e-7 * t * t * t * v * d
    + -1.69699377e-9 * t * t * t * t * v * d
    + 1.69992415e-4 * v * v * d
    + -4.99204314e-5 * t * v * v * d
    + 2.47417178e-7 * t * t * v * v * d
    + 1.07596466e-8 * t * t * t * v * v * d
    + 8.49242932e-5 * v * v * v * d
    + 1.35191328e-6 * t * v * v * v * d
    + -6.21531254e-9 * t * t * v * v * v * d
    + -4.99410301e-6 * v * v * v * v * d
    + -1.89489258e-8 * t * v * v * v * v * d
    + 8.15300114e-8 * v * v * v * v * v * d
    + 7.55043090e-4 * d * d
    + -5.65095215e-5 * t * d * d
    + -4.52166564e-7 * t * t * d * d
    + 2.46688878e-8 * t * t * t * d * d
    + 2.42674348e-10 * t * t * t * t * d * d
    + 1.54547250e-4 * v * d * d
    + 5.24110970e-6 * t * v * d * d
    + -8.75874982e-8 * t * t * v * d * d
    + -1.50743064e-9 * t * t * t * v * d * d
    + -1.56236307e-5 * v * v * d * d
    + -1.33895614e-7 * t * v * v * d * d
    + 2.49709824e-9 * t * t * v * v * d * d
    + 6.51711721e-7 * v * v * v * d * d
    + 1.94960053e-9 * t * v * v * v * d * d
    + -1.00361113e-8 * v * v * v * v * d * d
    + -1.21206673e-5 * d * d * d
    + -2.18203660e-7 * t * d * d * d
    + 7.51269482e-9 * t * t * d * d * d
    + 9.79063848e-11
    * t
    * t
    * t
    * d
    * d
    * d
    + 1.25006734e-6 * v * d * d * d
    + -1.81584736e-9 * t * v * d * d * d
    + -3.52197671e-10
    * t
    * t
    * v
    * d
    * d
    * d
    + -3.36514630e-8 * v * v * d * d * d
    + 1.35908359e-10
    * t
    * v
    * v
    * d
    * d
    * d
    + 4.17032620e-10
    * v
    * v
    * v
    * d
    * d
    * d
    + -1.30369025e-9
    * d
    * d
    * d
    * d
    + 4.13908461e-10
    * t
    * d
    * d
    * d
    * d
    + 9.22652254e-12
    * t
    * t
    * d
    * d
    * d
    * d
    + -5.08220384e-9
    * v
    * d
    * d
    * d
    * d
    + -2.24730961e-11
    * t
    * v
    * d
    * d
    * d
    * d
    + 1.17139133e-10
    * v
    * v
    * d
    * d
    * d
    * d
    + 6.62154879e-10
    * d
    * d
    * d
    * d
    * d
    + 4.03863260e-13
    * t
    * d
    * d
    * d
    * d
    * d
    + 1.95087203e-12
    * v
    * d
    * d
    * d
    * d
    * d
    + -4.73602469e-12
    * d
    * d
    * d
    * d
    * d
    * d
    + 5.12733497 * pa
    + (-0.312788561) * t * pa
    + (-0.0196701861) * t * t * pa
    + 9.99690870e-4 * t * t * t * pa
    + 9.51738512e-6 * t * t * t * t * pa
    + -4.66426341e-7 * t * t * t * t * t * pa
    + 0.548050612 * v * pa
    + (-0.00330552823) * t * v * pa
    + (-0.00164119440) * t * t * v * pa
    + -5.16670694e-6 * t * t * t * v * pa
    + 9.52692432e-7 * t * t * t * t * v * pa
    + (-0.0429223622) * v * v * pa
    + 0.00500845667 * t * v * v * pa
    + 1.00601257e-6 * t * t * v * v * pa
    + -1.81748644e-6 * t * t * t * v * v * pa
    + -1.25813502e-3 * v * v * v * pa
    + -1.79330391e-4 * t * v * v * v * pa
    + 2.34994441e-6 * t * t * v * v * v * pa
    + 1.29735808e-4 * v * v * v * v * pa
    + 1.29064870e-6 * t * v * v * v * v * pa
    + -2.28558686e-6 * v * v * v * v * v * pa
    + (-0.0369476348) * d * pa
    + 0.00162325322 * t * d * pa
    + -3.14279680e-5 * t * t * d * pa
    + 2.59835559e-6 * t * t * t * d * pa
    + -4.77136523e-8 * t * t * t * t * d * pa
    + 8.64203390e-3 * v * d * pa
    + -6.87405181e-4 * t * v * d * pa
    + -9.13863872e-6 * t * t * v * d * pa
    + 5.15916806e-7 * t * t * t * v * d * pa
    + -3.59217476e-5 * v * v * d * pa
    + 3.28696511e-5 * t * v * v * d * pa
    + -7.10542454e-7 * t * t * v * v * d * pa
    + -1.24382300e-5 * v * v * v * d * pa
    + -7.38584400e-9 * t * v * v * v * d * pa
    + 2.20609296e-7 * v * v * v * v * d * pa
    + -7.32469180e-4 * d * d * pa
    + -1.87381964e-5 * t * d * d * pa
    + 4.80925239e-6 * t * t * d * d * pa
    + -8.75492040e-8 * t * t * t * d * d * pa
    + 2.77862930e-5 * v * d * d * pa
    + -5.06004592e-6 * t * v * d * d * pa
    + 1.14325367e-7 * t * t * v * d * d * pa
    + 2.53016723e-6 * v * v * d * d * pa
    + -1.72857035e-8 * t * v * v * d * d * pa
    + -3.95079398e-8 * v * v * v * d * d * pa
    + -3.59413173e-7 * d * d * d * pa
    + 7.04388046e-7 * t * d * d * d * pa
    + -1.89309167e-8
    * t
    * t
    * d
    * d
    * d
    * pa
    + -4.79768731e-7 * v * d * d * d * pa
    + 7.96079978e-9
    * t
    * v
    * d
    * d
    * d
    * pa
    + 1.62897058e-9
    * v
    * v
    * d
    * d
    * d
    * pa
    + 3.94367674e-8
    * d
    * d
    * d
    * d
    * pa
    + -1.18566247e-9
    * t
    * d
    * d
    * d
    * d
    * pa
    + 3.34678041e-10
    * v
    * d
    * d
    * d
    * d
    * pa
    + -1.15606447e-10
    * d
    * d
    * d
    * d
    * d
    * pa
    + (-2.80626406) * pa * pa
    + 0.548712484 * t * pa * pa
    + (-0.00399428410) * t * t * pa * pa
    + -9.54009191e-4 * t * t * t * pa * pa
    + 1.93090978e-5 * t * t * t * t * pa * pa
    + (-0.308806365) * v * pa * pa
    + 0.0116952364 * t * v * pa * pa
    + 4.95271903e-4 * t * t * v * pa * pa
    + -1.90710882e-5 * t * t * t * v * pa * pa
    + 0.00210787756 * v * v * pa * pa
    + -6.98445738e-4 * t * v * v * pa * pa
    + 2.30109073e-5 * t * t * v * v * pa * pa
    + 4.17856590e-4 * v * v * v * pa * pa
    + -1.27043871e-5 * t * v * v * v * pa * pa
    + -3.04620472e-6 * v * v * v * v * pa * pa
    + 0.0514507424 * d * pa * pa
    + (-0.00432510997) * t * d * pa * pa
    + 8.99281156e-5 * t * t * d * pa * pa
    + -7.14663943e-7 * t * t * t * d * pa * pa
    + -2.66016305e-4 * v * d * pa * pa
    + 2.63789586e-4 * t * v * d * pa * pa
    + -7.01199003e-6 * t * t * v * d * pa * pa
    + -1.06823306e-4 * v * v * d * pa * pa
    + 3.61341136e-6 * t * v * v * d * pa * pa
    + 2.29748967e-7 * v * v * v * d * pa * pa
    + 3.04788893e-4 * d * d * pa * pa
    + -6.42070836e-5 * t * d * d * pa * pa
    + 1.16257971e-6 * t * t * d * d * pa * pa
    + 7.68023384e-6 * v * d * d * pa * pa
    + -5.47446896e-7 * t * v * d * d * pa * pa
    + -3.59937910e-8 * v * v * d * d * pa * pa
    + -4.36497725e-6 * d * d * d * pa * pa
    + 1.68737969e-7
    * t
    * d
    * d
    * d
    * pa
    * pa
    + 2.67489271e-8
    * v
    * d
    * d
    * d
    * pa
    * pa
    + 3.23926897e-9
    * d
    * d
    * d
    * d
    * pa
    * pa
    + (-0.0353874123) * pa * pa * pa
    + (-0.221201190) * t * pa * pa * pa
    + 0.0155126038 * t * t * pa * pa * pa
    + -2.63917279e-4 * t * t * t * pa * pa * pa
    + 0.0453433455 * v * pa * pa * pa
    + (-0.00432943862) * t * v * pa * pa * pa
    + 1.45389826e-4 * t * t * v * pa * pa * pa
    + 2.17508610e-4 * v * v * pa * pa * pa
    + -6.66724702e-5 * t * v * v * pa * pa * pa
    + 3.33217140e-5 * v * v * v * pa * pa * pa
    + (-0.00226921615) * d * pa * pa * pa
    + 3.80261982e-4 * t * d * pa * pa * pa
    + -5.45314314e-9 * t * t * d * pa * pa * pa
    + -7.96355448e-4 * v * d * pa * pa * pa
    + 2.53458034e-5 * t * v * d * pa * pa * pa
    + -6.31223658e-6 * v * v * d * pa * pa * pa
    + 3.02122035e-4 * d * d * pa * pa * pa
    + -4.77403547e-6 * t * d * d * pa * pa * pa
    + 1.73825715e-6 * v * d * d * pa * pa * pa
    + -4.09087898e-7
    * d
    * d
    * d
    * pa
    * pa
    * pa
    + 0.614155345 * pa * pa * pa * pa
    + (-0.0616755931) * t * pa * pa * pa * pa
    + 0.00133374846 * t * t * pa * pa * pa * pa
    + 0.00355375387 * v * pa * pa * pa * pa
    + -5.13027851e-4 * t * v * pa * pa * pa * pa
    + 1.02449757e-4 * v * v * pa * pa * pa * pa
    + (-0.00148526421) * d * pa * pa * pa * pa
    + -4.11469183e-5 * t * d * pa * pa * pa * pa
    + -6.80434415e-6 * v * d * pa * pa * pa * pa
    + -9.77675906e-6 * d * d * pa * pa * pa * pa
    + 0.0882773108 * pa * pa * pa * pa * pa
    + (-0.00301859306) * t * pa * pa * pa * pa * pa
    + 0.00104452989 * v * pa * pa * pa * pa * pa
    + 2.47090539e-4 * d * pa * pa * pa * pa * pa
    + 0.00148348065 * pa * pa * pa * pa * pa * pa
  );
}
