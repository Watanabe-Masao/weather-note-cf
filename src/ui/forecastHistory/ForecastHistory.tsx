// 1日モード③「この日の予報の移り変わり」(#250, 要件 R6)：その日を、7日前〜当日の発表がどう予報していたか。
// 形は見本（research/forecast-history/sample）で 2026-11-17 に実機で決めた基本形（R6-10〜13）：
//   上：選んだ発表（左）と実績（右）、その下に時間帯の表（予報と実績）
//   グラフ：発表ごとの列に降水確率のマスと気温の階段（降水確率の欄をタップで 1マス／6時間ごと）
//   一覧：発表した日ごとにまとめ、行の右に前の同じ種類の発表からの変化
// データは /api/forecast-history（D1 の行のまま）、何を出すかは shared/forecastHistoryModel.ts。
// 実績はアプリが読んでいる気象庁の値（日の表・1時間ごとの表）。

import { useEffect, useMemo, useState } from "react";
import { addDays } from "../../../shared/dates";
import type { ForecastHistoryResponse } from "../../../shared/forecastHistory";
import { ForecastHistory as Model, oneSource } from "../../../shared/forecastHistoryModel";
import type { WeatherStore } from "../../data/store";
import { Segmented } from "../kit";
import { DayWeatherIcon } from "../WeatherIcon";
import { actualOf } from "./actual";
import { DayRows } from "./DayRows";
import { SplitHeader } from "./SplitHeader";
import { StepChart } from "./StepChart";
import "./forecastHistory.css";

type Loaded = { date: string; station: string; r: ForecastHistoryResponse } | { date: string; station: string; error: true };

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

export function ForecastHistoryPanel({ store, station, date }: { store: WeatherStore | null; station: string; date: string }) {
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

  const all = useMemo(() => (res && "r" in res && res.r.supported ? new Model(res.r).slots(date) : []), [res, date]);
  const slots = useMemo(() => oneSource(all), [all]);

  // 実績：その日と前の日（朝 0〜9時の最低の 0時の値）。
  const dayView = store?.getDay(station, date);
  const dayRow = dayView?.state === "ready" ? (dayView.row ?? null) : null;
  const hours = store?.getHours(station, date);
  const prevHours = store?.getHours(station, addDays(date, -1));
  const a = actualOf(dayRow, hours?.state === "ready" ? hours.rows : null);
  const aPrev = actualOf(null, prevHours?.state === "ready" ? prevHours.rows : null);

  if (!res) return <p className="fh-note">予報の移り変わりを読み込み中…</p>;
  if ("error" in res) return <p className="fh-note">予報の移り変わりを読み込めませんでした。時間をおいて開き直してください。</p>;
  if (!res.r.supported) return <p className="fh-note">この地点の予報の移り変わりは、まだありません（今は高知だけ）。</p>;
  if (!slots.some((s) => s.state === "ok")) return <p className="fh-note">この日を予報した発表の記録はありません。</p>;

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
        <SplitHeader s={focusSlot} slots={slots} day={date} a={a} aPrev={aPrev} dayIcon={dayRow && dayRow.type !== "forecast" ? <DayWeatherIcon row={dayRow} station={station} size={40} /> : null} />
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
      <Segmented
        label="行の絞り込み"
        value={onlyChanged ? "changed" : "all"}
        onChange={(v) => setOnlyChanged(v === "changed")}
        options={[
          { id: "all", label: "すべての発表" },
          { id: "changed", label: "変わった発表だけ" },
        ]}
      />
      <DayRows slots={slots} all={all} day={date} selected={focusKey} onSelect={setSel} onlyChanged={onlyChanged} />
      <p className="fh-credit">出典：気象庁（府県天気予報・府県週間天気予報、防災情報XML）</p>
    </div>
  );
}
