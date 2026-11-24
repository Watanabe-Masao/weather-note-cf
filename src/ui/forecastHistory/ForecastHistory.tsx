// 1日モード③「この日の予報の移り変わり」(#250, 要件 R6)：その日を、7日前〜当日の発表がどう予報していたか。
// 形は見本（research/forecast-history/sample）で 2026-11-17 に実機で決めた基本形（R6-10〜13）：
//   上：選んだ発表（左）と実績（右）、その下に時間帯の表（予報と実績）
//   グラフ：発表ごとの列に降水確率のマスと気温の階段（降水確率の欄をタップで 1マス／6時間ごと）
//   一覧：発表した日ごとにまとめ、行の右に前の同じ種類の発表からの変化
// データは /api/forecast-history（D1 の行のまま）、何を出すかは shared/forecastHistoryModel.ts。
// 実績はアプリが読んでいる気象庁の値（日の表・1時間ごとの表）。

import { type ReactNode, useMemo, useState } from "react";
import { addDays } from "../../../shared/dates";
import { ForecastHistory as Model, oneSource } from "../../../shared/forecastHistoryModel";
import type { WeatherStore } from "../../data/store";
import { Chip } from "../kit";
import { DayWeatherIcon } from "../WeatherIcon";
import { actualOf } from "./actual";
import { DayRows } from "./DayRows";
import { SplitHeader } from "./SplitHeader";
import { StepChart } from "./StepChart";
import { Sources } from "./Sources";
import { IssueWeekSheet } from "./IssueWeek";
import { pickIssue, usePickedIssue } from "../../data/forecastPick";
import { historyCache, useForecastHistory } from "../../data/historyCache";
import { shownChanges } from "../../../shared/forecastChanges";
import { ChangeList } from "./ChangeList";
import "./forecastHistory.css";

/** 今の日本時間（発表の時刻と同じ書き方、"2026-11-17T23:40:00+09:00"）。 */
const jstNow = () => `${new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;

/** 1日分の発表（/api/forecast-history）。時間帯のグラフの「気象庁の予報」も同じ取り置きを読む（src/data/historyCache.ts）。 */
export const loadForecastHistory = (station: string, date: string) => historyCache.load(station, date);

const hm = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(11, 16);

/**
 * `chart`：選んでいる発表の時刻（発表が無い日は null）を受けて、天気図を描く（グラフの下、一覧の上。WxChart と連動）。
 */
export function ForecastHistoryPanel({ store, station, date, chart }: { store: WeatherStore | null; station: string; date: string; chart?: (issued: string | null) => ReactNode }) {
  // 今日と先の日は、開いたとき・アプリに戻ったときに、10分たっていれば取り直す（2026-11-24）。
  const h = useForecastHistory(station, date);
  type Res = { r: NonNullable<typeof h.r> } | { error: true };
  const res: Res | null = h.r ? { r: h.r } : h.failed ? { error: true } : null;
  // いつ取れた分か：取り直し中・取り直せなかったときも、最後に取れた分を出したまま時刻を添える。
  const checked = h.at == null ? null : h.loading ? `${hm(h.at)} の分・確かめています…` : h.failed ? `${hm(h.at)} の分（取り直せませんでした）` : `${hm(h.at)} に確認`;

  // 選んだ回は時間帯のグラフと共有（src/data/forecastPick.ts）：ここで押した回の3時間ごとの気温がグラフに出る。
  const sel = usePickedIssue(station, date);
  const setSel = (k: string | null) => pickIssue(station, date, k);
  const [scrub, setScrub] = useState<string | null>(null);
  const [pop, setPop] = useState<"detail" | "simple">("simple");
  const [onlyChanged, setOnlyChanged] = useState(false);
  // 行を押すと、その発表の週間天気予報（11/19）
  const [weekKey, setWeekKey] = useState<string | null>(null);

  // 回は「今」までの分を並べる（最後に記録のある発表まで、ではない）：記録の無い回も「記録なし」として出す（R5-1）。
  const all = useMemo(() => (res && "r" in res && res.r.supported ? new Model(res.r).slots(date, jstNow()) : []), [res, date]);
  const slots = useMemo(() => oneSource(all), [all]);
  // この日の予報の変化（2026-11-24）：同じ種類の発表どうしで、雨の有無・降水確率・最高と最低（shared/forecastChanges.ts）。
  const changes = useMemo(() => shownChanges(all), [all]);

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
      <ChangeList changes={changes} onPick={setSel} />
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
        <span>
          発表の一覧{checked && <small className="fh-checked">{checked}</small>}
        </span>
        <Chip size="sm" on={onlyChanged} onClick={() => setOnlyChanged(!onlyChanged)}>
          変わった発表だけ
        </Chip>
      </div>
      <DayRows slots={slots} all={all} day={date} selected={focusKey} onSelect={setSel} onOpen={setWeekKey} onlyChanged={onlyChanged} />
      {(() => {
        const w = slots.find((s) => s.key === weekKey);
        return w?.shown ? <IssueWeekSheet station={station} issue={w.shown} day={date} onClose={() => setWeekKey(null)} /> : null;
      })()}
      <Sources slot={focusSlot} station={station} day={date} office={res.r.supported ? res.r.places.office : null} />
    </div>
  );
}
