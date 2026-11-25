// 空気の質の内訳（2026-11-25 渡辺さん「内訳の詳細画面」→ ヒートマップ、色はふだんと比べて。airBreakdown.ts）。
//   - 縦に項目（CAMS 4つ・実測 5つ）、横に 0〜23時。マスの色はふだん（手前30日）と比べた5段。値の無い時間は空ける。
//   - 時刻を選ぶ（マスの列を押す・なぞる、または下のつまみ）と、その時刻の全項目の値と段が下の表に出る。
//   - 基準（環境省）と用語は「基準と用語」に畳む。
//   - 実測（そらまめくん 介良局の速報値）は今日までの日だけ。11/25 渡辺さん：商用利用でないのでそのまま使ってよい。
import { type PointerEvent, useRef, useState } from "react";
import { camsRows, fmt, type HeatRow, lastHour, measuredRows, notes, VIS_WORDS, visibilityRow, visLevel } from "../airBreakdown";
import type { WeatherRow } from "../../shared/types";
import { camsWord, measuredMissing } from "../airSummary";
import type { AirResponse, MeasuredResponse } from "../../shared/airQuality";
import { USUAL_WORDS, usualLevel } from "../../shared/airUsual";
import { Button, Slider } from "./kit";
import { ModalSheet } from "./ModalSheet";

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const lvClass = (lv: number | null) => (lv == null ? "nu" : lv < 0 ? "na" : `l${lv}`);
const lvWord = (lv: number | null) => (lv == null ? "比べられない" : lv < 0 ? "値なし" : USUAL_WORDS[lv]);
/** 行の色の段：ふだんと比べた5段か、視程は気象庁の見通しの区分。 */
const levelOf = (r: HeatRow, v: number | null) => (r.scale === "vis" ? visLevel(v) : usualLevel(v, r.usual));
const wordOf = (r: HeatRow, lv: number | null) => (r.scale === "vis" ? (lv != null && lv > 0 ? VIS_WORDS[lv] : "値なし") : lvWord(lv));

function Rows({ rows, sel, onPick }: { rows: HeatRow[]; sel: number; onPick: (h: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const pick = (e: PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    onPick(Math.max(0, Math.min(23, Math.floor(((e.clientX - r.left) / r.width) * 24))));
  };
  return (
    <div className="ahm-block">
      <div className="ahm-names" aria-hidden="true">
        {rows.map((r) => (
          <span key={r.key}>{r.name}</span>
        ))}
      </div>
      <div
        ref={box}
        className="ahm-cells"
        data-no-sheet-drag
        aria-hidden="true"
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => e.buttons && pick(e)}
      >
        {rows.map((r) => (
          <div key={r.key} className="ahm-row" data-key={r.key}>
            {r.values.map((v, h) => (
              <i key={h} className={`ahm-c ${lvClass(levelOf(r, v))}${h === sel ? " sel" : ""}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AirBreakdownSheet({
  air,
  measured,
  hours,
  date,
  today,
  onClose,
}: {
  air: AirResponse;
  measured: MeasuredResponse | null;
  /** その日の1時間ごとの値（視程の実測を拾う）。 */
  hours?: WeatherRow[] | null;
  date: string;
  today: string;
  onClose: () => void;
}) {
  const isToday = date === today;
  const nowH = isToday ? new Date(Date.now() + 9 * 3_600_000).getUTCHours() : null;
  const cams = camsRows(air.hours, air.usual?.items);
  const meas = measured ? measuredRows(measured.hours, measured.usual?.items) : null;
  const hasMeas = !!meas && measured!.hours.length > 0;
  const vis = date <= today ? visibilityRow(hours) : null;
  const measShown = [...(hasMeas ? meas! : []), ...(vis ? [vis] : [])];
  const [sel, setSel] = useState(() => nowH ?? 12);
  const [open, setOpen] = useState(false);
  const last = meas ? lastHour(meas) : null;
  // ふだんは出どころごとに別（CAMS の格子と介良局）。期間も分けて書く（11/25 外部レビュー：CAMS の期間だけを書いていた）。
  const usualC = air.usual ?? null;
  const usualM = hasMeas ? (measured?.usual ?? null) : null;
  const anyNu = [...cams, ...(hasMeas ? meas! : [])].some((r) => !r.usual);
  const row = (r: HeatRow, who: string) => {
    const v = r.values[sel];
    const lv = levelOf(r, v);
    return (
      <li key={`${who}${r.key}`}>
        <span>
          {who}
          {r.name}
        </span>
        <b>{v == null ? "—" : fmt(v, r.digits)}</b>
        {/* 単位と、その行の「多い」の目安（ふだんの 90%）と、ふだんを作った時間の数（11/25 外部レビュー） */}
        <small>
          {r.unit}
          {r.usual ? `・目安 ${fmt(r.usual.q[2], r.digits)}（${r.usual.n}時間から）` : ""}
        </small>
        <em className={`ahm-badge ${lvClass(lv)}`}>{wordOf(r, lv)}</em>
      </li>
    );
  };
  return (
    <ModalSheet title={`空気の質の内訳・${md(date)}`} onClose={onClose} className="ahm-sheet">
      <div className="ahm">
        <p className="ahm-lead">
          色は、その項目の<b>ふだん</b>
          {usualC || usualM
            ? `（${[usualC ? `CAMS は ${md(usualC.from)}〜${md(usualC.to)}` : null, usualM ? `介良局は ${md(usualM.from)}〜${md(usualM.to)}` : null].filter(Boolean).join("、")} の1時間値。出どころごとに別）`
            : "（手前30日の1時間値。出どころごとに別）"}
          と比べた多さです。Weather Note の集計で、環境省の基準とは別です。列を押すと、その時刻の値が下に出ます。
        </p>
        <div className="ahm-legend">
          {USUAL_WORDS.map((w, i) => (
            <span key={w}>
              <i className={`ahm-c l${i}`} />
              {w}
            </span>
          ))}
          <span>
            <i className="ahm-c na" />
            値なし
          </span>
          {vis && (
            <span className="ahm-legend-vis">
              視程の行は気象庁の黄砂の見通しの区分：
              {[1, 2, 3, 4].map((i) => (
                <span key={i}>
                  <i className={`ahm-c l${i}`} />
                  {VIS_WORDS[i]}
                </span>
              ))}
            </span>
          )}
          {anyNu && (
            <span>
              <i className="ahm-c nu" />
              比べられない（手前のデータが7日分に届かない）
            </span>
          )}
        </div>

        <h3 className="ahm-h">
          {camsWord(air.kind)}
          <small>モデル、約45km の格子</small>
        </h3>
        <Rows rows={cams} sel={sel} onPick={setSel} />
        {(meas || vis) && (
          <>
            <h3 className="ahm-h">
              実測
              <small>
                {meas ? `${measured!.name}（そらまめくん・速報値${last != null ? `・${last}時台まで` : ""}）` : ""}
                {vis ? `${meas ? "、" : ""}視程は高知の気象台（気象庁）` : ""}
              </small>
            </h3>
            {measShown.length ? <Rows rows={measShown} sel={sel} onPick={setSel} /> : null}
            {meas && !hasMeas && <p className="aq-note">介良局の実測：{measuredMissing(date, measured!.newestOut)}</p>}
          </>
        )}
        <div className="ahm-block ahm-axis" aria-hidden="true">
          <span />
          <span className="ahm-ticks">
            {[0, 6, 12, 18].map((h) => (
              <b key={h} style={{ left: `${((h + 0.5) / 24) * 100}%` }}>
                {h}
              </b>
            ))}
          </span>
        </div>
        <div className="ahm-block">
          <span className="ahm-names">時刻</span>
          <Slider className="ahm-slider" min={0} max={23} step={1} ticks={nowH != null ? [nowH] : undefined} thumbs={[{ value: sel, label: "時刻", valueText: `${sel}時`, onChange: setSel }]} />
        </div>

        <div className="ahm-read" aria-live="polite">
          <p>
            {sel}時{hasMeas ? `（実測は ${sel}時台の平均）` : ""}
            {nowH === sel ? "・今" : ""}
          </p>
          <ul>
            {cams.map((r) => row(r, ""))}
            {measShown.map((r) => row(r, "実測 "))}
          </ul>
        </div>

        <Button size="sm" kind="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "基準と用語を閉じる" : "基準と用語（環境省の基準・何の値か）"}
        </Button>
        {open && (
          <dl className="ahm-notes">
            {notes(cams, hasMeas ? meas : null).map((n) => (
              <div key={n.name}>
                <dt>{n.name}</dt>
                <dd>
                  {n.about}
                  <br />
                  {n.standard}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="aq-src">
          <span>{air.kind === "forecast" ? "予測" : "モデルの値"}：Copernicus Atmosphere Monitoring Service（CAMS）、Open-Meteo.com（CC BY 4.0）</span>
          {meas && <span>実測：環境省 大気汚染物質広域監視システム（そらまめくん）。データの著作権は環境省・高知市など</span>}
          {vis && <span>視程：気象庁（高知の気象台の観測）。区分は気象庁の黄砂観測実況図の見通しの区分</span>}
          <span>ふだんとの比べ：Weather Note の集計（手前30日の1時間値の 10%・75%・90%・98% で5段）</span>
          <span>基準：環境省「大気汚染に係る環境基準」「微小粒子状物質による大気の汚染に係る環境基準」、大気汚染防止法（光化学オキシダントの注意報）</span>
        </div>
      </div>
    </ModalSheet>
  );
}
