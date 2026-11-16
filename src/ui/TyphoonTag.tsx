// 台風の日 (#220): 台 beside a day's weather picture, wherever a day is drawn (the table, the
// calendars, the summaries) — outlined inside the 強風域, filled inside the 暴風域, dashed for the
// 暴風警戒域 ahead (JMA's forecast, as JMA draws it). The days come from one lookup (TyphoonDaysContext).

import { useTyphoonOn } from "../data/typhoonDays";

/** `inline`: in the line beside the picture; otherwise on the picture's shoulder (its box is relative). */
export function TyphoonTag({
  date,
  inline = false,
}: {
  date: string;
  inline?: boolean;
}) {
  const on = useTyphoonOn()(date);
  // "none" draws nothing; "unknown" draws nothing either — where it matters, a line says what could
  // not be read (台風情報を取得できませんでした / まだ記録にない), never "no typhoon".
  if (on === "none" || on === "unknown") return null;
  const label = `台風${on.number}号 ${on.area === "storm" ? "暴風域" : on.area === "gale" ? "強風域" : "暴風警戒域（予報）"}`;
  return (
    <span
      className={`typhoon-tag ${on.area}${inline ? " inline" : ""}`}
      role="img"
      aria-label={label}
      title={label}
    >
      台
    </span>
  );
}
