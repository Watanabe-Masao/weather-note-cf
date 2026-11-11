// The A/B switch for the open design questions (preview builds only): one line, opens to the list.

import { useContext, useState } from "react";
import { AB_QUESTIONS, AbContext, type AbKey, abVisible } from "../ab";

export function AbSwitch() {
  const { variant, choose } = useContext(AbContext);
  const [open, setOpen] = useState(false);
  if (!abVisible()) return null;
  const keys = Object.keys(AB_QUESTIONS) as AbKey[];
  return (
    <div className={open ? "ab-switch open" : "ab-switch"}>
      <button className="ab-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        A/B比較 <span>{keys.map((k) => variant(k)).join(" ")}</span>
        <i>{open ? "▴" : "▾"}</i>
      </button>
      {open &&
        keys.map((k) => {
          const q = AB_QUESTIONS[k];
          const v = variant(k);
          return (
            <div key={k} className="ab-row">
              <span className="ab-title">{q.title}</span>
              {(["A", "B"] as const).map((x) => (
                <button key={x} className={v === x ? "on" : ""} aria-pressed={v === x} onClick={() => choose(k, x)}>
                  {x}
                </button>
              ))}
              <span className="ab-desc">{q[v]}</span>
            </div>
          );
        })}
    </div>
  );
}
