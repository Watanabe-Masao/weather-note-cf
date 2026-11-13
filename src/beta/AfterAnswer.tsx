// 答えた直後 (#118, everyday side): what the answer just sent changed. The ensemble as it was at
// sending is kept; once the models are fitted again with the answer, the centre, the range and the
// prediction for that same moment are shown before → after. An answer that could not teach the
// model (an input missing) says so — that is worth knowing at once (#117).

import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { observationsOf, placeTempOf } from "./engine/observations";
import { ensembleState, probabilities, type Ensemble } from "./comfort";
import type { Report } from "./reports";
import { BetaContext } from "./settings";
import { FeelContext, levelName } from "../ui/FeelBar";
import type { Level } from "../../shared/feel";

interface Pending {
  report: Report;
  before: Ensemble;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const set = (p: Pending | null) => {
  pending = p;
  listeners.forEach((l) => l());
};

/** Called when an answer is saved, with the ensemble in use at that moment. */
export function noteAnswered(report: Report, before: Ensemble): void {
  set({ report, before });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The moment's state under an ensemble: centre, half-range and the likeliest answer. Null if the answer cannot be read by it. */
export function momentUnder(ens: Ensemble, r: Report): { mu: number; h: number; mode: number } | null {
  const x = observationsOf([r], ens.alpha)[0];
  const e = placeTempOf(r);
  if (!x || e == null) return null;
  const st = ensembleState(ens, x);
  const p = probabilities(st, e);
  return { mu: st.mu, h: st.h, mode: p.indexOf(Math.max(...p)) - 3 };
}

const SHOWN_MS = 20_000;

export function AfterAnswer() {
  const p = useSyncExternalStore(subscribe, () => pending);
  const beta = useContext(BetaContext);
  const feel = useContext(FeelContext);
  // Ready once the models were fitted again after the answer (the ensemble changed and is not fitting).
  const ready = p != null && beta.learned && !beta.fitting && beta.ens !== p.before;
  const [shownAt, setShownAt] = useState<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    setShownAt(Date.now());
    const t = setTimeout(() => set(null), SHOWN_MS);
    return () => clearTimeout(t);
  }, [ready]);
  if (!p || !ready || shownAt == null) return null;
  const a = momentUnder(p.before, p.report);
  const b = momentUnder(beta.ens, p.report);
  const name = (y: number) => levelName((y + 3) as Level, feel.scale ?? 7);
  const sign = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`;
  const taught = beta.ens.n > p.before.n;
  return (
    <div className="after-answer" role="status">
      <div className="after-answer-head">
        <b>{taught ? "答えを学びました" : "この答えは学習に使えませんでした"}</b>
        <button className="chip sm" onClick={() => set(null)} aria-label="閉じる">
          ×
        </button>
      </div>
      {taught && a && b ? (
        <ul>
          <li>
            ちょうどよいの中心 {a.mu.toFixed(1)} → <b>{b.mu.toFixed(1)}</b>（{sign(b.mu - a.mu)}）
          </li>
          <li>
            範囲の半分 {a.h.toFixed(1)} → <b>{b.h.toFixed(1)}</b>
          </li>
          <li>
            この時刻の予測 {name(a.mode)} → <b>{name(b.mode)}</b>（答え {name(p.report.sensation as number)}）
          </li>
          <li>
            学習に使えた記録 {p.before.n} → {beta.ens.n} 件
          </li>
        </ul>
      ) : (
        <p>{taught ? "変化を計算できませんでした。" : "入力（気温の履歴や観測）が足りない記録は学習に使いません。記録はそのまま残ります。"}</p>
      )}
    </div>
  );
}
