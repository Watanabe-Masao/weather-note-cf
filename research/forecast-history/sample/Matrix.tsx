// R6-4 の見本：発表×対象日の表。縦に発表時刻、横に対象日。R6-3（ある発表の週間予報の再現）も行を押して見る。

import { Fragment, useEffect, useMemo, useRef } from "react";
import { Chip, Segmented } from "../../../src/ui/kit";
import {
  addDays,
  type Data,
  hourOf,
  issueLabel,
  KIND_SHORT,
  type Kind,
  md,
  type Slot,
  STATE_TEXT,
  weekday,
} from "./model";
import { Pop6, StateTag, Val, Wx } from "./Transition";

export type Item = "weather" | "pop" | "max" | "min";
export type Layout = "one" | "all";
export type KindFilter = "VPFW50" | "VPFD51" | "both";
const ITEM_NAME: Record<Item, string> = {
  weather: "天気",
  pop: "降水確率",
  max: "最高",
  min: "最低",
};

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

export function buildMatrix(
  data: Data,
  day: string,
  span: number,
  all: string[],
) {
  const cols = [];
  for (let n = -span; n <= span; n++) {
    const d = addDays(day, n);
    if (d >= all[0] && d <= all[all.length - 1]) cols.push(d);
  }
  const rows = new Map<string, Row>();
  for (const d of cols)
    for (const s of data.slots(d)) {
      const r = rows.get(s.key) ?? {
        key: s.key,
        kind: s.kind,
        at: s.at,
        state: s.state,
        regular: s.regular,
        fix: s.shown?.info_type === "訂正",
        source: s.shown?.source ?? null,
        cells: new Map(),
      };
      r.cells.set(d, s);
      rows.set(s.key, r);
    }
  return {
    cols,
    rows: [...rows.values()].sort((a, b) =>
      a.at === b.at ? (a.kind === "VPFW50" ? -1 : 1) : a.at < b.at ? -1 : 1,
    ),
  };
}

function Cell({
  s,
  item,
  layout,
  noPop,
}: {
  s: Slot;
  item: Item;
  layout: Layout;
  noPop: boolean;
}) {
  const v = s.values!;
  const pop =
    s.kind === "VPFW50" ? (
      <Val v={v.popDay} unit="%" tone="rain" changed={s.changed.has("pop")} />
    ) : (
      <span className="fx-pop6">
        <Pop6 s={s} />
      </span>
    );
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
        {!noPop && pop}
      </span>
    );
  if (item === "weather")
    return (
      <span className={s.changed.has("weather") ? "fx-wx changed" : "fx-wx"}>
        <Wx s={s} size={20} />
      </span>
    );
  if (item === "pop") return pop;
  return (
    <Val
      v={v[item]}
      tone={item === "max" ? "hot" : "cold"}
      changed={s.changed.has(item)}
    />
  );
}

export function Matrix({
  data,
  day,
  all,
  onDay,
  layout,
  onLayout,
  item,
  onItem,
  kind,
  onKind,
  selRow,
  onRow,
  selCell,
  onCell,
}: {
  data: Data;
  day: string;
  all: string[];
  onDay: (d: string) => void;
  layout: Layout;
  onLayout: (l: Layout) => void;
  item: Item;
  onItem: (i: Item) => void;
  kind: KindFilter;
  onKind: (k: KindFilter) => void;
  selRow: string | null;
  onRow: (k: string | null) => void;
  selCell: { key: string; day: string } | null;
  onCell: (c: { key: string; day: string } | null) => void;
}) {
  const { cols, rows } = useMemo(
    () => buildMatrix(data, day, 4, all),
    [data, day, all],
  );
  const shown = rows.filter((r) => kind === "both" || r.kind === kind);
  // 1日の降水確率（週間）と6時間の降水確率（府県）は、同じ列に並べない（R2）。両方のときは降水確率を出さない。
  const noPop = kind === "both";
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const th = el.querySelector<HTMLElement>(`th[data-day="${day}"]`);
    if (th)
      el.scrollLeft =
        th.offsetLeft - 68 - (el.clientWidth - 68 - th.offsetWidth) / 2;
    const trs = [...el.querySelectorAll<HTMLElement>("tbody tr")];
    const near = trs
      .filter((tr) => (tr.dataset.key ?? "").split("|")[1]?.slice(0, 10) <= day)
      .at(-1);
    const sel = selRow
      ? el.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(selRow)}"]`)
      : null;
    const target = sel ?? near;
    el.scrollTop = target
      ? target.offsetTop + target.offsetHeight - el.clientHeight + 8
      : 0;
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
        <div className="chip-row">
          <Chip size="sm" on={layout === "all"} onClick={() => onLayout("all")}>
            まとめて
          </Chip>
          {(Object.keys(ITEM_NAME) as Item[]).map((i) => (
            <Chip
              key={i}
              size="sm"
              on={layout === "one" && item === i}
              onClick={() => (onItem(i), onLayout("one"))}
            >
              {ITEM_NAME[i]}
            </Chip>
          ))}
        </div>
        {noPop && (layout === "all" || item === "pop") && (
          <small className="fh-note">
            両方のときは降水確率を出しません（週間は1日、府県は6時間で区切りが違うため）。
          </small>
        )}
      </div>
      <div className="fx-scroll" ref={box}>
        <table className={`fx-table ${layout}`}>
          <thead>
            <tr>
              <th className="fx-corner">発表＼対象日</th>
              {cols.map((d) => (
                <th
                  key={d}
                  data-day={d}
                  className={d === day ? "on" : undefined}
                >
                  <button
                    onClick={() => onDay(d)}
                    aria-pressed={d === day}
                    aria-label={`${md(d)}（${weekday(d)}）を対象日にする`}
                  >
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
              const newDay =
                !prev || prev.at.slice(0, 10) !== r.at.slice(0, 10);
              const spans: { from: number; to: number }[] = [];
              if (r.state !== "ok")
                cols.forEach((d, ci) => {
                  if (!r.cells.has(d)) return;
                  const last = spans.at(-1);
                  if (last && last.to === ci - 1) last.to = ci;
                  else spans.push({ from: ci, to: ci });
                });
              const date = r.at.slice(0, 10);
              return (
                <Fragment key={r.key}>
                  {/* 発表した日ごとの見出しの行：行の頭は時刻だけにする（日付をくり返さない） */}
                  {newDay && (
                    <tr className="fx-dayrow">
                      <th className="fx-rowhead fx-dayhead" scope="rowgroup">
                        {md(date)}
                        <small>（{weekday(date)}）</small>
                      </th>
                      <td colSpan={cols.length} />
                    </tr>
                  )}
                  <tr
                    data-key={r.key}
                    className={`${selRow === r.key ? "on" : ""}${newDay ? " newday" : ""} k-${r.kind}`}
                  >
                    <th className="fx-rowhead">
                      <button
                        onClick={() => onRow(selRow === r.key ? null : r.key)}
                        aria-pressed={selRow === r.key}
                      >
                        <b>{hourOf(r.at)}時</b>
                        <small>
                          {KIND_SHORT[r.kind]}
                          {!r.regular && "・臨時"}
                          {r.fix && <span className="fh-tag fix">訂正</span>}
                          {r.source && (
                            <span className="fh-src">
                              {r.source === "jma-xml" ? "電文" : "記録"}
                            </span>
                          )}
                        </small>
                      </button>
                    </th>
                    {r.state === "ok"
                      ? cols.map((d) => {
                          const s = r.cells.get(d);
                          const on =
                            selCell?.key === r.key && selCell.day === d;
                          return (
                            <td
                              key={d}
                              className={`${d === day ? "col-on" : ""}${s && !s.changed.size ? " quiet" : ""}${on ? " cell-on" : ""}`}
                            >
                              {s ? (
                                <button
                                  className="fx-cell"
                                  onClick={() => (
                                    onCell(on ? null : { key: r.key, day: d }),
                                    onRow(r.key)
                                  )}
                                  aria-pressed={on}
                                  aria-label={`${issueLabel(r.at)}の${md(d)}`}
                                >
                                  <Cell
                                    s={s}
                                    item={item}
                                    layout={layout}
                                    noPop={noPop}
                                  />
                                </button>
                              ) : null}
                            </td>
                          );
                        })
                      : cols.map((d, ci) => {
                          const sp = spans.find((x) => x.from === ci);
                          if (sp)
                            return (
                              <td
                                key={d}
                                colSpan={sp.to - sp.from + 1}
                                className={`fx-gap ${r.state}`}
                              >
                                <StateTag s={r.cells.get(d)!} />
                              </td>
                            );
                          if (spans.some((x) => ci > x.from && ci <= x.to))
                            return null;
                          return (
                            <td
                              key={d}
                              className={d === day ? "col-on" : undefined}
                            />
                          );
                        })}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {sel && <IssueWeek data={data} row={sel} />}
    </div>
  );
}

/** R6-3：選んだ発表が予報しているすべての対象日（表に見えている列だけにしない）。 */
function IssueWeek({ data, row }: { data: Data; row: Row }) {
  const issue = [...row.cells.values()][0]?.shown ?? null;
  const from = row.at.slice(0, 10);
  const days: { d: string; s: Slot }[] = [];
  if (issue)
    for (let n = 0; n <= 8; n++) {
      const d = addDays(from, n);
      const v = data.valuesFor(issue, d);
      if (v)
        days.push({
          d,
          s: { ...[...row.cells.values()][0], values: v, changed: new Set() },
        });
    }
  return (
    <div className="fx-week">
      <p className="fx-week-head">
        <b>{issueLabel(row.at)}</b> の
        {KIND_SHORT[row.kind] === "週間" ? "週間天気予報" : "府県天気予報"}
        が予報していた日（{days.length}日）
        {row.state !== "ok" && (
          <span className={`fh-state ${row.state}`}>
            {STATE_TEXT[row.state]}
          </span>
        )}
      </p>
      {row.state === "ok" && (
        <div className="fx-week-days">
          {days.map(({ d, s }) => (
            <span key={d} className="fx-wd">
              <small>
                {md(d)}（{weekday(d)}）
              </small>
              <Wx s={s} size={22} />
              <span>
                <Val v={s.values!.max} tone="hot" />
                <small className="fh-sl">/</small>
                <Val v={s.values!.min} tone="cold" />
              </span>
              {s.kind === "VPFW50" ? (
                <Val v={s.values!.popDay} unit="%" tone="rain" />
              ) : (
                <span className="fx-pop6">
                  <Pop6 s={s} />
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      <small className="fh-note">
        {row.kind === "VPFW50"
          ? "週間は発表の翌日から7日分。降水確率は1日の値。"
          : "府県天気予報は今日・明日・明後日。降水確率は6時間ごと。"}
        横に送ると全部見られる。
      </small>
    </div>
  );
}
