// 予報の履歴 R6 の見本：発表の一覧を「発表した日」ごとにまとめる案（2026-11-17）。
// - 日付の見出しに「何日前」を1回だけ書き、行は時刻から始める（同じ日付と「○日前」をくり返さない）。
// - 行の右に、前の同じ種類の発表から変わったもの（最高 −1°・降水 +10% など）。変わらなければ「変化なし」。
//   比べるのは天気・降水確率・最高・最低・信頼度のすべて（どれか1つでも変われば「変化なし」にしない）。
// - 当日の発表は途中からの値なので比べない（右は空ける）。

import { Fragment } from "react";
import { hourOf, KIND_SHORT, leadLabel, md, type Slot, weekday } from "./model";
import { breakable, StateTag, Val, vNum, Wx } from "./Transition";

const START = [0, 6, 12, 18];
const sign = (d: number) => (d > 0 ? `+${d}` : `−${-d}`);

type Change = { text: string; tone: "hot" | "cold" | "rain" | "plain" };

/** 前の同じ種類の発表からの変化（s.changed にある項目だけ、数字は差で）。 */
function changesOf(s: Slot, prev: Slot | null): Change[] {
  const v = s.values;
  const p = prev?.values;
  if (!v || !p) return [];
  const out: Change[] = [];
  if (s.changed.has("weather")) out.push({ text: "天気", tone: "plain" });
  if (s.kind === "VPFW50" && s.changed.has("pop")) {
    const a = vNum(v.popDay);
    const b = vNum(p.popDay);
    out.push({
      text: a != null && b != null ? `降水 ${sign(a - b)}%` : "降水",
      tone: "rain",
    });
  }
  // 府県天気予報の6時間ごとは、右には「降水」とだけ書き、どの時間帯がどれだけかは下の段の数字の横に（▲▼）。
  if (s.kind === "VPFD51" && s.changed.has("pop"))
    out.push({ text: "降水", tone: "rain" });
  for (const k of ["max", "min"] as const) {
    if (!s.changed.has(k)) continue;
    const a = vNum(v[k]);
    const b = vNum(p[k]);
    out.push({
      text:
        (k === "max" ? "最高" : "最低") +
        (a != null && b != null ? ` ${sign(a - b)}°` : ""),
      tone: k === "max" ? "hot" : "cold",
    });
  }
  if (s.changed.has("reliability") && v.reliability?.s === "value")
    out.push({
      text: `信頼度 ${p.reliability?.s === "value" ? `${String(p.reliability.v)}→` : ""}${String(v.reliability.v)}`,
      tone: "plain",
    });
  return out;
}

function Row({
  s,
  prev,
  selected,
  onSelect,
}: {
  s: Slot;
  prev: Slot | null;
  selected: boolean;
  onSelect: (k: string) => void;
}) {
  const v = s.values;
  const ok = s.state === "ok" && !!v;
  const ch = ok ? changesOf(s, prev) : [];
  // 比べられるのは前の日以前の発表で、前の同じ種類の発表があるとき。
  const compared = ok && s.lead > 0 && !!prev;
  const w = v?.weather.s === "value" ? (v.weather as { name?: string }) : null;
  const pops = v?.pop6 ?? [];
  return (
    <button
      className={`fh-drow${selected ? " on" : ""}${ok ? "" : " gap"}${compared && !ch.length ? " quiet" : ""}`}
      onClick={() => onSelect(s.key)}
      aria-pressed={selected}
    >
      <span className="fh-drow-t">
        <b>{hourOf(s.at)}時</b>
        <span className={`fh-kchip ${s.kind}`}>{KIND_SHORT[s.kind]}</span>
      </span>
      {ok ? (
        <>
          <span className="fh-drow-main">
            <Wx s={s} size={20} />
            <span className="fh-drow-temp">
              <Val v={v!.max} tone="hot" changed={s.changed.has("max")} />
              <small className="fh-sl">/</small>
              <Val v={v!.min} tone="cold" changed={s.changed.has("min")} />
            </span>
          </span>
          <span className="fh-drow-ch">
            {!compared ? null : ch.length ? (
              ch.map((c, i) => (
                <span key={i} className={`fh-drow-c tone-${c.tone}`}>
                  {c.text}
                </span>
              ))
            ) : (
              <span className="fh-drow-same">変化なし</span>
            )}
          </span>
          <span className="fh-drow-sub">
            <span>{breakable(w?.name ?? "—")}</span>
            <span>
              降水{" "}
              {s.kind === "VPFW50" ? (
                <Val v={v!.popDay} unit="%" tone="rain" />
              ) : pops.every((x) => x && x.s === "absent") ? (
                <Val v={{ s: "absent" }} />
              ) : (
                (() => {
                  // 過ぎた時間帯（対象期間外）は書かない。途中からのときは何時からかを添える。
                  const idx = [0, 1, 2, 3].filter((i) => pops[i] !== null);
                  return (
                    <>
                      {idx[0] > 0 && (
                        <small className="fh-lbl">
                          （{START[idx[0]]}時から）
                        </small>
                      )}
                      {idx.map((i, j) => {
                        const a = vNum(pops[i]);
                        const b = compared
                          ? vNum(prev!.values?.pop6?.[i])
                          : null;
                        const d =
                          s.changed.has(`pop6-${i}`) && a != null && b != null
                            ? a - b
                            : 0;
                        return (
                          <Fragment key={i}>
                            {j > 0 && <small className="fh-sl">・</small>}
                            <Val
                              v={pops[i]}
                              tone="rain"
                              changed={s.changed.has(`pop6-${i}`)}
                            />
                            {d !== 0 && (
                              <small
                                className={`fh-delta ${d > 0 ? "up" : "down"}`}
                              >
                                {d > 0 ? `▲${d}` : `▼${-d}`}
                              </small>
                            )}
                          </Fragment>
                        );
                      })}
                    </>
                  );
                })()
              )}
            </span>
            {v!.reliability?.s === "value" && (
              <span>信頼度{String(v!.reliability.v)}</span>
            )}
          </span>
        </>
      ) : (
        <span className="fh-drow-main">
          <StateTag s={s} />
        </span>
      )}
    </button>
  );
}

/** 発表した日ごとのまとまり。`onlyChanged` のときは「変化なし」の行を見出しの回数だけにする。 */
export function DayRows({
  slots,
  day,
  selected,
  onSelect,
  onlyChanged = false,
  all,
}: {
  slots: Slot[];
  /** 比べる相手を探す元（1つの時刻に1つにする前の全部の回）。無ければ slots。 */
  all?: Slot[];
  day: string;
  selected: string | null;
  onSelect: (k: string) => void;
  onlyChanged?: boolean;
}) {
  // 前の同じ種類の発表（値のあるもの）。表に出ていない種類の回も比べる相手にはなる（model と同じ）。
  const pool = all ?? slots;
  const prevOf = (s: Slot) =>
    pool
      .slice(
        0,
        pool.findIndex((x) => x.key === s.key),
      )
      .reverse()
      .find((p) => p.kind === s.kind && p.state === "ok" && p.values) ?? null;
  const dates = [...new Set(slots.map((s) => s.at.slice(0, 10)))];
  return (
    <div className="fh-days" role="list" aria-label="発表した日ごとの予報">
      {dates.map((d) => {
        const rows = slots.filter((s) => s.at.slice(0, 10) === d);
        const shown = rows.filter((s) => {
          if (!onlyChanged || s.state !== "ok" || s.lead === 0) return true;
          const p = prevOf(s);
          return !p || s.changed.size > 0;
        });
        const hidden = rows.length - shown.length;
        const lead = rows[0].lead;
        return (
          <section key={d} className="fh-day" role="listitem">
            <div className="fh-day-h">
              <b>
                {md(d)}
                <small>（{weekday(d)}）</small>
              </b>
              <span className={d === day ? "today" : ""}>
                {lead === 0 ? "当日" : `対象日の${leadLabel(lead)}`}
                {hidden > 0 && `・変化なし${hidden}回`}
              </span>
            </div>
            {shown.map((s) => (
              <Row
                key={s.key}
                s={s}
                prev={prevOf(s)}
                selected={selected === s.key}
                onSelect={onSelect}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
