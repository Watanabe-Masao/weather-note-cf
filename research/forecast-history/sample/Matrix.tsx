// R6-4 の見本：発表×対象日の表。縦に発表時刻、横に対象日。R6-3（ある発表の週間予報の再現）も行を押して見る。

import { Fragment, useEffect, useMemo, useRef } from "react";
import { Chip, Segmented } from "../../../src/ui/kit";
import { addDays, type Data, issueLabel, KIND_SHORT, type Kind, md, type Slot, STATE_TEXT, weekday } from "./model";
import { Pop6, StateTag, Val, Wx } from "./Transition";

export type Item = "weather" | "pop" | "max" | "min";
export type Layout = "one" | "all";
export type KindFilter = "VPFW50" | "VPFD51" | "both";
const ITEM_NAME: Record<Item, string> = { weather: "天気", pop: "降水確率", max: "最高", min: "最低" };

interface Row {
  key: string;
  kind: Kind;
  at: string;
  state: Slot["state"];
  regular: boolean;
  fix: boolean;
  source: string | null;
  cells: Map<string, Slot>;
}

export function buildMatrix(data: Data, day: string, span: number, all: string[]) {
  const cols = [];
  for (let n = -span; n <= span; n++) {
    const d = addDays(day, n);
    if (d >= all[0] && d <= all[all.length - 1]) cols.push(d);
  }
  const rows = new Map<string, Row>();
  for (const d of cols)
    for (const s of data.slots(d)) {
      const r = rows.get(s.key) ?? { key: s.key, kind: s.kind, at: s.at, state: s.state, regular: s.regular, fix: s.shown?.info_type === "訂正", source: s.shown?.source ?? null, cells: new Map() };
      r.cells.set(d, s);
      rows.set(s.key, r);
    }
  return { cols, rows: [...rows.values()].sort((a, b) => (a.at === b.at ? (a.kind === "VPFW50" ? -1 : 1) : a.at < b.at ? -1 : 1)) };
}

function Cell({ s, item, layout }: { s: Slot; item: Item; layout: Layout }) {
  const v = s.values!;
  const pop = s.kind === "VPFW50" ? <Val v={v.popDay} unit="%" tone="rain" changed={s.changed.has("pop")} /> : <span className="fx-pop6"><Pop6 s={s} /></span>;
  if (layout === "all")
    return (
      <span className="fx-all">
        <span className={s.changed.has("weather") ? "fx-wx changed" : "fx-wx"}>
          <Wx s={s} size={18} />
        </span>
        <span className="fx-t">
          <Val v={v.max} tone="hot" changed={s.changed.has("max")} />
          <Val v={v.min} tone="cold" changed={s.changed.has("min")} />
        </span>
        {pop}
      </span>
    );
  if (item === "weather")
    return (
      <span className={s.changed.has("weather") ? "fx-wx changed" : "fx-wx"}>
        <Wx s={s} size={20} />
      </span>
    );
  if (item === "pop") return pop;
  return <Val v={v[item]} tone={item === "max" ? "hot" : "cold"} changed={s.changed.has(item)} />;
}

export function Matrix({
  data,
  day,
  all,
  onDay,
  layout,
  item,
  onItem,
  kind,
  onKind,
  selRow,
  onRow,
}: {
  data: Data;
  day: string;
  all: string[];
  onDay: (d: string) => void;
  layout: Layout;
  item: Item;
  onItem: (i: Item) => void;
  kind: KindFilter;
  onKind: (k: KindFilter) => void;
  selRow: string | null;
  onRow: (k: string | null) => void;
}) {
  const { cols, rows } = useMemo(() => buildMatrix(data, day, 4, all), [data, day, all]);
  const shown = rows.filter((r) => kind === "both" || r.kind === kind);
  const box = useRef<HTMLDivElement>(null);
  // 初めは選んだ日の列が見える位置に（横）、新しい発表が見える位置に（縦）。
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const th = el.querySelector<HTMLElement>(`th[data-day="${day}"]`);
    if (th) el.scrollLeft = th.offsetLeft - 68 - (el.clientWidth - 68 - th.offsetWidth) / 2;
    // 縦は、対象日の前日〜当日の発表が見えるところに（選んだ行があればそこ）。
    const trs = [...el.querySelectorAll<HTMLElement>("tbody tr")];
    const near = trs.filter((tr) => (tr.dataset.key ?? "").split("|")[1]?.slice(0, 10) <= day).at(-1);
    const sel = selRow ? el.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(selRow)}"]`) : null;
    const target = sel ?? near;
    el.scrollTop = target ? target.offsetTop + target.offsetHeight - el.clientHeight + 8 : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, kind, layout]);
  const sel = selRow ? rows.find((r) => r.key === selRow) : null;
  return (
    <div className="fx">
      <div className="fx-controls">
        <Segmented
          label="発表の種類"
          value={kind}
          onChange={onKind}
          options={[
            { id: "VPFW50", label: "週間" },
            { id: "VPFD51", label: "府県" },
            { id: "both", label: "両方" },
          ]}
        />
        {layout === "one" && (
          <div className="chip-row">
            {(Object.keys(ITEM_NAME) as Item[]).map((i) => (
              <Chip key={i} size="sm" on={item === i} onClick={() => onItem(i)}>
                {ITEM_NAME[i]}
              </Chip>
            ))}
          </div>
        )}
      </div>
      <div className="fx-scroll" ref={box}>
        <table className={`fx-table ${layout}`}>
          <thead>
            <tr>
              <th className="fx-corner">
                発表＼対象日
              </th>
              {cols.map((d) => (
                <th key={d} data-day={d} className={d === day ? "on" : undefined}>
                  <button onClick={() => onDay(d)} aria-pressed={d === day} aria-label={`${md(d)}（${weekday(d)}）を対象日にする`}>
                    {md(d)}
                    <small>{weekday(d)}</small>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const prev = shown[i - 1];
              const newDay = !prev || prev.at.slice(0, 10) !== r.at.slice(0, 10);
              // 発表がない回：覆うはずの列をまとめて1つのマスにし、言葉で書く。
              const spans: { from: number; to: number }[] = [];
              if (r.state !== "ok")
                cols.forEach((d, ci) => {
                  if (!r.cells.has(d)) return;
                  const last = spans.at(-1);
                  if (last && last.to === ci - 1) last.to = ci;
                  else spans.push({ from: ci, to: ci });
                });
              return (
                <tr key={r.key} data-key={r.key} className={`${selRow === r.key ? "on" : ""}${newDay ? " newday" : ""} k-${r.kind}`}>
                  <th className="fx-rowhead">
                    <button onClick={() => onRow(selRow === r.key ? null : r.key)} aria-pressed={selRow === r.key}>
                      <b>{issueLabel(r.at)}</b>
                      <small>
                        {KIND_SHORT[r.kind]}
                        {!r.regular && "・臨時"}
                        {r.fix && <span className="fh-tag fix">訂正</span>}
                        {r.source && <span className="fh-src">{r.source === "jma-xml" ? "電文" : "記録"}</span>}
                      </small>
                    </button>
                  </th>
                  {r.state === "ok"
                    ? cols.map((d) => {
                        const s = r.cells.get(d);
                        return (
                          <td key={d} className={`${d === day ? "col-on" : ""}${s && !s.changed.size ? " quiet" : ""}`}>
                            {s ? <Cell s={s} item={item} layout={layout} /> : null}
                          </td>
                        );
                      })
                    : cols.map((d, ci) => {
                        const sp = spans.find((x) => x.from === ci);
                        if (sp)
                          return (
                            <td key={d} colSpan={sp.to - sp.from + 1} className={`fx-gap ${r.state}`}>
                              <StateTag s={r.cells.get(d)!} />
                            </td>
                          );
                        if (spans.some((x) => ci > x.from && ci <= x.to)) return null;
                        return <td key={d} className={d === day ? "col-on" : undefined} />;
                      })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sel && <IssueWeek row={sel} cols={cols} />}
    </div>
  );
}

/** R6-3：選んだ発表の時点の予報（その発表が言っていた日すべて）を1列に再現する。 */
function IssueWeek({ row, cols }: { row: Row; cols: string[] }) {
  const days = cols.filter((d) => row.cells.has(d));
  return (
    <div className="fx-week">
      <p className="fx-week-head">
        <b>{issueLabel(row.at)}</b> の{KIND_SHORT[row.kind] === "週間" ? "週間天気予報" : "府県天気予報"}が言っていたこと
        {row.state !== "ok" && <span className={`fh-state ${row.state}`}>{STATE_TEXT[row.state]}</span>}
      </p>
      {row.state === "ok" && (
        <div className="fx-week-days">
          {days.map((d) => {
            const s = row.cells.get(d)!;
            return (
              <Fragment key={d}>
                <span className="fx-wd">
                  <small>
                    {md(d)}（{weekday(d)}）
                  </small>
                  <Wx s={s} size={22} />
                  <span>
                    <Val v={s.values!.max} tone="hot" />
                    <small className="fh-sl">/</small>
                    <Val v={s.values!.min} tone="cold" />
                  </span>
                  {s.kind === "VPFW50" ? <Val v={s.values!.popDay} unit="%" tone="rain" /> : <span className="fx-pop6">{s.values!.pop6!.map((p, i) => <Val key={i} v={p} tone="rain" />)}</span>}
                </span>
              </Fragment>
            );
          })}
        </div>
      )}
      <small className="fh-note">表の中に見えている日だけ。週間は発表の翌日から7日分（表の範囲を広げると全部出る）。</small>
    </div>
  );
}
