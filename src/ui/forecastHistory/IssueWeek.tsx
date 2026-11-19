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
        <WeekTable rows={rows} issue={issue} day={day} title={title} weekly={r.weekly} />
      )}
    </ModalSheet>,
    document.body,
  );
}

/** 府県は 6時間ごとの降水確率のいちばん大きい値（表の1マスに入れるため。全部は下の欄に）。 */
const popMax = (v: DayValues) => {
  if (v.popDay) return v.popDay;
  const vals = (v.pop6 ?? []).filter((p): p is NonNullable<typeof p> => p !== null && p.s === "value");
  if (!vals.length) return (v.pop6 ?? []).find((p) => p !== null) ?? null;
  return vals.reduce((a, b) => (Number((b as { v: number }).v) > Number((a as { v: number }).v) ? b : a));
};

/**
 * 横に日が並ぶ表（11/19 渡辺さん「週間天気予報は基本的に横が見慣れている」）：気象庁の週間天気予報と同じ向き。
 * 上の帯にどの発表の値か（府県・週間）。行は 天気・降水確率・最高・最低・信頼度。列を押すと、その日の天気の言葉と
 * 6時間ごとの降水確率を下に出す（はじめは 1日モードの日）。
 */
function WeekTable({ rows, issue, day, title, weekly }: { rows: ReturnType<typeof issueDays>; issue: IssueRow; day: string; title: string; weekly: IssueRow | null }) {
  const [pick, setPick] = useState(() => (rows.some((r) => r.day === day) ? day : rows[0].day));
  const groups = rows.reduce<{ from: IssueRow; n: number }[]>((g, r) => {
    const last = g.at(-1);
    if (last && last.from.issue_id === r.from.issue_id) last.n++;
    else g.push({ from: r.from, n: 1 });
    return g;
  }, []);
  const sel = rows.find((r) => r.day === pick) ?? rows[0];
  const selW = sel.v.weather.s === "value" ? (sel.v.weather as { name?: string | null }).name : null;
  return (
    <>
      <div className="fh-wk-scroll">
        <div className="fh-wk" style={{ gridTemplateColumns: `auto repeat(${rows.length}, minmax(${"var(--wk-col)"}, 1fr))` }} role="grid" aria-label={`${title}の日ごとの予報`}>
          <span className="fh-wk-h" />
          {groups.map((g, i) => (
            <span key={i} className={`fh-wk-band ${g.from.kind}`} style={{ gridColumn: `span ${g.n}` }}>
              {KIND_SHORT[g.from.kind as Kind]} {md(jstDate(g.from.issued_at))} {hourOf(g.from.issued_at)}時
            </span>
          ))}
          <span className="fh-wk-h">日付</span>
          {rows.map(({ day: d }) => (
            <button key={d} type="button" className={`fh-wk-day${d === pick ? " on" : ""}${d === day ? " target" : ""}`} aria-pressed={d === pick} aria-label={`${md(d)}（${weekday(d)}）${d === day ? "、この日" : ""}`} onClick={() => setPick(d)}>
              <b>{md(d)}</b>
              <small>{weekday(d)}</small>
            </button>
          ))}
          <span className="fh-wk-h">天気</span>
          {rows.map(({ day: d, v }) => {
            const w = v.weather.s === "value" ? (v.weather as { name?: string | null }) : null;
            return (
              <span key={d} className={`fh-wk-c${d === pick ? " on" : ""}`}>
                {w?.name ? <WeatherIcon text={skyText(w.name)} size={26} /> : <span className="fh-dash">—</span>}
              </span>
            );
          })}
          <span className="fh-wk-h">降水 %</span>
          {rows.map(({ day: d, v }) => (
            <span key={d} className={`fh-wk-c${d === pick ? " on" : ""}`}>
              <Val v={popMax(v)} tone="rain" />
            </span>
          ))}
          <span className="fh-wk-h">最高</span>
          {rows.map(({ day: d, v }) => (
            <span key={d} className={`fh-wk-c${d === pick ? " on" : ""}`}>
              <Val v={v.max} tone="hot" />
            </span>
          ))}
          <span className="fh-wk-h">最低</span>
          {rows.map(({ day: d, v }) => (
            <span key={d} className={`fh-wk-c${d === pick ? " on" : ""}`}>
              <Val v={v.min} tone="cold" />
            </span>
          ))}
          {rows.some((r) => r.v.reliability?.s === "value") && (
            <>
              <span className="fh-wk-h">信頼度</span>
              {rows.map(({ day: d, v }) => (
                <span key={d} className={`fh-wk-c${d === pick ? " on" : ""}`}>
                  {v.reliability?.s === "value" ? String(v.reliability.v) : <span className="fh-dash">—</span>}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
      {/* 押した日の言葉と、6時間ごとの降水確率（府県） */}
      <p className="fh-wk-detail">
        <b>
          {md(sel.day)}（{weekday(sel.day)}）{sel.day === day ? "・この日" : ""}
        </b>
        <span>{breakable(selW ?? "—")}</span>
        <span>
          <small className="fh-lbl">降水 </small>
          <Pop v={sel.v} />
          {!sel.v.popDay && <small className="fh-lbl">（6時間ごと）</small>}
        </span>
        <small className="fh-lbl">
          {KIND_SHORT[sel.from.kind as Kind]} {md(jstDate(sel.from.issued_at))} {hourOf(sel.from.issued_at)}時の発表
        </small>
      </p>
      <small className="set-help">
        {issue.kind === "VPFD51" && weekly
          ? `府県天気予報は3日先まで。それより先は、その時点の週間天気予報（${md(jstDate(weekly.issued_at))} ${hourOf(weekly.issued_at)}時）の値です。府県の降水確率は、6時間ごとのいちばん大きい値。`
          : "発表したときの値のまま（あとで変わった値は、予報の移り変わりで見られます）。"}
      </small>
    </>
  );
}
