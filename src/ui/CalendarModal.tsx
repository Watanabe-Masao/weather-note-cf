// Month calendar for picking a day. Days outside the allowed range cannot be chosen.

import { ModalSheet, useSheetClose } from "./ModalSheet";
import { useState } from "react";
import { daysOfMonth, monthOf } from "../../shared/dates";
import { dayTone, holidayName, WEEKDAYS } from "../../shared/holidays";

interface Props {
  title: string;
  value: string;
  min: string;
  max: string;
  onPick: (date: string) => void;
  onClose: () => void;
}

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

function CalendarModalBody({ title, value, min, max, onPick, onClose: _done }: Props) {
  void _done;
  const onClose = useSheetClose();
  const [month, setMonth] = useState(monthOf(value));
  const days = daysOfMonth(month);
  const lead = new Date(days[0] + "T00:00:00Z").getUTCDay();
  const canPrev = shiftMonth(month, -1) >= monthOf(min);
  const canNext = shiftMonth(month, 1) <= monthOf(max);

  return (
    <>
        <header className="calendar-head">
          <button className="arrow" disabled={!canPrev} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="前の月">
            ◀
          </button>
          <strong>
            {title}　{month.replace("-", "年")}月
          </strong>
          <button className="arrow" disabled={!canNext} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="次の月">
            ▶
          </button>
        </header>
        <div className="calendar-grid">
          {WEEKDAYS.map((w, i) => (
            <span key={w} className={i === 0 ? "cal-wd holiday" : i === 6 ? "cal-wd saturday" : "cal-wd"}>
              {w}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={"pad" + i} />
          ))}
          {days.map((d) => {
            const enabled = d >= min && d <= max;
            const classes = ["cal-day", dayTone(d), d === value ? "selected" : ""].join(" ");
            return (
              <button
                key={d}
                className={classes}
                disabled={!enabled}
                title={holidayName(d) || undefined}
                onClick={() => {
                  onPick(d);
                  onClose();
                }}
              >
                {+d.slice(8)}
              </button>
            );
          })}
        </div>
        <footer className="calendar-foot">
          <button onClick={() => setMonth(monthOf(value))}>選択中の月へ</button>
          <button onClick={onClose}>閉じる</button>
        </footer>
    </>
  );
}

export function CalendarModal(props: Props) {
  return (
    <ModalSheet label={props.title} onClose={props.onClose} className="calendar">
      <CalendarModalBody {...props} />
    </ModalSheet>
  );
}
