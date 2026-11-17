// 予報の履歴 R6 の見本（#250）：触って確かめる用。アプリ本体には組み込まない。
// データは build-data.ts が本物の処理（parseForecastXml / parseShiromatzCsv → issueStatements → choosePreferred）で作った行。

import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles.css";
import {
  applyTheme,
  THEME_LABEL,
  THEME_NAMES,
  type ThemeName,
} from "../../../src/design/tokens";
import { Glyph, Segmented, SectionHead } from "../../../src/ui/kit";
import { type KindFilter, type Item, type Layout, Matrix } from "./Matrix";
import {
  blanksOf,
  Data,
  type EntryRow,
  issueLabel,
  KIND_NAME,
  md,
  type Scenario,
  type Slot,
  sourceName,
  STATE_NOTE,
  STATE_TEXT,
  summarize,
  oneSource,
  weekday,
} from "./model";
import "./sample.css";
import { TransitionChart, TransitionRows, TransitionSteps } from "./Transition";
import { FocusSay, OneChart } from "./OneChart";
import { StepChart } from "./StepChart";
import { SplitHeader } from "./SplitHeader";
import { type ActualDay, ActualBlock } from "./Actual";

type Sc = Scenario & {
  telegrams?: {
    id: string;
    fetched_at: string;
    parser: number;
    parsed: string | null;
  }[];
  imported?: {
    fetched_at: string;
    commit_sha: string;
    file_hash: string;
    url: string;
  }[];
  note?: string;
};
const DEFAULT_DAY: Record<string, string> = {
  oct: "2026-10-25",
  nov: "2026-11-18",
  syn: "2026-11-18",
};
const SC_NOTE: Record<string, string> = {
  oct: "実データ。shiromatz の記録（2026年10月、高知 390000）を取り込みの処理に通したもの。",
  nov: "実データ。手元にある電文は fixtures の4通（11/16 17時〜11/17 11時）だけなので、それより前の回は「記録なし」と出る（本番の D1 にはある）。",
  syn: "値は 11月の実際の電文。訂正・取り消し・取得失敗は、それを元に作った合成。",
};

applyTheme("navy");

/** 取得時刻は UTC で保存されている：見せるときは発表時刻と同じ日本時間に。 */
const jst = (iso: string) =>
  new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 19) +
  "+09:00";

function Actual({ day }: { day: string }) {
  return (
    <div className="fh-actual">
      <b>実績</b>
      <span>
        {md(day)}（{weekday(day)}）の実績は、本体では
        WeatherStore（気象庁の過去データ）から出す。見本ではつないでいない。
      </span>
    </div>
  );
}

function Provenance({
  s,
  sc,
  day,
  hint,
}: {
  s: Slot | null;
  sc: Sc;
  day?: string;
  hint: string;
}) {
  if (!s) return <p className="fh-note">{hint}</p>;
  const blanks = blanksOf(s);
  const t = s.shown && sc.telegrams?.find((x) => x.id === s.shown!.issue_id);
  const imp = s.shown?.source === "shiromatz" ? sc.imported?.[0] : null;
  const places = s.values
    ? [
        ...new Set(
          (["weather", "max"] as const)
            .map((k) =>
              s.values![k].s !== "absent"
                ? (s.values![k] as { entry: EntryRow }).entry.place_name
                : null,
            )
            .filter(Boolean),
        ),
      ]
    : [];
  const sentence =
    s.values?.weather.s === "value"
      ? (s.values.weather as { sentence?: string | null }).sentence
      : null;
  return (
    <div className="fh-prov">
      <p className="fh-prov-head">
        <b>{issueLabel(s.at)}</b> {KIND_NAME[s.kind]}
        {day && (
          <span>
            の {md(day)}（{weekday(day)}）
          </span>
        )}
        {s.state !== "ok" && (
          <span className={`fh-state ${s.state}`}>{STATE_TEXT[s.state]}</span>
        )}
      </p>
      <dl>
        {blanks.length > 0 && (
          <>
            <dt>「—」の理由</dt>
            <dd>
              {blanks.map((b) => (
                <span key={b.item} className="fh-copy">
                  {b.item}：{b.reason}
                </span>
              ))}
            </dd>
          </>
        )}
        {s.state !== "ok" && (
          <>
            <dt>状態</dt>
            <dd>
              {STATE_NOTE[s.state]}
              {s.failures.map((f) => (
                <span key={f.at} className="fh-mono">
                  {f.at}　{f.error}
                </span>
              ))}
            </dd>
          </>
        )}
        {s.shown && (
          <>
            <dt>出どころ</dt>
            <dd>
              {s.shown.source === "jma-xml"
                ? "気象庁（防災情報XML）・自前の電文"
                : "気象庁の予報（shiromatz/Japan-Meteorological-Agency-Weather-Forecast の記録、CC BY-SA 4.0）"}
            </dd>
            <dt>発表時刻</dt>
            <dd className="fh-mono">{s.at}</dd>
            <dt>取得時刻</dt>
            <dd className="fh-mono">
              {t
                ? `${jst(t.fetched_at)}（保存は UTC：${t.fetched_at}）`
                : imp
                  ? `${jst(imp.fetched_at)}（月の zip を取った時刻）`
                  : "—"}
            </dd>
            {places.length > 0 && (
              <>
                <dt>区域・地点</dt>
                <dd>{places.join("・")}</dd>
              </>
            )}
            {sentence && (
              <>
                <dt>天気の文</dt>
                <dd>{sentence}</dd>
              </>
            )}
            {s.values &&
              s.values.max.s === "value" &&
              s.values.max.lower != null && (
                <>
                  <dt>予測範囲</dt>
                  <dd>
                    最高 {s.values.max.lower}〜{s.values.max.upper}℃・最低{" "}
                    {s.values.min.s === "value"
                      ? `${s.values.min.lower}〜${s.values.min.upper}℃`
                      : "—"}
                  </dd>
                </>
              )}
            <dt>発表の ID</dt>
            <dd className="fh-mono">{s.shown.issue_id}</dd>
            <dt>解析器</dt>
            <dd>
              版 {s.shown.parser}
              {s.shown.problems
                ? `（読めなかった所：${s.shown.problems}）`
                : ""}
            </dd>
          </>
        )}
        {s.copies.length > 1 && (
          <>
            <dt>同じ発表</dt>
            <dd>
              {s.copies.map((c) => (
                <span key={c.issue_id} className="fh-copy">
                  {c.preferred ? "表示中　" : "表示しない　"}
                  {c.info_type}・{sourceName(c.source)}
                  {c.revision_of ? `（${c.revision_of} の訂正）` : ""}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

function App({
  SCENARIOS,
  ACTUALS,
}: {
  SCENARIOS: Sc[];
  ACTUALS: Record<string, ActualDay>;
}) {
  const [theme, setTheme] = useState<ThemeName>("navy");
  const [scId, setScId] = useState("oct");
  const sc = SCENARIOS.find((s) => s.id === scId)!;
  const data = useMemo(() => new Data(sc), [sc]);
  const days = useMemo(() => data.days(), [data]);
  const [dayBy, setDayBy] = useState<Record<string, string>>(DEFAULT_DAY);
  const day = days.includes(dayBy[scId]) ? dayBy[scId] : days[days.length - 1];
  const setDay = (d: string) => setDayBy({ ...dayBy, [scId]: d });
  const [plan, setPlan] = useState<
    "step" | "oneTone" | "oneDash" | "combo" | "chart" | "table" | "steps"
  >("step");
  const [scrub, setScrub] = useState<string | null>(null);
  const [release, setRelease] = useState<"keep" | "back">("keep");
  const [recent, setRecent] = useState(true);
  const [axis, setAxis] = useState<"date" | "clock">("date");
  const [head, setHead] = useState<"split" | "stack">("split");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [cell, setCell] = useState<{ key: string; day: string } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>("all");
  const [item, setItem] = useState<Item>("weather");
  const [kind, setKind] = useState<KindFilter>("VPFW50");
  const [row, setRow] = useState<string | null>(null);
  const [width, setWidth] = useState<"390" | "360" | "full">("390");
  const allSlots = useMemo(() => data.slots(day), [data, day]);
  const one = plan === "oneTone" || plan === "oneDash" || plan === "step";
  // 1枚のグラフの案では、同じ時刻は数値を持つ方だけ（表示の決まり、model.ts の oneSource）。
  const slots = useMemo(
    () => (one ? oneSource(allSlots) : allSlots),
    [one, allSlots],
  );
  const lines = useMemo(() => summarize(slots), [slots]);
  const selected = slots.find((s) => s.key === sel) ?? null;
  // 上の文に出す発表：なぞっている間は指の下、離したら「残す」なら選んだ発表、「戻す」なら要約。
  // 何も選んでいないときは、いちばん新しい発表（数値を持つもの）を上に出す（文の要約は出さない）。
  const latest =
    [...slots].reverse().find((z) => z.state === "ok" && z.values)?.key ?? null;
  const focusKey = one
    ? (scrub ?? (release === "keep" ? (sel ?? latest) : latest))
    : null;
  const focusSlot = slots.find((s) => s.key === focusKey) ?? null;
  const onScrub = (k: string | null, phase: "move" | "end") => {
    if (phase === "move") return setScrub(k);
    setScrub(null);
    if (release === "keep" && k) setSel(k);
  };
  const cellSlot = useMemo(
    () =>
      cell
        ? (data.slots(cell.day).find((s) => s.key === cell.key) ?? null)
        : null,
    [data, cell],
  );
  const i = days.indexOf(day);
  applyTheme(theme);
  const counts = slots.reduce<Record<string, number>>(
    (a, s) => ({ ...a, [s.state]: (a[s.state] ?? 0) + 1 }),
    {},
  );
  return (
    <div className={`fh-page w-${width}`} key={theme}>
      <header className="fh-bar">
        <p className="fh-title">予報の履歴 R6 の見本</p>
        <div className="fh-ctl">
          <Segmented
            label="データ"
            value={scId}
            onChange={(v) => {
              setScId(v);
              setSel(null);
              setRow(null);
              setCell(null);
            }}
            options={SCENARIOS.map((s) => ({
              id: s.id,
              label:
                s.id === "oct"
                  ? "10月 記録"
                  : s.id === "nov"
                    ? "11月 電文"
                    : "合成の状態",
            }))}
          />
          <Segmented
            label="テーマ"
            value={theme}
            onChange={setTheme}
            options={THEME_NAMES.map((t) => ({
              id: t,
              label: THEME_LABEL[t].split(" ")[0],
            }))}
          />
          <Segmented
            label="幅"
            value={width}
            onChange={setWidth}
            options={[
              { id: "390", label: "390" },
              { id: "360", label: "360" },
              { id: "full", label: "全幅" },
            ]}
          />
        </div>
        <div className="fh-ctl">
          <Segmented
            label="案"
            value={plan}
            onChange={setPlan}
            options={[
              { id: "step", label: "案G 階段・マス" },
              { id: "oneTone", label: "1枚・色" },
              { id: "oneDash", label: "1枚・線" },
              { id: "combo", label: "案D 組合せ" },
              { id: "table", label: "案B 行" },
              { id: "chart", label: "案A 線" },
              { id: "steps", label: "案C 変化" },
            ]}
          />
          {one && (
            <Segmented
              label="指を離したら"
              value={release}
              onChange={(v) => {
                setRelease(v);
                setScrub(null);
              }}
              options={[
                { id: "keep", label: "その発表を残す" },
                { id: "back", label: "最新に戻す" },
              ]}
            />
          )}
          <Segmented
            label="上の枠"
            value={head}
            onChange={setHead}
            options={[
              { id: "split", label: "左右" },
              { id: "stack", label: "上下" },
            ]}
          />
        </div>
        <p className="fh-note">{SC_NOTE[scId]}</p>
      </header>

      <main className="fh-main">
        <div className="fh-daynav">
          <button
            className="fh-navbtn"
            onClick={() => i > 0 && setDay(days[i - 1])}
            disabled={i <= 0}
            aria-label="前の日"
          >
            <Glyph name="prev" />
          </button>
          <span className="fh-day">
            対象日{" "}
            <b>
              {md(day)}（{weekday(day)}）
            </b>
          </span>
          <button
            className="fh-navbtn"
            onClick={() => i < days.length - 1 && setDay(days[i + 1])}
            disabled={i >= days.length - 1}
            aria-label="次の日"
          >
            <Glyph name="next" />
          </button>
        </div>

        <section
          className="day-detail fh-dd"
          aria-label="1日モード ③ 根拠と記録"
        >
          <div className="dd-sec">
            <SectionHead title="この日の予報の移り変わり" as="h3">
              <small className="dd-hint">③ 根拠と記録</small>
            </SectionHead>
            {focusSlot ? (
              head === "split" ? (
                <SplitHeader
                  s={focusSlot}
                  slots={slots}
                  day={day}
                  a={ACTUALS[day]}
                />
              ) : (
                <>
                  <FocusSay s={focusSlot} slots={slots} />
                  <ActualBlock day={day} a={ACTUALS[day]} />
                </>
              )
            ) : lines.length ? (
              <ul className="fh-say">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : (
              <p className="fh-say none">
                発表のあいだで、天気・降水確率・気温は変わらなかった。
              </p>
            )}
            {!one && (
              <p className="fh-count">
                {slots.length}回の発表のうち {counts.ok ?? 0}回
                {Object.entries(counts)
                  .filter(([k]) => k !== "ok")
                  .map(([k, n]) => `・${STATE_TEXT[k as Slot["state"]]} ${n}回`)
                  .join("")}
              </p>
            )}
            <div className="fh-plan">
              {one && (
                <>
                  {plan === "step" ? (
                    <>
                      <StepChart
                        slots={slots}
                        day={day}
                        focus={focusKey}
                        onScrub={onScrub}
                        onSelect={setSel}
                        recent={recent}
                        axis={axis}
                      />
                      <Segmented
                        label="新しい発表"
                        value={recent ? "on" : "off"}
                        onChange={(v) => setRecent(v === "on")}
                        options={[
                          { id: "on", label: "新しいほど濃く" },
                          { id: "off", label: "同じ濃さ" },
                        ]}
                      />
                      <Segmented
                        label="横の目盛り"
                        value={axis}
                        onChange={setAxis}
                        options={[
                          { id: "date", label: "日付だけ" },
                          { id: "clock", label: "時計" },
                        ]}
                      />
                    </>
                  ) : (
                    <OneChart
                      slots={slots}
                      day={day}
                      mode={plan === "oneTone" ? "tone" : "dash"}
                      focus={focusKey}
                      onScrub={onScrub}
                      onSelect={setSel}
                    />
                  )}
                  <Segmented
                    label="行の絞り込み"
                    value={onlyChanged ? "changed" : "all"}
                    onChange={(v) => setOnlyChanged(v === "changed")}
                    options={[
                      { id: "all", label: "すべての発表" },
                      { id: "changed", label: "変わった発表だけ" },
                    ]}
                  />
                  <TransitionRows
                    slots={slots}
                    selected={sel}
                    onSelect={setSel}
                    actual={<Actual day={day} />}
                    onlyChanged={onlyChanged}
                  />
                </>
              )}
              {plan === "combo" && (
                <>
                  <TransitionChart
                    slots={slots}
                    day={day}
                    selected={sel}
                    onSelect={setSel}
                    compact
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
                  <TransitionRows
                    slots={slots}
                    selected={sel}
                    onSelect={setSel}
                    actual={<Actual day={day} />}
                    onlyChanged={onlyChanged}
                  />
                </>
              )}
              {plan === "chart" && (
                <TransitionChart
                  slots={slots}
                  day={day}
                  selected={sel}
                  onSelect={setSel}
                />
              )}
              {plan === "table" && (
                <TransitionRows
                  slots={slots}
                  selected={sel}
                  onSelect={setSel}
                  actual={<Actual day={day} />}
                />
              )}
              {plan === "steps" && (
                <TransitionSteps
                  slots={slots}
                  selected={sel}
                  onSelect={setSel}
                  actual={<Actual day={day} />}
                />
              )}
              {plan === "chart" && <Actual day={day} />}
            </div>
            {!one && (
              <p className="fh-today">
                範囲は7日前〜当日。当日の発表は途中からの値（「11時から」など）なので、前の発表とは比べない（太字にしない）。
              </p>
            )}
            <Provenance
              s={selected}
              sc={sc}
              hint="発表（行・札・線の上）を押すと、その値の出どころと「—」の理由がここに出ます。"
            />
          </div>
        </section>

        <section className="fh-card" aria-label="発表×対象日の表">
          <SectionHead title="発表×対象日の表" as="h3" />
          <Matrix
            data={data}
            day={day}
            all={days}
            onDay={setDay}
            layout={layout}
            onLayout={setLayout}
            item={item}
            onItem={setItem}
            kind={kind}
            onKind={setKind}
            selRow={row}
            onRow={setRow}
            selCell={cell}
            onCell={setCell}
          />
          <Provenance
            s={cellSlot}
            sc={sc}
            day={cell?.day}
            hint="マスを押すと、その値の出どころと「—」の理由がここに出ます。"
          />
          <p className="fh-note">
            基本は「まとめて」（天気・最高／最低・降水）。項目を選ぶとその項目だけ。列の日付を押すと対象日が変わる（上の移り変わりも）。行の発表を押すと、その発表が予報していた日をすべて出す（R6-3）。
          </p>
        </section>

        <section className="fh-card fh-legend" aria-label="見方">
          <SectionHead title="見方" as="h3" />
          <ul>
            <li>
              <span className="fh-val changed">40</span>{" "}
              太字と点：1つ前の同じ種類の発表から変わった値。変わらなかった行は控えめ。
            </li>
            <li>
              <span className="fh-dash">—</span>{" "}
              気象庁が出していない（値なし・項目なし）。その発表の行やマスを押すと、どちらかと理由が出る。
            </li>
            <li>
              <span className="fh-out-sample" />{" "}
              空欄：その発表がその日・その時間を予報していない（対象期間外）。
            </li>
            <li>
              <span className="fh-state missing">記録なし</span>{" "}
              取得の記録も発表もない（未取得）。「ない」とは言わない。
            </li>
            <li>
              <span className="fh-state failed">取れなかった</span>{" "}
              その時間帯の取得に失敗が残り、後でも補えていない（取得失敗）。
            </li>
            <li>
              <span className="fh-state notIssued">届いていない</span>{" "}
              取得は成功しているのに、その回の発表がない（気象庁から出ていない、R5-3
              の「届かない」）。
            </li>
            <li>
              <span className="fh-state cancelled">取り消し</span>{" "}
              気象庁が取り消した発表。値は出さない。
            </li>
            <li>
              <span className="fh-tag fix">訂正</span>{" "}
              訂正の電文の値を出している（元の発表は「同じ発表」に残る）。
            </li>
            <li>
              <span className="fh-src">電文</span>
              <span className="fh-src">記録</span> 出どころ：自前の電文（気象庁
              防災情報XML）／shiromatz の記録（CC BY-SA 4.0）。
            </li>
          </ul>
        </section>

        <footer className="fh-credit">
          <p>
            出典：気象庁（防災情報XML）。気象庁の予報（shiromatz/Japan-Meteorological-Agency-Weather-Forecast
            の記録、CC BY-SA 4.0）。この見本はそれを加工して表示しています。
          </p>
          {sc.source && (
            <p className="fh-mono">
              記録：{sc.source.path} @ {sc.source.commit.slice(0, 10)}（sha256{" "}
              {sc.source.zipSha256.slice(0, 12)}…）
            </p>
          )}
          {sc.synthetic && <p>合成：{sc.synthetic.join("／")}</p>}
        </footer>
      </main>
    </div>
  );
}

// データは build-data.ts が書く sample-data.json（ページと同じ場所）。
// 実績（actuals.json）は無くても動く（無ければ「まだ」の形）。
Promise.all([
  fetch("./sample-data.json").then(
    (r) => r.json() as Promise<{ scenarios: Sc[] }>,
  ),
  fetch("./actuals.json")
    .then((r) =>
      r.ok
        ? (r.json() as Promise<{ days: Record<string, ActualDay> }>)
        : { days: {} },
    )
    .catch(() => ({ days: {} })),
]).then(([{ scenarios }, act]) =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App SCENARIOS={scenarios} ACTUALS={act.days} />
    </StrictMode>,
  ),
);
