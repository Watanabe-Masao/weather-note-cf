// 値が無いときの印（2026-11-25 渡辺さん「表示はアイコン化させてｉ◯でアイコンの意味を提示」「アイコンの下に文字が入るなら入れ、
// 入れれない時はアイコンのみで」）。理由は shared/availability.ts の whyMissing。意味は ⓘ の NoValueLegend にまとめる。
// 色だけで分けない（形と、読み上げの名前）。色を付けるのは取得失敗だけ（こちらの不具合で、取り直せる）。

import { INCOMPARABLE, NO_VALUE, type NoValueWhy } from "../../shared/availability";
import { NoValueIcon } from "./icons";

/** 理由の印。label：アイコンの下に名前を出す（場所があるとき）。detail：その日の理由（読み上げと押したときの説明に足す）。 */
export function NoValue({ why, label = false, detail }: { why: NoValueWhy; label?: boolean; detail?: string }) {
  const name = NO_VALUE[why].label;
  return (
    <span className={`no-value why-${why}${label ? " with-label" : ""}`} role="img" aria-label={detail ? `${name}：${detail}` : name} data-why={why}>
      <NoValueIcon why={why} />
      {label && <span className="no-value-label" aria-hidden>{name}</span>}
    </span>
  );
}

/** 比べられない差（観測の方法が違う）：空気の内訳と同じ斜線。 */
export function Incomparable({ label = false }: { label?: boolean }) {
  return (
    <span className={`no-value incomparable${label ? " with-label" : ""}`} role="img" aria-label={INCOMPARABLE.label} data-why="incomparable">
      <span className="incomparable-hatch" aria-hidden />
      {label && <span className="no-value-label" aria-hidden>{INCOMPARABLE.label}</span>}
    </span>
  );
}

/** ⓘ に出す、印の意味。shown：その表に出ている理由だけ（無ければ全部）。 */
export function NoValueLegend({ shown, incomparable = false }: { shown?: NoValueWhy[]; incomparable?: boolean }) {
  const list = (shown?.length ? shown : (Object.keys(NO_VALUE) as NoValueWhy[])).filter((w, i, a) => a.indexOf(w) === i);
  return (
    <dl className="no-value-legend">
      {list.map((w) => (
        <div key={w}>
          <dt>
            <span className={`no-value why-${w}`} aria-hidden>
              <NoValueIcon why={w} />
            </span>
            <span>{NO_VALUE[w].label}</span>
          </dt>
          <dd>{NO_VALUE[w].note}</dd>
        </div>
      ))}
      {incomparable && (
        <div>
          <dt>
            <span className="incomparable-hatch" aria-hidden />
            <span>{INCOMPARABLE.label}</span>
          </dt>
          <dd>{INCOMPARABLE.note}</dd>
        </div>
      )}
    </dl>
  );
}
