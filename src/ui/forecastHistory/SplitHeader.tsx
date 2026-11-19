// 予報の履歴 R6：上の枠を「左に予報、右に実績」に分ける案（2026-11-17）。
// - 上の段：左に選んだ発表（天気の絵・最高／最低と前の発表からの差・種類の札）、右に対象日の実績。
// - 下の段：時間帯の表を1つにまとめ、行を「予報」「実績」に分ける。同じ時間帯の列で上下に見比べられる。
//   府県天気予報は4つの時間帯ごと、週間は「1日」で4列をまたぐ1マス。過ぎた時間帯は斜線の空き枠。

import { WeatherIcon } from "../WeatherIcon";
import type { ReactNode } from "react";
import { type ActualDay, rangedTemps } from "./actual";
import {
  blanksOf,
  hasNumbers,
  hourOf,
  KIND_SHORT,
  leadLabel,
  md,
  skyText,
  type Slot,
  STATE_TEXT,
} from "../../../shared/forecastHistoryModel";
import { Wx } from "./parts";
import { InfoNote } from "../kit";

type Num = { s: string; v?: unknown } | null | undefined;
const numOf = (x: Num) => (x && x.s === "value" ? Number(x.v) : null);
const fmt = (v: number | null | undefined) =>
  v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1);

function Delta({ now, before }: { now: number | null; before: number | null }) {
  if (now == null || before == null || now === before) return null;
  const d = now - before;
  return (
    <small className={`fh-delta ${d > 0 ? "up" : "down"}`}>
      {d > 0 ? `▲${d}` : `▼${-d}`}
    </small>
  );
}

const SLOTS = ["00-06", "06-12", "12-18", "18-24"];

/** 実績と予報の差（実績 − 予報）。0.05 未満は ±0°。 */
function Gap({
  actual,
  fc,
  tone,
}: {
  actual: number | null;
  fc: number | null;
  tone: "hot" | "cold";
}) {
  if (actual == null || fc == null) return <span className="fh-gap-v">—</span>;
  const d = Math.round((actual - fc) * 10) / 10;
  const txt =
    Math.abs(d) < 0.05
      ? "±0°"
      : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}°`;
  return <span className={`fh-gap-v tone-${tone}`}>{txt}</span>;
}

export function SplitHeader({
  s,
  slots,
  day,
  a,
  aPrev,
  dayIcon,
}: {
  s: Slot;
  slots: Slot[];
  day: string;
  a: ActualDay | null | undefined;
  /** 前の日の実績（朝の最低 0〜9時 の 0時の値＝前の日の24時の値のため） */
  aPrev?: ActualDay | null;
  /** 実績の日の天気の絵（アプリの日の表の天気、DayWeatherIcon） */
  dayIcon?: ReactNode;
}) {
  const ok = s.state === "ok" && !!s.values;
  const blanks = ok ? blanksOf(s) : [];
  const v = s.values;
  const i = slots.indexOf(s);
  const prev =
    !ok || s.lead === 0
      ? null
      : (slots
          .slice(0, i)
          .reverse()
          .find((p) => p.kind === s.kind && p.state === "ok" && p.values) ??
        null);
  const mx = ok ? numOf(v!.max) : null;
  const mn = ok ? numOf(v!.min) : null;
  const rel =
    ok && s.kind === "VPFW50" && v!.reliability?.s === "value"
      ? String(v!.reliability.v)
      : null;
  const hours = a?.hours ?? [];
  const done = hours.length >= 24;
  // 予報と同じ範囲の実績（要件 R4「気温の範囲」）：府県天気予報は 日中 9〜18時の最高・朝 0〜9時の最低を
  // 1時間ごとの値（毎正時）から数え直す。週間は 0〜24時（日最高・日最低）のまま。
  const ranged = s.kind === "VPFD51";
  const { max: aMax, min: aMin } = rangedTemps(s.kind, a ?? null, aPrev ?? null);

  return (
    <div className="fh-split">
      <div className="fh-split-cols">
        {/* 左：予報 */}
        <div className="fh-split-col">
          <div className="fh-split-top">
            <span className="fh-split-pic">
              {ok ? (
                <Wx s={s} size={32} />
              ) : (
                <span className="fh-focus-nopic small" />
              )}
            </span>
            <span className="fh-split-temps">
              {ok && (mx != null || mn != null) ? (
                <>
                  <span className="tone-hot">{mx ?? "—"}</span>
                  <Delta
                    now={mx}
                    before={prev?.values ? numOf(prev.values.max) : null}
                  />
                  <span className="dd-slash">/</span>
                  <span className="tone-cold">{mn ?? "—"}</span>
                  <Delta
                    now={mn}
                    before={prev?.values ? numOf(prev.values.min) : null}
                  />
                </>
              ) : !ok ? (
                <span className="fh-focus-state">{STATE_TEXT[s.state]}</span>
              ) : null}
            </span>
          </div>
          <div className="fh-split-meta">
            <span className={`fh-kchip ${s.kind}`}>{KIND_SHORT[s.kind]}</span>
            <span>
              {md(s.at.slice(0, 10))} {hourOf(s.at)}時
            </span>
            <span className="fh-lead">{leadLabel(s.lead)}</span>
            {rel && <span className="fh-lead">信頼度{rel}</span>}
          </div>
          {/* 空欄の理由（2026-11-19）：取り損ねたのではなく、この発表にもともと無い値。府県天気予報の明後日は天気だけ */}
          {ok && blanks.length > 0 && (
            <InfoNote
              className="fh-blanks"
              more={blanks.map((b) => (
                <span key={b.item} className="fh-blank">
                  {b.item}：{b.reason}
                </span>
              ))}
            >
              {!hasNumbers(s)
                ? s.kind === "VPFD51" && s.lead >= 2
                  ? "降水確率・気温は無い発表（明後日は天気だけ）"
                  : "降水確率・気温は無い発表"
                : `空欄の理由（${blanks.length}）`}
            </InfoNote>
          )}
        </div>
        {/* 右：実績 */}
        <div className="fh-split-col actual">
          <div className="fh-split-top">
            <span className="fh-split-pic">
              {dayIcon ? (
                dayIcon
              ) : (
                <span className="fh-focus-nopic small" />
              )}
            </span>
            <span className="fh-split-temps">
              {/* 左の予報と同じ範囲の値（府県：日中・朝、週間：1日） */}
              {a && (aMax != null || aMin != null) ? (
                <>
                  <span className="tone-hot">{fmt(aMax)}</span>
                  <span className="dd-slash">/</span>
                  <span className="tone-cold">{fmt(aMin)}</span>
                </>
              ) : null}
            </span>
          </div>
          <div className="fh-split-meta">
            <span className="fh-kchip actual">実績</span>
            <span>{md(day)}</span>
            {ranged && <span className="fh-lead">日中・朝</span>}
            {!done && (
              <span className="fh-lead">
                {hours.length ? `${hours[hours.length - 1].h}時まで` : "まだ"}
              </span>
            )}
            {/* 「—」の理由（2026-11-19）：その範囲がまだ終わっていない（取り損ねではない） */}
            {!done && a && aMax == null && (
              <span className="fh-lead">
                {ranged ? "日中の最高は18時まで決まらない" : "最高はその日が終わるまで決まらない"}
              </span>
            )}
          </div>
          {/* 予報との差（実績 − 選んだ発表の予報）。▲▼（前の発表からの変化）と取り違えないよう、符号つきの数字と「差」の札で */}
          <div className="fh-gap">
            {a &&
            (mx != null || mn != null) &&
            (aMax != null || aMin != null) ? (
              <>
                <span className="fh-gap-l">{ranged ? "日中" : "最高"}</span>
                <Gap actual={aMax} fc={mx} tone="hot" />
                <span className="dd-slash">/</span>
                <span className="fh-gap-l">{ranged ? "朝" : "最低"}</span>
                <Gap actual={aMin} fc={mn} tone="cold" />
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* 時間帯の表：行が予報と実績、列が時間帯 */}
      <div className="fh-ctab">
        <span className="rh" />
        {SLOTS.map((n) => (
          <span key={n} className="h">
            {n}
          </span>
        ))}

        {/* 予報 */}
        <span className="rh fc">予報</span>
        {ok && s.kind === "VPFW50" ? (
          <span className="c span4">
            <small>日降水確率</small>{" "}
            {numOf(v!.popDay) == null ? "---" : `${numOf(v!.popDay)}%`}
            <Delta
              now={numOf(v!.popDay)}
              before={prev?.values ? numOf(prev.values.popDay) : null}
            />
          </span>
        ) : ok && !v!.wx3 ? (
          // 3時間ごとの天気が無い発表（取り込んだ記録など）：その日の天気の絵を1つ、4列をまたいで。
          // 降水確率は6時間ごとのまま。作った値は入れない。
          <span className="c span4 dayw">
            <Wx s={s} size={18} />
            <span className="pops">
              {[0, 1, 2, 3].map((c) => {
                const q = v!.pop6?.[c];
                const p = numOf(q);
                const past =
                  q === null ||
                  q === undefined ||
                  (s.lead === 0 && p == null && c * 6 <= hourOf(s.at));
                const b = prev?.values?.pop6
                  ? numOf(prev.values.pop6[c])
                  : null;
                return (
                  <span
                    key={c}
                    className={`${past ? "past" : ""}${p != null && b != null && p !== b ? " ch" : ""}`}
                  >
                    {past ? "" : p == null ? "---" : `${p}%`}
                    <Delta now={p} before={b} />
                  </span>
                );
              })}
            </span>
          </span>
        ) : ok ? (
          [0, 1, 2, 3].map((c) => {
            const q = v!.pop6?.[c];
            const p = numOf(q);
            const past =
              q === null ||
              q === undefined ||
              (s.lead === 0 && p == null && c * 6 <= hourOf(s.at));
            const b = prev?.values?.pop6 ? numOf(prev.values.pop6[c]) : null;
            const w = v!.wx3 ? [v!.wx3[c * 2], v!.wx3[c * 2 + 1]] : null;
            return (
              <span
                key={c}
                className={`c fc3${past ? " past" : ""}${p != null && b != null && p !== b ? " ch" : ""}`}
              >
                {/* 3段を固定：絵・値・前の発表からの変化。どの列も同じ高さに並ぶ */}
                <span className="icons">
                  {!past &&
                    w &&
                    w.map((t, k) =>
                      t ? (
                        <WeatherIcon
                          key={k}
                          text={skyText(t)}
                          size={16}
                          night={(c * 2 + k) * 3 < 6 || (c * 2 + k) * 3 >= 18}
                        />
                      ) : (
                        <span key={k} className="w-none" />
                      ),
                    )}
                </span>
                <span className="v">
                  {past ? "" : p == null ? "---" : `${p}%`}
                </span>
                <span className="d">
                  <Delta now={p} before={b} />
                </span>
              </span>
            );
          })
        ) : (
          <span className="c span4 past" />
        )}

        {/* 実績 */}
        <span className="rh ac">実績</span>
        {[0, 1, 2, 3].map((c) => {
          const hs = hours.filter((x) => x.h > c * 6 && x.h <= c * 6 + 6);
          const full = hs.length === 6;
          const sum =
            Math.round(hs.reduce((t, x) => t + (x.precip ?? 0), 0) * 10) / 10;
          const w = [c * 6 + 3, c * 6 + 6].map(
            (h) => hours.find((x) => x.h === h)?.wx ?? null,
          );
          return (
            <span
              key={c}
              className={`c${full ? "" : " past"}${full && sum > 0 ? " ch" : ""}`}
            >
              {full && (
                <span className="icons">
                  {w.map((t, k) =>
                    t ? (
                      <WeatherIcon
                        key={k}
                        text={t}
                        size={16}
                        night={
                          c * 6 + (k + 1) * 3 <= 6 || c * 6 + (k + 1) * 3 > 18
                        }
                      />
                    ) : (
                      <span key={k} className="w-none" />
                    ),
                  )}
                </span>
              )}
              {full ? `${fmt(sum)}mm` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
