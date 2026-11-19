// 月のこよみ（2026-11-19 渡辺さん「月の情報ページ」）：太陽と月のシートから開く。上に選んだ日の月（形の絵・形の名前・
// 月齢・明るい部分・距離と見かけの大きさ・月の出／南中／月の入り）、下にその月のカレンダー（日ごとの形。月齢は押した日の上の欄で）と、同じ枠で替わる満ち欠けと見かけの大きさのグラフ、
// いちばん下に次の新月・上弦・満月・下弦。日を押すとその日の月に替わる。計算は shared/moon.ts（Astronomy Engine、
// 国立天文台の暦で確かめ済み）。時刻は正午の値（月齢・形）と、その日の出入り。1画面に収める。
import { Fragment, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { daysOfMonth, monthOf } from "../../shared/dates";
import { altitudeCurve, clockOf } from "../../shared/dayParts";
import { skyAt } from "../../shared/sky";
import { dms, fullMoonName, MOON_MEAN_DIAMETER, moonDistance, moonLimb, moonMagnitude, moonNorth, moonPhase, moonQuarters, moonShapeName, moonTimes, moonTint, moonTopo, QUARTER_NAME, SHAPE_NOTE } from "../../shared/moon";
import { DEFAULT_LAT_LON, stationLatLon } from "../../shared/sunTimes";
import { dateLabel } from "../design/format";
import { Button, Glyph, IconButton, InfoNote, Segmented } from "./kit";
import { ICON } from "../design/tokens";
import { svgTextSize, useDrawnWidth } from "./useDrawnWidth";
import { ModalSheet } from "./ModalSheet";
import { TimeBar } from "./TimeBar";
import stations from "../../shared/stations.json";
import { dirName, MoonGlyph, MoonSphere } from "./moonParts";

const noonOf = (d: string) => Date.parse(`${d}T12:00:00+09:00`);
const WEEK = ["月", "火", "水", "木", "金", "土", "日"];
const jst = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
};

export function MoonSheet({ date, station, here, onHere, onClose }: { date: string; station: string; here?: { lat: number; lon: number } | null; onHere?: () => void; onClose: () => void }) {
  // 計算の地点（11/19）：太陽と月のシートで「現在地で計算」にしていれば現在地、ほかは観測所。
  const ll = here ?? stationLatLon(station) ?? DEFAULT_LAT_LON;
  const where = here ? "現在地" : ((stations as { blockNo: string; name: string }[]).find((x) => x.blockNo === station)?.name ?? "観測所");
  const [sel, setSel] = useState(date);
  const [month, setMonth] = useState(monthOf(date));
  const [view, setView] = useState<"cal" | "trend">("cal");
  const days = useMemo(() => daysOfMonth(month), [month]);
  const cells = useMemo(() => days.map((d) => ({ d, p: moonPhase(noonOf(d)), size: moonDistance(noonOf(d)).diameter })), [days]);
  const lead = (new Date(`${days[0]}T00:00:00Z`).getUTCDay() + 6) % 7; // 月曜はじまり
  // 見え方のシミュレーション（2026-11-19）：時刻（10分ごと）を動かすと、上の月の形・傾き・色・大きさ・位置がその時刻の
  // 観測地から見た値に替わる。はじめは今の時刻。日を替えても時刻はそのまま。
  const [min, setMin] = useState(() => Math.floor(jst(Date.now()).min / 10) * 10);
  const [playing, setPlaying] = useState(false);
  // 今に付いていく（11/19 渡辺さん）：今日を開いたら、時刻が今に付いていく（20秒ごと）。つまみ・グラフ・動かす・ほかの日で止まり、
  // 「今」で今日の今へ戻る。
  const nowDay = jst(Date.now()).date;
  const [follow, setFollow] = useState(sel === nowDay);
  useEffect(() => {
    if (!follow) return;
    const tick = () => setMin(jst(Date.now()).min);
    tick();
    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
  }, [follow]);
  const move = (m: number) => {
    setFollow(false);
    setMin(m);
  };
  const pickDay = (d: string) => {
    if (d !== nowDay) setFollow(false);
    setSel(d);
  };
  const toNow = () => {
    setPlaying(false);
    setSel(nowDay);
    setMonth(monthOf(nowDay));
    setFollow(true);
  };
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setMin((a) => (a >= 1430 ? 0 : a + 10)), 90);
    return () => window.clearInterval(id);
  }, [playing]);
  const ms = Date.parse(`${sel}T00:00:00+09:00`) + min * 60_000;
  const name = moonShapeName(noonOf(sel));
  const t = moonTimes(sel, ll.lat, ll.lon);
  // その日の月の高さ（10分ごと、観測地から）と見かけの大きさの幅。傾きは3時間ごと（グラフの小さな月）。
  const day = useMemo(() => {
    const t0 = Date.parse(`${sel}T00:00:00+09:00`);
    const pts = Array.from({ length: 145 }, (_, i) => ({ min: i * 10, ...moonTopo(t0 + i * 600_000, ll.lat, ll.lon) }));
    // 大きさの幅は月が地平線の上にある間だけ（見えるときの変化。下にあるときは観測地から遠く、小さい）。
    const up = pts.filter((q) => q.altitude >= 0);
    const sizes = (up.length ? up : pts).map((q) => q.diameter);
    const marks = [0, 180, 360, 540, 720, 900, 1080, 1260, 1440]
      .map((m) => ({ min: m, alt: pts[m / 10].altitude, limb: moonLimb(t0 + m * 60_000, ll.lat, ll.lon), p: moonPhase(t0 + m * 60_000) }))
      .filter((q) => q.alt >= 0);
    return { pts, marks, lo: Math.min(...sizes), hi: Math.max(...sizes), sun: altitudeCurve(sel, ll, 10) };
  }, [sel, station, ll.lat, ll.lon]);
  const next = useMemo(() => moonQuarters(Date.parse(`${sel}T00:00:00+09:00`), 4), [sel]);
  // その日に新月・上弦・満月・下弦があれば、形の名前はそれ（時刻つき）。昔の呼び名は、その日に月相が無いときだけ。
  const today = next.find((q) => jst(q.at).date === sel);
  const title = today ? `${QUARTER_NAME[today.kind]}（${clockOf(jst(today.at).min)}）` : name.shape;
  // 満月の日は呼び名（ビーバームーンなど）、それ以外は昔の呼び名（十三夜など）を添える。
  const full = today?.kind === 2 ? fullMoonName(today.at) : null;
  const old = full ? `${full.name}${full.blue ? "・ブルームーン" : ""}` : today ? null : name.old;
  const noon = moonPhase(noonOf(sel));
  const mag = moonMagnitude(noonOf(sel));
  const shapeOf = today ? (["新月", "上弦の月", "満月", "下弦の月"] as const)[today.kind] : name.shape;
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const ev = (label: string, e: { at: number; azimuth: number } | null, note?: string) => (
    <div className="sun-key">
      <small>{label}</small>
      <b>{e ? clockOf(Math.round(e.at)) : "—"}</b>
      <small>{e ? (note ?? `${dirName(e.azimuth)} ${Math.round(e.azimuth)}°`) : "この日は無し"}</small>
    </div>
  );
  return (
    <ModalSheet title="月のこよみ" onClose={onClose} className="moon-sheet">
      {/* 暦の上の月（2026-11-19 渡辺さん「一般的な予報と観測予測は分けて」）：その日の正午の値。どこで見ても同じ。 */}
      <div className="moon-today">
        <div className="moon-today-text">
          <small>{dateLabel(sel)}の月（暦）</small>
          <b>
            {title}
            {old && <span className="moon-old">{old}</span>}
          </b>
          <span>
            月齢 {noon.age.toFixed(1)}・明るい部分 {Math.round(noon.illuminated * 100)}%
          </span>
          <InfoNote className="moon-note" more={
            <>
              {SHAPE_NOTE[shapeOf]}
              {full && " 満月の呼び名はアメリカの農事暦の呼び方（秋分にいちばん近い満月がハーベストムーン、その次がハンターズムーン。同じ月の2回目の満月はブルームーン）。"}
              {" 暦の値はその日の正午（どこで見てもほぼ同じ）。明るさは等級（小さいほど明るい。満月で約 −12.7）。"}
              {" 月の計算：Astronomy Engine（国立天文台の暦と照らし合わせ済み）。"}
            </>
          }>
            明るさ {mag.toFixed(1).replace("-", "−")} 等
          </InfoNote>
        </div>
      </div>
      {/* 観測の予測：観測地から見た、つまみの時刻の月。見えない時刻（地平線の下）は月を描かない。 */}
      <MoonObserve ms={ms} min={min} lat={ll.lat} lon={ll.lon} where={where} sel={sel} rise={t.rise} here={!!here} onHere={onHere} />
      <MoonDay day={day} min={min} onPick={move} />
      <TimeBar className="moon-play" value={min} onChange={move} ticks={[t.rise?.at, t.set?.at].filter((v): v is number => v != null).map(Math.round)} valueText={clockOf(min)} follow={follow} onFollow={() => (follow ? setFollow(false) : toNow())} playing={playing} onPlay={() => (setFollow(false), setPlaying(!playing))} />
      <div className="sun-keys moon">
        {/* 時刻の順に（11/19：0時台の月の入りは前の晩に昇った月。出・南中・入りの順だと翌日と読み違えやすい）。 */}
        {[
          { at: t.rise?.at, node: ev("月の出", t.rise) },
          { at: t.transit?.at, node: ev("南中", t.transit, t.transit ? `高さ ${Math.round(t.transit.altitude)}°` : undefined) },
          { at: t.set?.at, node: ev("月の入り", t.set) },
        ]
          .sort((a, b) => (a.at ?? 9e9) - (b.at ?? 9e9))
          .map((x, i) => (
            <Fragment key={i}>{x.node}</Fragment>
          ))}
      </div>

      <div className="moon-cal-head">
        <IconButton size="sm" label="前の月" onClick={() => shift(-1)}>
          <Glyph name="prev" />
        </IconButton>
        <b>
          {Number(month.slice(0, 4))}年{Number(month.slice(5, 7))}月
        </b>
        <IconButton size="sm" label="次の月" onClick={() => shift(1)}>
          <Glyph name="next" />
        </IconButton>
      </div>
      <Segmented
        label="見かた"
        value={view}
        onChange={setView}
        options={[
          { id: "cal", label: "カレンダー" },
          { id: "trend", label: "満ち欠けと大きさ" },
        ]}
      />
      <div className="moon-body">
        <div className={view === "cal" ? "moon-pane" : "moon-pane off"} aria-hidden={view !== "cal"} inert={view !== "cal"}>
          <div className="moon-cal" role="grid" aria-label="月の形のカレンダー">
            {WEEK.map((w) => (
              <small key={w} className="moon-cal-wd">
                {w}
              </small>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={`e${i}`} />
            ))}
            {cells.map(({ d, p: cp }) => (
              <button
                key={d}
                type="button"
                className={d === sel ? "moon-cal-day on" : "moon-cal-day"}
                aria-pressed={d === sel}
                aria-label={`${dateLabel(d)}、月齢 ${cp.age.toFixed(1)}、明るい部分 ${Math.round(cp.illuminated * 100)}%`}
                onClick={() => pickDay(d)}
              >
                <span className="moon-cal-n">{Number(d.slice(8))}</span>
                <MoonGlyph phase={cp} size={22} />
              </button>
            ))}
          </div>
        </div>
        <div className={view === "trend" ? "moon-pane" : "moon-pane off"} aria-hidden={view !== "trend"} inert={view !== "trend"}>
          <MoonTrend cells={cells} sel={sel} onPick={pickDay} />
        </div>
      </div>

      <div className="moon-next">
        {next.map((q) => {
          const j = jst(q.at);
          return (
            <span key={q.at}>
              <small>{QUARTER_NAME[q.kind]}</small>
              <b>
                {Number(j.date.slice(5, 7))}/{Number(j.date.slice(8))} {clockOf(j.min)}
              </b>
              {q.kind === 2 && <small className="moon-next-name">{fullMoonName(q.at).name}</small>}
            </span>
          );
        })}
      </div>
    </ModalSheet>
  );
}

/**
 * 満ち欠けと見かけの大きさの推移（2026-11-19）：その月の毎日の正午の値。明るい部分（0〜100%、右の目盛り）は面、
 * 見かけの大きさ（視直径、左の目盛り）は月の色の線。選んだ日に縦の線。なぞる・押すとその日を選ぶ（上の月が替わる）。
 * 下に 1・5・10…日の月の形と、新月・満月の日の印。見かけの大きさは近地点で大きく、遠地点で小さい（満ち欠けとは別の周期）。
 */
function MoonTrend({ cells, sel, onPick }: { cells: { d: string; p: ReturnType<typeof moonPhase>; size: number }[]; sel: string; onPick: (d: string) => void }) {
  const box = useRef<SVGSVGElement>(null);
  const W = useDrawnWidth(box, [], 340) || 340;
  const H = 236;
  const fs = svgTextSize("xs", W, W);
  const L = 40;
  const R = 34;
  const top = 12;
  const bottom = H - 66;
  const G = 18;
  const n = cells.length;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, n - 1);
  const sizes = cells.map((c) => c.size);
  const lo = Math.floor(Math.min(...sizes) * 100 - 1) / 100;
  const hi = Math.ceil(Math.max(...sizes) * 100 + 1) / 100;
  const yS = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const yI = (v: number) => bottom - v * (bottom - top);
  const area = `M${x(0)},${bottom} ` + cells.map((c, i) => `L${x(i).toFixed(1)},${yI(c.p.illuminated).toFixed(1)}`).join(" ") + ` L${x(n - 1)},${bottom} Z`;
  const line = cells.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yS(c.size).toFixed(1)}`).join(" ");
  const si = Math.max(0, cells.findIndex((c) => c.d === sel));
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (n - 1));
    onPick(cells[Math.max(0, Math.min(n - 1, i))].d);
  };
  const drag = useRef(false);
  // 新月・満月の日（明るい部分がいちばん小さい／大きい日）に印
  const marks = cells.flatMap((c, i) => {
    const a = cells[i - 1]?.p.illuminated ?? Infinity;
    const b = cells[i + 1]?.p.illuminated ?? Infinity;
    const a2 = cells[i - 1]?.p.illuminated ?? -Infinity;
    const b2 = cells[i + 1]?.p.illuminated ?? -Infinity;
    if (c.p.illuminated <= a && c.p.illuminated <= b && c.p.illuminated < 0.1) return [{ i, label: "新月" }];
    if (c.p.illuminated >= a2 && c.p.illuminated >= b2 && c.p.illuminated > 0.9) return [{ i, label: "満月" }];
    return [];
  });
  const days = [1, 5, 10, 15, 20, 25, 30].filter((d) => d <= n);
  return (
    <div className="moon-trend">
      <div className="moon-trend-legend" aria-hidden>
        <span>
          <i className="moon-trend-key size" style={{ background: ICON.moon }} />
          見かけの大きさ（左）
        </span>
        <span>
          <i className="moon-trend-key lit" />
          明るい部分（右）
        </span>
      </div>
      <svg
        ref={box}
        className="moon-trend-chart"
        data-no-sheet-drag
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`この月の満ち欠けと見かけの大きさ。見かけの大きさ ${Math.min(...sizes).toFixed(2)}°〜${Math.max(...sizes).toFixed(2)}°。押すとその日を選びます`}
        onPointerDown={(e) => {
          e.stopPropagation();
          drag.current = true;
          pick(e);
        }}
        onPointerMove={(e) => drag.current && pick(e)}
        onPointerUp={() => (drag.current = false)}
        onPointerCancel={() => (drag.current = false)}
        onPointerLeave={() => (drag.current = false)}
      >
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={yI(v)} y2={yI(v)} className="moon-trend-grid" />
            <text x={W - R + 4} y={yI(v) + 4} className="sun-tick" fontSize={fs}>
              {v * 100}%
            </text>
          </g>
        ))}
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <text key={v} x={L - 4} y={yS(v) + 4} textAnchor="end" className="sun-tick" fontSize={fs}>
            {v.toFixed(2)}°
          </text>
        ))}
        <path d={area} className="moon-trend-lit" />
        <path d={line} className="moon-trend-size" style={{ stroke: ICON.moon }} />
        <line x1={x(si)} x2={x(si)} y1={top} y2={bottom} className="sun-cursor" />
        <circle cx={x(si)} cy={yS(cells[si].size)} r={4} className="moon-trend-dot" style={{ fill: ICON.moon }} />
        {days.map((d) => (
          <g key={d}>
            <g transform={`translate(${(x(d - 1) - G / 2).toFixed(1)} ${bottom + 6})`}>
              <MoonGlyph phase={cells[d - 1].p} size={G} />
            </g>
            <text x={x(d - 1)} y={bottom + G + 20} textAnchor="middle" className="sun-tick" fontSize={fs}>
              {d}日
            </text>
          </g>
        ))}
        {marks.map((m) => (
          <text key={m.i} x={x(m.i)} y={bottom + G + 38} textAnchor="middle" className="moon-trend-mark" fontSize={fs}>
            {m.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

/** 光っている側の向き（上から反時計回りの角）を、時計の文字盤の向きで（右下 ≒ 4時）。 */
/** 大きさの見せ方：実際の比（平均の輪と比べる）／違いを強める（平均との差を STRONG 倍）。 */
const STRONG = 4;
const BASE = 92; // 平均の大きさの直径（px）
const STAGE = 132;
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * 観測の予測（2026-11-19 渡辺さん）：観測地から見た、つまみの時刻の月。傾き（光っている側）・模様の向き・高さの色・
 * 見かけの大きさを大きな絵で。大きさは「実際の比」と「違いを強める」を切り替える（輪＝平均の大きさ）。
 * 地平線の下の時刻は月を描かず「見えません」と、次に昇る時刻と方位。
 */
function MoonObserve({ ms, min, lat, lon, where, sel, rise, here, onHere }: { ms: number; min: number; lat: number; lon: number; where: string; sel: string; here?: boolean; onHere?: () => void; rise: { at: number; azimuth: number } | null }) {
  const [scale, setScale] = useState<"real" | "strong">("real");
  // 描き方（11/19 渡辺さん）：「見え方」＝球の陰影（暗い側は描かない、空で見える形）。「月の全体」＝暗い側も描く
  // （見えていない側も含めて、月の向き・回転を確かめるための絵）。
  const [look, setLook] = useState<"seen" | "whole">("seen");
  const p = moonPhase(ms);
  const topo = moonTopo(ms, lat, lon);
  const up = topo.altitude >= 0;
  const limb = moonLimb(ms, lat, lon);
  const north = moonNorth(ms, lat, lon);
  const ratio = topo.diameter / MOON_MEAN_DIAMETER;
  const size = Math.round(BASE * (scale === "real" ? ratio : 1 + STRONG * (ratio - 1)));
  const pct = Math.round((ratio - 1) * 1000) / 10;
  // 次に昇る：この日のうちならその時刻、過ぎていれば翌日の月の出。
  const next = rise && rise.at > min ? { day: sel, ...rise } : (() => { const d = nextDay(sel); const r = moonTimes(d, lat, lon).rise; return r ? { day: d, ...r } : null; })();
  return (
    <div className="moon-obs">
      <div className="moon-obs-side">
        <div
          className={up ? "moon-obs-stage" : "moon-obs-stage below"}
          role="img"
          aria-label={up ? `${clockOf(min)}の月：${dirName(topo.azimuth)} 高さ ${Math.round(topo.altitude)}°、光っている側は ${clockDir(limb)} の向き、大きさは平均の ${(ratio * 100).toFixed(1)}%${look === "whole" ? "（暗い側も描いた月の全体）" : ""}` : `${clockOf(min)}は月が地平線の下で見えません`}
        >
          <svg className="moon-obs-ring" width={STAGE} height={STAGE} viewBox={`0 0 ${STAGE} ${STAGE}`} aria-hidden>
            <circle cx={STAGE / 2} cy={STAGE / 2} r={BASE / 2} />
          </svg>
          {up ? <MoonSphere phase={p} size={size} limb={limb} north={north} tint={moonTint(topo.altitude)} dark={look === "whole"} /> : <span className="moon-obs-none">見えません</span>}
        </div>
        <Segmented
          label="月の描き方"
          value={look}
          onChange={setLook}
          options={[
            { id: "seen", label: "見え方" },
            { id: "whole", label: "月の全体" },
          ]}
        />
      </div>
      <div className="moon-obs-text">
        <small>
          {where}から見た {clockOf(min)}
        </small>
        {up ? (
          <>
            <b>
              {dirName(topo.azimuth)} 高さ {Math.round(topo.altitude)}°
            </b>
            <span>
              傾き：光っている側は <b>{clockDir(limb)}</b> の向き
            </span>
            <span>
              大きさ {dms(topo.diameter)}（平均より {pct >= 0 ? `+${pct}` : `${pct}`}%）
            </span>
            <span>距離 {Math.round(topo.km / 1000) / 10}万km</span>
          </>
        ) : (
          <>
            <b>地平線の下</b>
            <span>{next ? `次は ${next.day === sel ? "" : "翌日 "}${clockOf(Math.round(next.at))} に${dirName(next.azimuth)}から` : "翌日まで昇らない"}</span>
          </>
        )}
        <Segmented
          label="大きさの見せ方"
          value={scale}
          onChange={setScale}
          options={[
            { id: "real", label: "実際の比" },
            { id: "strong", label: "違いを強める" },
          ]}
        />
        <span className="moon-obs-foot">
        {/* 地点（11/19）：太陽と月のシートの「現在地で計算」と同じ切り替え。 */}
        {onHere && (
          <Button size="sm" aria-pressed={here} onClick={onHere}>
            現在地
          </Button>
        )}
        <InfoNote className="moon-note" more={
          <>
            {`見え方は、つまみの時刻に${where === "現在地" ? "現在地" : `${where}（観測所の場所）`}の空で見える形：`}{"光っている側の向き（傾き）・模様（海）の向き・高さで変わる色（低いほど大気で赤く、高いと白い。晴れた日の典型）。"}
            {" 月の全体は、暗い側（実際にはほとんど見えない）も描いて、月の向き・回転を確かめるための絵。"}
            {" 大きさは観測地から見た直径（度・分・秒）。点線の輪が平均の大きさ（0°31′05″）。"}
            {scale === "strong" ? ` いまは違いを ${STRONG} 倍に強めて描いている（実際は1年で ±7% ほど。地平線の月が大きく見えるのは目の錯覚）。` : " 実際の比で描いている（1年で ±7% ほど。地平線の月が大きく見えるのは目の錯覚）。"}
          </>
        }>
          見え方
        </InfoNote>
        </span>
      </div>
    </div>
  );
}

export const clockDir = (limb: number) => {
  const h = Math.round((((360 - limb) % 360) + 360) % 360 / 30) % 12;
  return `${h === 0 ? 12 : h}時`;
};

/**
 * その日の月の高さ（2026-11-19 渡辺さん「高さのグラフと組み合わせないと分かりにくい」）：0〜24時の月の高さ（観測地から、
 * 地平線の下は点線）を、空の色（太陽の高さから）の上に描く。3時間ごとに、その時刻の傾き・色の小さな月。つまみの時刻に縦線。
 * 押す・なぞると時刻を選ぶ。
 */
function MoonDay({ day, min, onPick }: { day: { pts: { min: number; altitude: number }[]; marks: { min: number; alt: number; limb: number; p: ReturnType<typeof moonPhase> }[]; sun: { min: number; deg: number }[] }; min: number; onPick: (m: number) => void }) {
  const box = useRef<SVGSVGElement>(null);
  const W = useDrawnWidth(box, [], 340) || 340;
  const H = 150;
  const fs = svgTextSize("xs", W, W);
  const L = 30;
  const R = 8;
  const top = 12;
  const bottom = H - 22;
  const x = (m: number) => L + (m / 1440) * (W - L - R);
  // 地平線の上は 0〜90° を高さの 7割、下は −90〜0° を 3割（見えない時間は狭く）。
  const hz = top + (bottom - top) * 0.7;
  const y = (a: number) => (a >= 0 ? hz - (Math.min(90, a) / 90) * (hz - top) : hz + (Math.max(-90, a) / -90) * (bottom - hz));
  const seg = (above: boolean) => {
    let d = "";
    let on = false;
    for (const q of day.pts) {
      const ok = above ? q.altitude >= 0 : q.altitude <= 0;
      if (!ok) {
        on = false;
        continue;
      }
      d += `${on ? "L" : "M"}${x(q.min).toFixed(1)},${y(q.altitude).toFixed(1)} `;
      on = true;
    }
    return d;
  };
  const drag = useRef(false);
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    onPick(Math.max(0, Math.min(1430, Math.round((((px - L) / (W - L - R)) * 1440) / 10) * 10)));
  };
  const G = 16;
  return (
    <svg
      ref={box}
      className="moon-day"
      data-no-sheet-drag
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="この日の月の高さ。押すとその時刻を選びます"
      onPointerDown={(e) => {
        e.stopPropagation();
        drag.current = true;
        pick(e);
      }}
      onPointerMove={(e) => drag.current && pick(e)}
      onPointerUp={() => (drag.current = false)}
      onPointerCancel={() => (drag.current = false)}
      onPointerLeave={() => (drag.current = false)}
    >
      <defs>
        <linearGradient id="moon-day-sky" x1="0" y1="0" x2="1" y2="0">
          {day.sun.filter((_, i) => i % 3 === 0).map((q) => (
            <stop key={q.min} offset={q.min / 1440} stopColor={skyAt(q.deg, 1, 0, q.min > 720).zenith} />
          ))}
        </linearGradient>
      </defs>
      <rect x={L} y={top} width={W - L - R} height={y(0) - top} fill="url(#moon-day-sky)" />
      <rect x={L} y={y(0)} width={W - L - R} height={bottom - y(0)} className="sky-ground" />
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="sun-horizon" />
      {[90, 45, 0, -90].map((a) => (
        <text key={a} x={L - 4} y={y(a) + 4} textAnchor="end" className="sun-tick" fontSize={fs}>
          {a}°
        </text>
      ))}
      {[0, 6, 12, 18, 24].map((hh) => (
        <text key={hh} x={x(hh * 60)} y={bottom + 15} textAnchor="middle" className="sun-tick" fontSize={fs}>
          {hh}
        </text>
      ))}
      <path d={seg(false)} className="moon-curve" style={{ stroke: ICON.moon }} />
      <path d={seg(true)} className="moon-day-up" style={{ stroke: ICON.moon }} />
      <line x1={x(min)} x2={x(min)} y1={top} y2={bottom} className="sun-cursor" />
      {day.marks.map((q) => (
        <g key={q.min} transform={`translate(${(x(q.min) - G / 2).toFixed(1)} ${(y(q.alt) - G / 2).toFixed(1)})`}>
          <MoonGlyph phase={q.p} size={G} limb={q.limb} tint={moonTint(q.alt)} />
        </g>
      ))}
    </svg>
  );
}
