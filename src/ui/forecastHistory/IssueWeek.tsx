// その発表の週間天気予報（2026-11-19 渡辺さん「発表の一覧の行をタップすると、ボトムシートで押した該当日の週間天気予報」）。
// 発表の一覧の行を押すと開く。その発表が予報した先の日ぜんぶを、日ごとに1行で（天気・最高／最低・降水確率・信頼度）。
// 府県天気予報（3日まで）のときは、その時点でいちばん新しい週間天気予報で 4日目より先を埋め、どちらの発表かを行に添える。
// 値の読み方は予報の移り変わりと同じ（shared/forecastHistoryModel の valuesFor）。対象日（1日モードの日）の行に印。
import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ForecastIssueResponse } from "../../../shared/forecastHistory";
import { hourOf, jstDate, KIND_NAME, KIND_SHORT, type Kind, md, type DayValues, weekday, skyText, type IssueRow } from "../../../shared/forecastHistoryModel";
import { ModalSheet } from "../ModalSheet";
import { WeatherIcon } from "../WeatherIcon";
import { breakable, Val } from "./parts";
import { issueDays } from "./issueDays";

const cache = new Map<string, Promise<ForecastIssueResponse>>();
function load(station: string, id: string) {
  const k = `${station}/${id}`;
  let p = cache.get(k);
  if (!p) {
    p = fetch(`/api/forecast-issue?station=${encodeURIComponent(station)}&id=${encodeURIComponent(id)}`).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<ForecastIssueResponse>;
    });
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return p;
}

/** 降水確率：週間は日の確率、府県は 6時間ごと（過ぎた区切りは書かない）。 */
function Pop({ v }: { v: DayValues }) {
  if (v.popDay) return <Val v={v.popDay} unit="%" tone="rain" />;
  const pops = (v.pop6 ?? []).map((p, i) => ({ p, i })).filter((x) => x.p !== null);
  if (!pops.length) return <span className="fh-dash">—</span>;
  return (
    <>
      {pops.map(({ p, i }, j) => (
        <Fragment key={i}>
          {j > 0 && <small className="fh-sl">・</small>}
          <Val v={p} tone="rain" />
        </Fragment>
      ))}
      <small className="fh-lbl">%</small>
    </>
  );
}

export function IssueWeekSheet({ station, issue, day, onClose }: { station: string; issue: IssueRow; day: string; onClose: () => void }) {
  const [r, setR] = useState<ForecastIssueResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    load(station, issue.issue_id).then(
      (x) => live && setR(x),
      () => live && setError(true),
    );
    return () => {
      live = false;
    };
  }, [station, issue.issue_id]);
  const at = issue.issued_at;
  const title = `${md(jstDate(at))}（${weekday(jstDate(at))}）${hourOf(at)}時の${KIND_NAME[issue.kind as Kind] ?? "発表"}`;
  const rows = r && r.supported && r.found ? issueDays(r) : [];
  return createPortal(
    <ModalSheet title={title} onClose={onClose} className="fh-week-sheet">
      {error ? (
        <p className="warn">この発表を読み込めませんでした。時間をおいて開き直してください。</p>
      ) : !r ? (
        <p className="set-help">読み込んでいます…</p>
      ) : !r.supported || !r.found || !rows.length ? (
        <p className="set-help">この発表の先の日の値は保存されていません。</p>
      ) : (
        <>
          <ol className="fh-week" aria-label={`${title}の日ごとの予報`}>
            {rows.map(({ day: d, from, v }) => {
              const w = v.weather.s === "value" ? (v.weather as { name?: string | null }) : null;
              return (
                <li key={d} className={d === day ? "fh-week-row on" : "fh-week-row"} aria-current={d === day ? "date" : undefined}>
                  <span className="fh-week-day">
                    <b>{md(d)}</b>
                    <small>（{weekday(d)}）</small>
                    {d === day && <small className="fh-week-mark">この日</small>}
                  </span>
                  <span className="fh-week-wx">{w?.name ? <WeatherIcon text={skyText(w.name)} size={24} /> : <span className="fh-dash">—</span>}</span>
                  <span className="fh-week-name">{breakable(w?.name ?? "—")}</span>
                  <span className="fh-week-temp">
                    <Val v={v.max} tone="hot" />
                    <small className="fh-sl">/</small>
                    <Val v={v.min} tone="cold" />
                  </span>
                  <span className="fh-week-pop">
                    <small className="fh-lbl">降水 </small>
                    <Pop v={v} />
                  </span>
                  <span className="fh-week-src">
                    {from.issue_id !== issue.issue_id ? (
                      <small className={`fh-kchip ${from.kind}`}>
                        {KIND_SHORT[from.kind as Kind]} {hourOf(from.issued_at)}時
                      </small>
                    ) : v.reliability?.s === "value" ? (
                      <small>信頼度{String(v.reliability.v)}</small>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
          <small className="set-help">
            {issue.kind === "VPFD51" && r.weekly
              ? `府県天気予報は3日先まで。それより先は、その時点の週間天気予報（${md(jstDate(r.weekly.issued_at))} ${hourOf(r.weekly.issued_at)}時）の値です。`
              : "発表したときの値のまま（あとで変わった値は、予報の移り変わりで見られます）。"}
          </small>
        </>
      )}
    </ModalSheet>,
    document.body,
  );
}
