// 予報の履歴 R6 の見本：上の枠を「左に予報、右に実績」に分ける案（2026-11-17）。
// - 上の段：左に選んだ発表（天気の絵・最高／最低と前の発表からの差・種類の札）、右に対象日の実績。
// - 下の段：時間帯の表を1つにまとめ、行を「予報」「実績」に分ける。同じ時間帯の列で上下に見比べられる。
//   府県天気予報は4つの時間帯ごと、週間は「1日」で4列をまたぐ1マス。過ぎた時間帯は斜線の空き枠。

import { WeatherIcon } from "../../../src/ui/WeatherIcon";
import type { ActualDay } from "./Actual";
import {
  hourOf,
  KIND_SHORT,
  leadLabel,
  md,
  skyText,
  type Slot,
  STATE_TEXT,
} from "./model";
import { Wx } from "./Transition";

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
}: {
  s: Slot;
  slots: Slot[];
  day: string;
  a: ActualDay | null | undefined;
}) {
  const ok = s.state === "ok" && !!s.values;
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

  return (
    <div className="fh-split">
      <div className="fh-split-cols">
        {/* 左：予報 */}
        <div className="fh-split-col">
          <div className="fh-split-top">
            <span className="fh-split-pic">
              {ok ? (
                <Wx s={s} size={40} />
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
        </div>
        {/* 右：実績 */}
        <div className="fh-split-col actual">
          <div className="fh-split-top">
            <span className="fh-split-pic">
              {a?.wxDay ? (
                <WeatherIcon text={a.wxDay} size={40} />
              ) : (
                <span className="fh-focus-nopic small" />
              )}
            </span>
            <span className="fh-split-temps">
              {a && done ? (
                <>
                  <span className="tone-hot">{fmt(a.max)}</span>
                  <span className="dd-slash">/</span>
                  <span className="tone-cold">{fmt(a.min)}</span>
                </>
              ) : null}
            </span>
          </div>
          <div className="fh-split-meta">
            <span className="fh-kchip actual">実績</span>
            <span>{md(day)}</span>
            {!done && (
              <span className="fh-lead">
                {hours.length ? `${hours[hours.length - 1].h}時まで` : "まだ"}
              </span>
            )}
          </div>
          {/* 予報との差（実績 − 選んだ発表の予報）。▲▼（前の発表からの変化）と取り違えないよう、符号つきの数字と「差」の札で */}
          <div className="fh-gap">
            {done && a && (mx != null || mn != null) ? (
              <>
                <span className="fh-gap-l">最高</span>
                <Gap actual={a.max} fc={mx} tone="hot" />
                <span className="dd-slash">/</span>
                <span className="fh-gap-l">最低</span>
                <Gap actual={a.min} fc={mn} tone="cold" />
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
                className={`c${past ? " past" : ""}${p != null && b != null && p !== b ? " ch" : ""}`}
              >
                {!past && w && (
                  <span className="icons">
                    {w.map((t, k) =>
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
                )}
                {past ? "" : p == null ? "---" : `${p}%`}
                <Delta now={p} before={b} />
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
