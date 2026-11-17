// 予報の履歴 (R6) の小さな部品：1つの値、天気の絵、回の状態の札（見本 research/forecast-history/sample/Transition.tsx から）。

import { skyText, type Slot, STATE_TEXT, type V } from "../../../shared/forecastHistoryModel";
import { WeatherIcon } from "../WeatherIcon";

export const vNum = (v: V | null | undefined) => (v && v.s === "value" ? Number(v.v) : null);

/**
 * 1つの値：値／「—」（気象庁が出していない：値なし・項目なし）／空（対象期間外）。
 * 「—」の理由は title に頼らない（スマホでは読めない）。
 */
export function Val({ v, unit, tone, changed }: { v: V | null | undefined; unit?: string; tone?: string; changed?: boolean }) {
  if (v === null) return <span className="fh-out" aria-label="対象期間外" />;
  if (!v || v.s === "absent")
    return (
      <span className="fh-dash" aria-label="項目なし">
        —
      </span>
    );
  if (v.s === "none")
    return (
      <span className="fh-dash" aria-label="値なし">
        —
      </span>
    );
  return (
    <span className={`fh-val${tone ? ` tone-${tone}` : ""}${changed ? " changed" : ""}`}>
      {v.v}
      {unit && <small>{unit}</small>}
    </span>
  );
}

/** 天気の名前は「後・時々・一時」の前でだけ折り返す（くもり後｜雨 と切らない）。 */
export const breakable = (name: string) => name.replace(/(後|時々|一時)/g, "​$1");

const weatherOf = (s: Slot) => (s.values?.weather.s === "value" ? (s.values.weather as V & { name?: string; partial?: string | null }) : null);

export function Wx({ s, size = 20 }: { s: Slot; size?: number }) {
  const w = weatherOf(s);
  if (!w) return <span className="fh-dash">—</span>;
  return <WeatherIcon text={skyText(w.name ?? null)} size={size} />;
}

/** 発表がない回の札：「記録なし」「取れなかった」「取り消し」「届いていない」は言葉で出す（R5-1・R6-8）。 */
export function StateTag({ s }: { s: Slot }) {
  if (s.state === "ok") return null;
  return <span className={`fh-state ${s.state}`}>{STATE_TEXT[s.state]}</span>;
}
