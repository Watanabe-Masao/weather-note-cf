// One version for the shape of stored weather rows, used by both copies: the edge cache keys
// (Worker) and the browser database (app). Bump it when rows change shape; both copies are then
// rebuilt together. For corrected values (same shape), use shared/corrections.ts instead.
// 3（2026-11-25）：#426 で1時間ごとの行に視程（visibility）が加わったのに上げていなかったため、11/21 より前に
// 取っておいた日（端の保存・ブラウザの保存）に視程が無く、前年の視程が「—」になっていた。
// 4（2026-11-27）：#532 で Open-Meteo の1時間ごとの予報の行に全雲量（cover、%）が加わった。
// 5（2026-11-27）：Open-Meteo の1時間ごとの予報の行に層ごとの雲量（coverLow・coverMid・coverHigh、%）が加わった（空の予報の履歴）。
export const DATA_SHAPE = 5;
