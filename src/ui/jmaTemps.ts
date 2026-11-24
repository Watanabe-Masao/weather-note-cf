// 時間帯のグラフの「気象庁の予報」（2026-11-23）：府県天気予報の3時間ごとの気温（高知）を、気温のグラフに
// 点で重ねる。どの回か：予報の移り変わりで選んだ回、何も選んでいなければその日の朝5時の府県天気予報
// （shared/forecastHistoryModel.ts tempSlot）。値は気象庁のまま（整数、点だけで線にしない＝補間しない）。

import { useMemo } from "react";
import { HISTORY_PLACES } from "../../shared/forecastHistory";
import { ForecastHistory as Model, OWN_FROM, type Slot, type TempPoint, tempPoints, tempSlot } from "../../shared/forecastHistoryModel";
import { usePickedIssue } from "../data/forecastPick";
import { useForecastHistory } from "../data/historyCache";

export interface JmaTemps {
  /** 重ねている発表の回（無ければ null：この日を予報した府県天気予報の記録が無い）。 */
  slot: Slot | null;
  /** その回の3時間ごとの気温（週間の回を選んでいると空）。 */
  points: TempPoint[];
  /** 予報の移り変わりで選んだ回か（false：朝5時の初めの見え方）。 */
  picked: boolean;
}

const jstNow = () => `${new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;

/** `date` が null（気温でない・自前の電文より前の日）なら何も読まない。 */
export function useJmaTemps(station: string, date: string | null): JmaTemps | null {
  const on = !!date && date >= OWN_FROM && !!HISTORY_PLACES[station];
  // 予報の移り変わりと同じ取り置き（取り直しも同じ、src/data/historyCache.ts）。読めなければ重ねないだけ。
  const r = useForecastHistory(station, date ?? "", on).r;
  const picked = usePickedIssue(station, date ?? "");
  return useMemo(() => {
    if (!on || !date || !r || !r.supported) return null;
    const model = new Model(r);
    const slot = tempSlot(model.slots(date, jstNow()), date, picked);
    return { slot, points: tempPoints(model, slot?.shown ?? null, date), picked: !!picked && slot?.key === picked };
  }, [on, date, r, picked]);
}
