// The comfort engine: the β model's mathematics, one module per part of the contract
// (research/comfort-model/mathematical-contract.md). Imported by the app (through ../comfort),
// the fitting worker and the research scripts alike, so they all compute the same thing.
//
// // β: the comfort centre and range of this moment — several models, compared and combined.
// //
// // The idea: a person feels "ちょうどよい" (thermal neutral: neither warm nor cold — not the same thing as comfort, which is asked of no one yet) within a range around a centre; past its edges it turns
// // cool or warm step by step. Neither the centre nor the width is fixed: the days before (the recent
// // temperatures and how they changed, humidity, sunshine, rain, the weather) move both. Which of
// // them matter, and how much, is what the reports are for — so several models, each with its own
// // set of drivers, are fitted side by side and compared.
// //
// // Every model has the same shape:
// //   centre      μ = m0 + Σ b_j · x_j            (its centre drivers)
// //   half-range  h = exp(l0 + Σ c_j · x_j)       (its range drivers)
// //   outer step  g = exp(q0),  blur s = exp(r0)
// //   place       E′ = E + wS·[風 強い] + wN·[風 なし]   (E = 肌感（日なた／日かげ）, the station's wind,
// //                                                     humidity and sun already in it)
// //   answer      P(Y ≤ k) = σ((c_k − (E′ − μ)) / s),  c = μ-relative edges ±h, ±(h+g), ±(h+2g)
// //
// // Priors: fixed starting values, independent of the 肌感 display settings (moving a display
// // boundary never moves the research model). The centre starts at 18 ℃ (±4) when the recent
// // baseline is 15 ℃ — wide, because outdoor neutral temperatures in the literature spread widely;
// // the half-range at 3 ℃, the outer step at 4 ℃ (log-scale spreads 0.5). The recent-temperature
// // slope starts at 0.33 (EN 16798-1's adaptive comfort temperature against the running mean);
// // every other driver starts at 0 with a spread wide enough for the reports to move it.
// // Adaptation has limits — weeks at 35 ℃ do not make 35 ℃ comfortable — so a model whose baseline
// // effect stops outside 10–30 ℃ (EN 16798-1's range for the running mean) competes with the straight one.
// //
// // Comparison: each model's evidence (marginal likelihood, Laplace approximation) — it already
// // charges for every extra driver — gives its weight; the prediction is the weighted mixture
// // (Bayesian model averaging). Each report also stores every model's own prediction made at sending,
// // so the models are also compared on predictions made before the answer was known.
//
// import { runningMean } from "./adaptation";

export * from "./drivers";
export * from "./model";
export * from "./estimation";
export * from "./observations";
export * from "./ensemble";
export * from "./prediction";
export * from "./learning";
export * from "./evaluation";
