// 学習あり版の入口 (principles 0): only this side may reach the learned predictors; the plain core
// (src/core/index.ts) never does.

export { climatologyPredictor } from "./climatology";
export { ORDINAL_FIT } from "./params";
export { type OrdinalInputs, ordinalPredictor } from "./ordinal";
