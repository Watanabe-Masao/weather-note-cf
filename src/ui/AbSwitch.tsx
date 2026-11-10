// The A/B switch for the open design questions (preview builds only).

import { AB_QUESTIONS, type AbKey, abVisible, type Variant } from "../ab";

export function AbSwitch({ variant, choose }: { variant: (k: AbKey) => Variant; choose: (k: AbKey, v: Variant) => void }) {
  if (!abVisible()) return null;
  return (
    <div className="ab-switch">
      {(Object.keys(AB_QUESTIONS) as AbKey[]).map((k) => {
        const q = AB_QUESTIONS[k];
        const v = variant(k);
        return (
          <div key={k} className="ab-row" title={`A：${q.A}\nB：${q.B}`}>
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
