// One version for the shape of stored weather rows, used by both copies: the edge cache keys
// (Worker) and the browser database (app). Bump it when rows change shape; both copies are then
// rebuilt together. For corrected values (same shape), use shared/corrections.ts instead.
export const DATA_SHAPE = 2;
