// なぜ (#118): why the person's centre for a moment is where it is, against the shared constants
// (従来版), as the few largest terms — for one line beside a prediction. The centre μ is the mixed
// models' Σ w·(m0 + Σ β_k·driver_k); the shared constants' is 18 + 0.33·(最近の基準 − 15).
//   - "あなたのちょうどよい": the models' constant and 慣れ terms against the shared constants'
//     (where the person's own level sits, learned from the answers)
//   - each other driver: its weighted effect on μ (前日の気温の変化, 季節の向き, …)
// Terms that change with each other (慣れ and 季節の向き) are not separated more finely than this;
// the detail is in 計算の根拠.

import { type DriverKey, DRIVERS, type Drivers } from "./drivers";
import { type Ensemble, weightsAt } from "./ensemble";
import { PRIOR, usable } from "./model";

const ADAPT: DriverKey[] = ["a", "aLim"];

export interface WhyTerm {
  key: "personal" | DriverKey;
  label: string;
  /** Effect on the centre μ (℃ of 肌感): + the centre higher (feels colder), − lower (warmer). */
  effect: number;
}

/** The terms of the person's centre at x against the shared constants', largest first. */
export function whyTerms(ens: Ensemble, x: Drivers): WhyTerm[] {
  const w = weightsAt(ens, x);
  let level = 0;
  const effects = new Map<DriverKey, number>();
  ens.fits.forEach((f, i) => {
    if (!(w[i] > 0) || !usable(f.model, x)) return;
    let j = 0;
    level += w[i] * f.theta[j++];
    for (const k of f.model.mu) {
      const v = (DRIVERS[k].value(x) ?? 0) * f.theta[j++];
      if (ADAPT.includes(k)) level += w[i] * v;
      else effects.set(k, (effects.get(k) ?? 0) + w[i] * v);
    }
  });
  const shared = PRIOR.m0 + PRIOR.slope * (x.a - 15);
  const terms: WhyTerm[] = [{ key: "personal", label: "あなたのちょうどよい", effect: level - shared }];
  for (const [k, effect] of effects) terms.push({ key: k, label: DRIVERS[k].label.replace(/（.*）$/, ""), effect });
  return terms.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}

/** Smaller than this, a term is not worth a word. */
export const WHY_MIN = 0.3;

/** One line: the two largest terms, in words ("" when none is large enough). */
export function whyLine(terms: WhyTerm[]): string {
  const big = terms.filter((t) => Math.abs(t.effect) >= WHY_MIN).slice(0, 2);
  const fmt = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
  return big
    .map((t) =>
      t.key === "personal"
        ? `記録から、あなたのちょうどよいは従来版より ${fmt(t.effect)}（${t.effect > 0 ? "寒く感じやすい" : "暑く感じやすい"}）`
        : `${t.label}で ちょうどよいが ${fmt(t.effect)}（${t.effect > 0 ? "寒く感じる側" : "暑く感じる側"}）`,
    )
    .join("。");
}
