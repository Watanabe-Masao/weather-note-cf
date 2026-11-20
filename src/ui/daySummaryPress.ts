// その日の要約 (#176): one way in, everywhere a day's weather picture is drawn (the table, the
// calendar, the hour graph's weather row). The picture carries `data-summary="date|other"`; a long
// press on it (or anywhere inside a container using this hook) opens that day's summary.

import { createContext, useContext } from "react";
import { useLongPress } from "./kit";

export interface DaySummaryAsk {
  date: string;
  /** The day it is read against (the partner), or none. */
  other: string | null;
}

export const DaySummaryContext = createContext<
  ((ask: DaySummaryAsk) => void) | null
>(null);

/** The attribute that marks a picture as opening its day's summary. */
export const summaryAttr = (
  date: string | null | undefined,
  other: string | null | undefined,
) => (date ? { "data-summary": `${date}|${other ?? ""}` } : {});

/** Long-press handlers for a picture or a container of pictures marked with `summaryAttr`. */
export function useDaySummaryPress() {
  const open = useContext(DaySummaryContext);
  return useLongPress(
    open
      ? (target) => {
          const el = target.closest<HTMLElement>("[data-summary]");
          const [date, other] = (el?.dataset.summary ?? "").split("|");
          if (!date) return false;
          open({ date, other: other || null });
        }
      : undefined,
  );
}
