// 1日の「空気」（2026-11-25 渡辺さん：空気の質と視程を統合、「どのようにデータを見せるか」「分かりやすいか」「ⓘ で不要な情報は削る」）。
//
// 上から、読む順に：
//   1. ひとこと：その日の空気で、ふだんと違うところだけ（Weather Note の判定、airVerdict.ts）。何がふだんかは ⓘ。
//   2. 値：今日は「いま」（PM2.5・黄砂は CAMS の今の時、視程は気象台の最新の観測、PM2.5 の実測は介良局のいちばん新しい時間）。
//      ほかの日はその日の値（PM2.5 の平均・黄砂の最大・視程の最小・実測の平均）。誰の値かは値の下に小さく。
//   3. 24時間：PM2.5・黄砂・視程を上下に3段、横軸をそろえて（design-system 4.1）。押した時刻の値を上に1行。
//      PM2.5 の段に介良局の実測を点で。視程は観測を実線、予報（Open-Meteo）を薄く。5km 未満（気象庁の黄砂の見通しの区分）を薄い帯で。
//      日平均の基準（PM2.5 35）は1時間ごとのグラフには引かない（1時間の値と比べないため）。
//   4. 全項目の内訳（ヒートマップ、AirBreakdownSheet）。
//   5. 基準と出典：1行にして、ⓘ で開く。
// CAMS の値が無い日（2023年より前・6日先から）でも、視程は出す。
import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { airDay, latestMeasured, measuredMean, measuredMissing } from "../airSummary";
import { airVerdict } from "../airVerdict";
import { hourlyExtreme } from "../chartMetrics";
import { airInRange, useAir, useMeasured } from "../data/air";
import type { AirHour, MeasuredHour } from "../../shared/airQuality";
import type { WeatherRow } from "../../shared/types";
import { AirBreakdownSheet } from "./AirBreakdownSheet";
import { Button, InfoNote } from "./kit";

/** 気象庁の黄砂情報（黄砂解析予測図）。黄砂がふだんより多い日だけ、ひとことの下に出す（11/25 渡辺さん）。 */
export const JMA_KOSA_PAGE = "https://www.data.jma.go.jp/env/kosa/fcst/";

const W = 340;
const LEFT = 30;
const RIGHT = 8;
const PANEL = { pm: 70, dust: 46, vis: 56 };
const GAP = 28;
/** 段の名前の行（段の上） */
const HEAD = 16;
const AXIS = 18;
const TICKS = [0, 6, 12, 18, 24];
/** 取得からこれ以上たっていれば、そのことを添える（約1時間ごとの取得から置いた目安）。 */
const OLD_MS = 2 * 3_600_000;

const hm = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(11, 16) : null);
const mdhm = (iso: string) => {
  const t = new Date(Date.parse(iso) + 9 * 3_600_000);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${t.getUTCHours()}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
};
const nice = (v: number, min: number) => {
  const top = Math.max(min, v);
  const step = top <= 10 ? 5 : top <= 50 ? 10 : top <= 100 ? 20 : 50;
  return Math.ceil(top / step) * step;
};
const r0 = (v: number | null | undefined) => (v == null ? "—" : String(Math.round(v)));
const r1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

interface Vis {
  x: number;
  v: number;
  actual: boolean;
}

/** 視程：時の n（1〜24）はその時ちょうどの値。観測と予報を分けて持つ。 */
const visOf = (rows: WeatherRow[] | null | undefined): Vis[] =>
  (rows ?? []).filter((r) => typeof r.visibility === "number" && Number.isFinite(r.visibility)).map((r) => ({ x: r.n, v: Math.min(20, r.visibility as number), actual: r.type === "actual" }));

function Panels({ hours, measured, vis, usual, nowH, sel, onSel }: { hours: AirHour[]; measured: MeasuredHour[]; vis: Vis[]; usual: { pm: number | null; dust: number | null; pmMeasured: number | null }; nowH: number | null; sel: number | null; onSel: (h: number) => void }) {
  const box = useRef<SVGSVGElement>(null);
  const x = (h: number) => LEFT + ((W - LEFT - RIGHT) * h) / 24;
  const pmVals = [...hours.map((h) => h.pm2_5), ...measured.map((m) => m.pm2_5)].filter((v): v is number => v != null);
  const dustVals = hours.map((h) => h.dust).filter((v): v is number => v != null);
  // ふだんの目安（CAMS のふだんの 90% の値、Weather Note の集計）の線が枠に入るように、上端に含める。
  const pmTop = nice(Math.max(0, ...pmVals, usual.pm ?? 0, usual.pmMeasured ?? 0), 20);
  const dustTop = nice(Math.max(0, ...dustVals, usual.dust ?? 0), 10);
  const tops = { pm: HEAD, dust: HEAD + PANEL.pm + GAP, vis: HEAD + PANEL.pm + GAP + PANEL.dust + GAP };
  const H = tops.vis + PANEL.vis + AXIS;
  const y = (panel: keyof typeof PANEL, v: number, top: number) => tops[panel] + PANEL[panel] * (1 - v / top);
  const path = (pts: { x: number; v: number }[], panel: keyof typeof PANEL, top: number) => {
    let d = "";
    let prev: number | null = null;
    for (const p of pts) {
      d += `${prev != null && p.x - prev <= 1 ? "L" : "M"}${x(p.x).toFixed(1)},${y(panel, p.v, top).toFixed(1)}`;
      prev = p.x;
    }
    return d;
  };
  const series = (k: "pm2_5" | "dust") => hours.filter((h) => h[k] != null).map((h) => ({ x: h.h, v: h[k] as number }));
  const pick = (e: PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    onSel(Math.max(0, Math.min(23, Math.round(((px - LEFT) / (W - LEFT - RIGHT)) * 24))));
  };
  const label = (panel: keyof typeof PANEL, text: string) => (
    <text x={LEFT} y={tops[panel] - 5} className="aq-pl">
      {text}
    </text>
  );
  const grid = (panel: keyof typeof PANEL, top: number) =>
    [0, top].map((v) => (
      <g key={v}>
        <line x1={LEFT} x2={W - RIGHT} y1={y(panel, v, top)} y2={y(panel, v, top)} className="aq-grid" />
        <text x={LEFT - 4} y={y(panel, v, top) + 3} className="aq-yl">
          {v}
        </text>
      </g>
    ));
  // 目安の線は出どころごと（11/25 外部レビュー：PM2.5 の線は CAMS なのに、実測の点も同じ線で読めた）。CAMS は右に、介良局は左に名前。
  const guide = (panel: "pm" | "dust", v: number | null, top: number, who: string, left = false) =>
    v == null ? null : (
      <g>
        <line x1={LEFT} x2={W - RIGHT} y1={y(panel, v, top)} y2={y(panel, v, top)} className={left ? "aq-usual measured" : "aq-usual"} />
        <text x={left ? LEFT + 2 : W - RIGHT} y={y(panel, v, top) - 3} className={left ? "aq-usual-l start" : "aq-usual-l"}>
          {who}の目安 {Math.round(v)}
        </text>
      </g>
    );
  const visA = vis.filter((p) => p.actual);
  const visF = vis.filter((p) => !p.actual);
  return (
    <svg
      ref={box}
      viewBox={`0 0 ${W} ${H}`}
      className="aq-chart"
      role="img"
      aria-label="PM2.5・黄砂・視程の24時間"
      data-no-sheet-drag
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => e.buttons && pick(e)}
    >
      {/* 視程 5km 未満（気象庁の黄砂の見通しの区分） */}
      <rect x={LEFT} width={W - LEFT - RIGHT} y={y("vis", 5, 20)} height={y("vis", 0, 20) - y("vis", 5, 20)} className="aq-visband" />
      {grid("pm", pmTop)}
      {grid("dust", dustTop)}
      {grid("vis", 20)}
      {label("pm", "PM2.5 µg/m³")}
      {label("dust", "黄砂 µg/m³")}
      {label("vis", "視程 km")}
      {guide("pm", usual.pm, pmTop, "CAMS ")}
      {measured.some((m) => m.pm2_5 != null) && guide("pm", usual.pmMeasured, pmTop, "介良局", true)}
      {guide("dust", usual.dust, dustTop, "CAMS ")}
      <path d={path(series("pm2_5"), "pm", pmTop)} className="aq-line pm" />
      {measured
        .filter((m) => m.pm2_5 != null)
        .map((m) => (
          <circle key={m.hour} cx={x(m.hour - 0.5)} cy={y("pm", m.pm2_5!, pmTop)} r={2.6} className="aq-measured" />
        ))}
      <path d={path(series("dust"), "dust", dustTop)} className="aq-line dust" />
      <path d={path(visF, "vis", 20)} className="aq-line vis fc" />
      <path d={path(visA, "vis", 20)} className="aq-line vis" />
      {TICKS.map((h) => (
        <text key={h} x={x(h)} y={H - 4} className="aq-xl">
          {h}
        </text>
      ))}
      {nowH != null && <line x1={x(nowH)} x2={x(nowH)} y1={2} y2={H - AXIS} className="aq-now" />}
      {sel != null && <line x1={x(sel)} x2={x(sel)} y1={2} y2={H - AXIS} className="aq-sel" />}
    </svg>
  );
}

/** 値の札：大きな数・単位・誰の値か。 */
function Val({ label, value, unit, who, tone }: { label: string; value: string; unit: string; who: ReactNode; tone?: string }) {
  return (
    <span className="aq-val">
      <small>{label}</small>
      <b className={tone ? `tone-${tone}` : undefined}>{value}</b>
      <small>{unit}</small>
      <em>{who}</em>
    </span>
  );
}

export function AirQualityCard({ station, date, today, hours, latest }: { station: string; date: string; today: string; hours?: WeatherRow[] | null; latest?: WeatherRow | null }) {
  const inRange = airInRange(date, today);
  const air = useAir(station, date);
  const measured = useMeasured(station, date, date <= today);
  const [detail, setDetail] = useState(false);
  const isToday = date === today;
  const nowH = isToday ? new Date(Date.now() + 9 * 3_600_000).getUTCHours() : null;
  const [selFor, setSelFor] = useState<{ date: string; h: number } | null>(null);
  const sel = selFor?.date === date ? selFor.h : nowH;
  if (air.unsupported) return null;

  const r = inRange ? air.r : null;
  const ch = r?.hours ?? [];
  const mh = measured.r?.hours ?? [];
  const vis = visOf(hours);
  const verdict = airVerdict(r, measured.r, hours ?? null);
  const d = airDay(ch);
  const at = (h: number) => ch.find((x) => x.h === h) ?? null;
  const visAt = (h: number) => vis.find((p) => p.x === h) ?? null;
  const measAt = (h: number) => mh.find((m) => m.hour - 1 === h && m.pm2_5 != null) ?? null;
  const lastM = latestMeasured(mh);
  // 実測が無いとき：読み込み中・取れなかった・まだ出ていない（速報値は遅れて出る）・無い を分けて言う（11/25 ルールの見直し）。
  const measuredWho = measured.r == null ? (measured.failed ? "介良局・読み込めませんでした" : "介良局・読み込み中") : `介良局・${measuredMissing(date, measured.r.newestOut)}`;
  const meanM = measuredMean(mh);
  // 視程の最小は表・比較の「視程最小」と同じ値（chartMetrics の hourlyExtreme：1時間ごとの値のいちばん小さいもの、
  // 時間が足りなければ —）。同じ日の同じ値は、どこに出しても同じ数字（2026-11-24 の決まり）。
  const visMin = hourlyExtreme(hours ?? null, "visibility", "min");
  const visWho = vis.length && vis.every((p) => p.actual) ? "気象台" : vis.some((p) => p.actual) ? "気象台・予報を含む" : vis.length ? "予報（Open-Meteo）" : "値なし";
  const latestVis = isToday && latest && typeof latest.visibility === "number" ? Math.min(20, latest.visibility) : null;
  const camsWho = r ? (r.kind === "forecast" ? "CAMS の予測" : "CAMS") : "";
  const status = !inRange ? "PM2.5・黄砂（CAMS）は、2023年1月から今日の5日先までです。" : air.r == null ? (air.failed ? "PM2.5・黄砂を読み込めませんでした。" : "PM2.5・黄砂を読み込み中…") : !ch.length ? "この日の PM2.5・黄砂（CAMS）はありません。" : null;
  const sh = sel ?? null;
  // 値の新しさ（11/25 レビュー、#501）：終わった日の値を待つ間の予測・取得から2時間以上・前の取得の値を含む。隠さずにグラフの下へ。
  const fresh = r
    ? [
        r.kind === "forecast" && date < today ? "終わった日の値がまだ届いていないので、保存しておいた予測を出しています。" : null,
        r.fetchedAt && r.kind === "forecast" && Date.now() - Date.parse(r.fetchedAt) >= OLD_MS ? `PM2.5・黄砂は取得から2時間以上たっています（${mdhm(r.fetchedAt)} に取得）。` : null,
        r.olderHours ? `PM2.5・黄砂のうち ${r.olderHours}時間分は、前に取得した値のままです。` : null,
      ].filter((t): t is string => t != null)
    : [];

  return (
    <section className="aq" aria-label="空気">
      <div className="dd-now aq-top">
        <InfoNote
          className="aq-verdict"
          more={
            <>
              Weather Note の判定です。PM2.5 は日平均、黄砂は日最大を、手前30日の同じ1日の値の 90% と比べ、超えた日を「ふだんより多い日」としています（介良局の実測が20時間以上あれば実測、なければ CAMS）。
              「多いのは」の時間は、手前30日の1時間値の 90%（グラフの点線）を超えた時間です。「ふだんの目安」はどれも Weather Note の集計です（環境省の基準ではありません）。黄砂には環境省・気象庁の µg/m³ の基準がありません。
              PM2.5 の環境省の環境基準は 1日平均 35 µg/m³ 以下で、1時間ごとの値とは比べません。
              PM2.5 は介良局の実測があれば実測で、無ければ CAMS で見ます。視程は、気象庁が黄砂の観測で使う見通しの区分で 5km 未満の時間です（観測だけ）。
            </>
          }
        >
          {verdict.facts.length ? (
            verdict.facts.map((f) => (
              <span key={f.key} className={`aq-fact ${f.key}`}>
                {f.text}
                <small>{f.who}</small>
              </span>
            ))
          ) : (
            <span className="aq-fact quiet">{verdict.quiet}</span>
          )}
          <small className="aq-judge">Weather Note の判定</small>
        </InfoNote>
        {verdict.facts.some((f) => f.key === "dust") && (
          <a href={JMA_KOSA_PAGE} target="_blank" rel="noreferrer" className="aq-kosa-link">
            気象庁の黄砂解析予測図 ↗
          </a>
        )}
        <div className="aq-vals">
          {isToday ? (
            <>
              <Val label="PM2.5" value={r0(at(nowH!)?.pm2_5)} unit="µg/m³" tone="pm25" who={r ? `${camsWho}・${nowH}時` : "—"} />
              <Val label="黄砂" value={r0(at(nowH!)?.dust)} unit="µg/m³" tone="dust" who={r ? `${camsWho}・${nowH}時` : "—"} />
              <Val label="視程" value={r1(latestVis)} unit="km" tone="visibility" who={latestVis != null && typeof latest?.observedAt === "string" ? `気象台・${latest.observedAt}` : "気象台"} />
              {date <= today && <Val label="実測 PM2.5" value={r0(lastM?.pm2_5)} unit="µg/m³" who={lastM ? `介良局・${lastM.hour - 1}時台` : measuredWho} />}
            </>
          ) : (
            <>
              <Val label={d.pmHours && d.pmHours < 24 ? `PM2.5 ${d.pmHours}時間の平均` : "PM2.5 日平均"} value={r0(d.pmMean)} unit="µg/m³" tone="pm25" who={camsWho || "—"} />
              <Val label="黄砂 最大" value={r0(d.dustMax?.v)} unit="µg/m³" tone="dust" who={d.dustMax ? `${camsWho}・${d.dustMax.h}時` : camsWho || "—"} />
              <Val label="視程 最小" value={r1(visMin)} unit="km" tone="visibility" who={visWho} />
              {date <= today && <Val label={meanM && meanM.n < 24 ? `実測 PM2.5 ${meanM.n}時間の平均` : "実測 PM2.5 日平均"} value={r0(meanM?.mean)} unit="µg/m³" who={meanM ? "介良局" : measuredWho} />}
            </>
          )}
        </div>
      </div>

      <div className="aq-chartbox">
        <p className="aq-read-line" aria-live="polite">
          {sh == null ? (
            "グラフを押すと、その時刻の値"
          ) : (
            <>
              <b>{sh}時</b>
              <span className="tone-pm25">PM2.5 {r0(at(sh)?.pm2_5)}</span>
              <span className="tone-dust">黄砂 {r0(at(sh)?.dust)}</span>
              <span>実測 {r0(measAt(sh)?.pm2_5)}</span>
              <span className="tone-visibility">視程 {r1(visAt(sh)?.v)}km</span>
            </>
          )}
        </p>
        <Panels hours={ch} measured={mh} vis={vis} usual={{ pm: r?.usual?.items?.pm2_5?.q[2] ?? null, dust: r?.usual?.items?.dust?.q[2] ?? null, pmMeasured: measured.r?.usual?.items?.pm2_5?.q[2] ?? null }} nowH={nowH} sel={sh} onSel={(h) => setSelFor({ date, h })} />
        <p className="aq-legend">
          <span className="aq-key pm" />
          <span className="aq-key dust" />
          PM2.5・黄砂（{r?.kind === "past" ? "CAMS" : "CAMS の予測"}）
          <span className="aq-key dot" />
          PM2.5 の実測（介良局）
          {r?.usual?.items && (
            <>
              <span className="aq-key usual" />
              ふだんの目安（それぞれの出どころのふだんの 90%）
            </>
          )}
          <span className="aq-key vis" />
          視程（観測）
          {vis.some((p) => !p.actual) && (
            <>
              <span className="aq-key vis fc" />
              視程（予報）
            </>
          )}
        </p>
        {status && <p className="aq-note">{status}</p>}
        {fresh.map((t) => (
          <p key={t} className="aq-stale">
            {t}
          </p>
        ))}
        {r && ch.length > 0 && (
          <Button size="sm" className="aq-more" onClick={() => setDetail(true)}>
            全項目の内訳（ヒートマップ）
          </Button>
        )}
      </div>
      {detail && r && <AirBreakdownSheet air={r} measured={date <= today ? measured.r : null} hours={hours} date={date} today={today} onClose={() => setDetail(false)} />}

      <InfoNote
        className="aq-src"
        more={
          <>
            <span className="aq-src-line">
              PM2.5・黄砂：Copernicus Atmosphere Monitoring Service（CAMS）のモデルの値、Open-Meteo.com（CC BY 4.0）。約45km の格子の値で、高知市の中の場所による違いは表せません。
              {r?.fetchedAt ? `${mdhm(r.fetchedAt)} に取得。` : ""}
            </span>
            {date <= today && (
              <span className="aq-src-line">
                PM2.5 の実測：環境省 大気汚染物質広域監視システム（そらまめくん）・{measured.r?.name ?? "高知市 介良局"}の速報値。データの著作権は環境省・高知市など。
                {measured.r?.checkedAt ? `${hm(measured.r.checkedAt)} に確認。` : ""}
              </span>
            )}
            <span className="aq-src-line">視程：気象庁（高知の気象台の観測）。予報の時間は Open-Meteo の値。気象庁は黄砂の強さを見通しで伝えています。</span>
            <span className="aq-src-line">基準：環境省の PM2.5 の環境基準は 1日平均 35 µg/m³ 以下、注意喚起の目安は 1日平均 70 µg/m³ を超えるとき（1時間ごとの値とは比べません）。黄砂には µg/m³ の目安がありません。</span>
          </>
        }
      >
        <span className="aq-src-short">出典：CAMS・介良局（そらまめくん）・気象庁 ／ 基準：環境省</span>
      </InfoNote>
    </section>
  );
}
