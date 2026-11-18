// 1日モード③「この日の予報の移り変わり」(#250, 要件 R6)：その日を、7日前〜当日の発表がどう予報していたか。
// 形は見本（research/forecast-history/sample）で 2026-11-17 に実機で決めた基本形（R6-10〜13）：
//   上：選んだ発表（左）と実績（右）、その下に時間帯の表（予報と実績）
//   グラフ：発表ごとの列に降水確率のマスと気温の階段（降水確率の欄をタップで 1マス／6時間ごと）
//   一覧：発表した日ごとにまとめ、行の右に前の同じ種類の発表からの変化
// データは /api/forecast-history（D1 の行のまま）、何を出すかは shared/forecastHistoryModel.ts。
// 実績はアプリが読んでいる気象庁の値（日の表・1時間ごとの表）。

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { addDays } from "../../../shared/dates";
import type { ForecastHistoryResponse } from "../../../shared/forecastHistory";
import { ForecastHistory as Model, oneSource } from "../../../shared/forecastHistoryModel";
import type { WeatherStore } from "../../data/store";
import { Chip } from "../kit";
import { DayWeatherIcon } from "../WeatherIcon";
import { actualOf } from "./actual";
import { DayRows } from "./DayRows";
import { SplitHeader } from "./SplitHeader";
import { StepChart } from "./StepChart";
import "./forecastHistory.css";

type Loaded = { date: string; station: string; r: ForecastHistoryResponse } | { date: string; station: string; error: true };

/** 今の日本時間（発表の時刻と同じ書き方、"2026-11-17T23:40:00+09:00"）。 */
const jstNow = () => `${new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;

const cache = new Map<string, Promise<ForecastHistoryResponse>>();
function load(station: string, date: string): Promise<ForecastHistoryResponse> {
  const k = `${station}/${date}`;
  let p = cache.get(k);
  if (!p) {
    p = fetch(`/api/forecast-history?station=${encodeURIComponent(station)}&date=${date}`).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<ForecastHistoryResponse>;
    });
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return p;
}

/**
 * `chart`：選んでいる発表の時刻（発表が無い日は null）を受けて、天気図を描く（グラフの下、一覧の上。WxChart と連動）。
 */
export function ForecastHistoryPanel({ store, station, date, chart }: { store: WeatherStore | null; station: string; date: string; chart?: (issued: string | null) => ReactNode }) {
  const [got, setGot] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    load(station, date).then(
      (r) => live && setGot({ station, date, r }),
      () => live && setGot({ station, date, error: true }),
    );
    return () => {
      live = false;
    };
  }, [station, date]);
  const res = got && got.station === station && got.date === date ? got : null;

  const [sel, setSel] = useState<string | null>(null);
  const [scrub, setScrub] = useState<string | null>(null);
  const [pop, setPop] = useState<"detail" | "simple">("simple");
  const [onlyChanged, setOnlyChanged] = useState(false);
  useEffect(() => setSel(null), [station, date]);

  // 回は「今」までの分を並べる（最後に記録のある発表まで、ではない）：記録の無い回も「記録なし」として出す（R5-1）。
  const all = useMemo(() => (res && "r" in res && res.r.supported ? new Model(res.r).slots(date, jstNow()) : []), [res, date]);
  const slots = useMemo(() => oneSource(all), [all]);

  // 実績：その日と前の日（朝 0〜9時の最低の 0時の値）。
  const dayView = store?.getDay(station, date);
  const dayRow = dayView?.state === "ready" ? (dayView.row ?? null) : null;
  const hours = store?.getHours(station, date);
  const prevHours = store?.getHours(station, addDays(date, -1));
  const a = actualOf(dayRow, hours?.state === "ready" ? hours.rows : null);
  const aPrev = actualOf(null, prevHours?.state === "ready" ? prevHours.rows : null);

  const alone = (note: string) => (
    <>
      <p className="fh-note">{note}</p>
      {chart?.(null)}
    </>
  );
  if (!res) return alone("予報の移り変わりを読み込み中…");
  if ("error" in res) return alone("予報の移り変わりを読み込めませんでした。時間をおいて開き直してください。");
  if (!res.r.supported) return alone("この地点の予報の移り変わりは、まだありません（今は高知だけ）。");
  if (!slots.some((s) => s.state === "ok")) return alone("この日を予報した発表の記録はありません。");

  // 上に出す発表：なぞっている間は指の下、離したら選んだ発表。何も選んでいなければいちばん新しい発表。
  const latest = [...slots].reverse().find((z) => z.state === "ok" && z.values)?.key ?? null;
  const focusKey = scrub ?? sel ?? latest;
  const focusSlot = slots.find((s) => s.key === focusKey) ?? null;
  const onScrub = (k: string | null, phase: "move" | "end") => {
    if (phase === "move") return setScrub(k);
    setScrub(null);
    if (k) setSel(k);
  };

  return (
    <div className="fh">
      {focusSlot && (
        <SplitHeader s={focusSlot} slots={slots} day={date} a={a} aPrev={aPrev} dayIcon={dayRow && dayRow.type !== "forecast" ? <DayWeatherIcon row={dayRow} station={station} size={32} /> : null} />
      )}
      <StepChart
        slots={slots}
        day={date}
        focus={focusKey}
        onScrub={onScrub}
        onSelect={setSel}
        pop={pop}
        hint
        onTogglePop={() => setPop((v) => (v === "simple" ? "detail" : "simple"))}
      />
      {/* なぞっている間は変えず、離して選んだ発表で（絵の読み込みを指の速さで走らせない）。 */}
      {chart?.(((k) => (k && k.state === "ok" ? k.at : null))(slots.find((s) => s.key === (sel ?? latest)) ?? null))}
      {/* 絞り込みは一覧の見出しの右に小さく（2026-11-18：全幅の切り替えをやめて短く） */}
      <div className="fh-rows-head">
        <span>発表の一覧</span>
        <Chip size="sm" on={onlyChanged} onClick={() => setOnlyChanged(!onlyChanged)}>
          変わった発表だけ
        </Chip>
      </div>
      <DayRows slots={slots} all={all} day={date} selected={focusKey} onSelect={setSel} onlyChanged={onlyChanged} />
      <p className="fh-credit">出典：気象庁（府県天気予報・府県週間天気予報、防災情報XML）</p>
    </div>
  );
}
