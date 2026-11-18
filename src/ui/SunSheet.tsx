// 太陽 (#151): opened from the sun strip under the hour graph. The sun's height through the day
// against the horizon and the three twilights, and the times they begin and end.

import { clockOf, dayEdges, dayParts, altitudeCurve, twilights, TWILIGHTS } from "../../shared/dayParts";
import { sunHours, type SunTimes } from "../data/sun";
import { dateLabel, hoursMinutes } from "../design/format";
import { skyAt, type SkyColour } from "../../shared/sky";
import { ModalSheet } from "./ModalSheet";
import { Button, Glyph, IconButton, InfoNote, Segmented, Slider } from "./kit";
import { moonPhase, moonPosition, moonTimes } from "../../shared/moon";
import { DEFAULT_LAT_LON, solarAzimuth, stationLatLon } from "../../shared/sunTimes";
import { magneticDeclination, placeIn } from "../../shared/skyLook";
import { useSkyLook } from "./useSkyLook";
import { dirName, MoonGlyph } from "./moonParts";
import { MoonSheet } from "./MoonSheet";
import { ICON, RADIUS } from "../design/tokens";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { svgTextSize, useDrawnWidth } from "./useDrawnWidth";

const W = 340;
const H = 230;
const PAD = { left: 38, right: 8, top: 10, bottom: 20 };

export function SunSheet({
  date,
  station,
  sun,
  hour,
  sky,
  onClose,
}: {
  date: string;
  station: string;
  sun: SunTimes | null;
  hour: number | null;
  /** The day's own sky every 10 minutes (the 太陽 strip's, from the day's weather), by hour; an hour
   *  without data falls back to a clear day's sky (#151: the strip and the sheet tell the same sky). */
  sky?: (SkyColour[] | null)[];
  onClose: () => void;
}) {
  // The day's sun, worked out once per day and place (not on every move of the finger).
  const { e, t, curve, skies, filled } = useMemo(() => {
    const c = altitudeCurve(date, station, 10);
    // Each 10 minutes: the day's own sky when its hour has data, else a clear day's (and how many were clear).
    const own = (min: number) => sky?.[Math.floor(min / 60)]?.[Math.floor((min % 60) / 10)] ?? null;
    const skies = c.map((p) => own(p.min) ?? skyAt(p.deg, 1, 0, p.min > 720));
    const filled = c.slice(0, -1).filter((p) => !own(p.min)).length;
    return { e: dayEdges(date, station), t: twilights(date, station), curve: c, skies, filled };
  }, [date, station, sky]);
  // 月（2026-11-18、shared/moon.ts・Astronomy Engine）：10分ごとの高さと方位、その日の出・南中・入り。太陽の方位も。
  const ll = stationLatLon(station) ?? DEFAULT_LAT_LON;
  const sky3 = useMemo(() => {
    const day0 = Date.parse(`${date}T00:00:00+09:00`);
    const moon = curve.map((p) => moonPosition(day0 + p.min * 60_000, ll.lat, ll.lon));
    const sunAz = curve.map((p) => solarAzimuth(date, p.min, ll.lat, ll.lon));
    return { moon, sunAz, times: moonTimes(date, ll.lat, ll.lon), day0 };
  }, [date, curve, ll.lat, ll.lon]);
  // Sunrise and sunset by the same rule as the graph (data/sun sunHours), in minutes.
  const { rise: riseH, set: setH } = sunHours(sun, e);
  const rise = riseH * 60;
  const set = setH * 60;
  const high = Math.max(30, Math.ceil((e.noonAltitude + 8) / 10) * 10);
  const x = (min: number) => PAD.left + (min / 1440) * (W - PAD.left - PAD.right);
  // Above the horizon the axis is even (half the height); below it, it eases off smoothly
  // (1 − e^(−depth/25°)) so the three twilights near the horizon get room and the deep night less.
  const ph = H - PAD.top - PAD.bottom;
  const below = (depth: number) => (1 - Math.exp(-depth / 25)) / (1 - Math.exp(-90 / 25));
  const y = (deg: number) => {
    const d = Math.min(high, deg);
    const f = d >= 0 ? (1 - d / high) * 0.5 : 0.5 + below(-d) * 0.5;
    return PAD.top + f * ph;
  };
  const path = curve.map((p, i) => `${i ? "L" : "M"}${x(p.min).toFixed(1)},${y(p.deg).toFixed(1)}`).join(" ");
  const dayPath = curve.filter((p) => p.deg >= 0).map((p, i) => `${i ? "L" : "M"}${x(p.min).toFixed(1)},${y(p.deg).toFixed(1)}`).join(" ");
  // The moment read out, in 10-minute steps: starts at the graph's hour, moved by swiping the
  // chart or the slider under it.
  const [at, setAt] = useState(() => Math.min(1430, hour != null ? hour * 60 : Math.round(e.noon / 10) * 10));
  const [view, setView] = useState<"graph" | "sky">("graph");
  const [moonOpen, setMoonOpen] = useState(false);
  // 時間の動きを見る（再生）：10分ずつ進め、24時で頭に戻る。もう一度押すと止まる。
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setAt((a) => (a >= 1430 ? 0 : a + 10)), 90);
    return () => window.clearInterval(id);
  }, [playing]);
  // 端末の向きで見る（センサー連動）：向けた方向を真ん中にした窓。ずれは手で直せる（2°ずつ）。
  const [offset, setOffset] = useState(0);
  const sensor = useSkyLook(magneticDeclination(ll.lat, ll.lon), offset);
  const { state: sensorState, stop: stopSensor } = sensor;
  useEffect(() => {
    if (view !== "sky" && sensorState !== "off") stopSensor();
  }, [view, sensorState, stopSensor]);
  const altAt = curve.reduce((a, p) => (Math.abs(p.min - at) < Math.abs(a.min - at) ? p : a)).deg;
  // The sun's state in words that never clash with the app's five parts (朝・日中・昼・夕方・夜,
  // shared/dayParts): those are named beside it, so 19:00 reads 航海薄明 ・ 時間帯は夜.
  const phase = altAt >= 0 ? "日の出ている間" : altAt >= -6 ? "市民薄明" : altAt >= -12 ? "航海薄明" : altAt >= -18 ? "天文薄明" : "暗い夜空";
  const part = dayParts(date, station).find((p) => p.id !== "night" && at >= p.from && at < p.to)?.label ?? "夜";
  const skyNow = skies[Math.min(skies.length - 1, Math.round(at / 10))];
  const idx = Math.min(curve.length - 1, Math.round(at / 10));
  const moonAt = sky3.moon[idx];
  const sunAzAt = sky3.sunAz[idx];
  const phaseAt = moonPhase(sky3.day0 + at * 60_000);
  // 月の線（地平線より上だけ）を x・y の関数でつなぐ：下に入るとそこで切る。方位の線では 360°→0° をまたぐ所でも切る。
  const pathOf = (pts: { x: number; y: number; up: boolean }[], wrap = false) =>
    pts
      .map((p, i) => {
        if (!p.up) return "";
        const prev = pts[i - 1];
        const start = !prev || !prev.up || (wrap && Math.abs(p.x - prev.x) > W / 2);
        return `${start ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(" ");
  const moonPath = pathOf(curve.map((p, i) => ({ x: x(p.min), y: y(sky3.moon[i].altitude), up: sky3.moon[i].altitude >= 0 })));
  const svg = useRef<SVGSVGElement>(null);
  // The drawing is W wide and shown at the card's width: the tick labels are xs on screen (useDrawnWidth).
  const tick = svgTextSize("xs", W, useDrawnWidth(svg));
  const scrubbing = useRef(false);
  const moved = useRef(false);
  const pick = (ev: PointerEvent) => {
    const box = svg.current!.getBoundingClientRect();
    const sx = ((ev.clientX - box.left) / box.width) * W;
    const m = ((sx - PAD.left) / (W - PAD.left - PAD.right)) * 1440;
    setAt(Math.min(1430, Math.max(0, Math.round(m / 10) * 10)));
  };
  const length = set - rise;

  return (
    <ModalSheet title={`${dateLabel(date)}の太陽と月`} onClose={onClose} className="sun-sheet">
      {/* Reading the sun: a sunk face (数字を読む所), as the graph readouts. */}
      <div className="sun-card">
      <Segmented
        label="見かた"
        value={view}
        onChange={setView}
        options={[
          { id: "graph", label: "高さのグラフ" },
          { id: "sky", label: "空を見上げる" },
        ]}
      />
      {view === "sky" && <SkyView look={sensor.state === "on" ? sensor.look : null} at={at} sunAlt={altAt} sunAz={sunAzAt} moon={moonAt} phase={phaseAt} sunTrack={curve.map((p, i) => ({ alt: p.deg, az: sky3.sunAz[i] }))} moonTrack={sky3.moon.map((m) => ({ alt: m.altitude, az: m.azimuth }))} sky={skyNow} />}
      {view === "sky" && (
        <div className="sky-sensor">
          <Button size="sm" aria-pressed={sensor.state !== "off"} onClick={() => (sensor.state === "off" ? void sensor.start() : sensor.stop())}>
            {sensor.state === "off" ? "端末の向きで見る" : "向きで見るのをやめる"}
          </Button>
          {sensor.state === "on" && (
            <span className="sky-offset">
              <IconButton size="sm" label="方位のずれを左へ2°" onClick={() => setOffset((o) => o - 2)}>
                <Glyph name="minus" />
              </IconButton>
              <small>ずれ {offset > 0 ? `+${offset}` : offset}°</small>
              <IconButton size="sm" label="方位のずれを右へ2°" onClick={() => setOffset((o) => o + 2)}>
                <Glyph name="plus" />
              </IconButton>
            </span>
          )}
          <small className="sky-sensor-state" aria-live="polite">
            {{ off: "", waiting: "向きを読んでいます…", on: "", denied: "向きのセンサーが許可されませんでした（設定で許可できます）", unsupported: "この端末では向きのセンサーを読めません", noHeading: "方位が読めません（傾きだけ）" }[sensor.state]}
          </small>
        </div>
      )}
      <svg
        ref={svg}
        style={view === "sky" ? { display: "none" } : undefined}
        className="sun-chart"
        data-no-sheet-drag
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="一日の太陽の高さと薄明。左右になぞると10分ごとに読めます"
        // A tap reads where it lands; a sideways drag scrubs; a vertical drag scrolls the sheet
        // (pan-y: the browser takes it and cancels), so the cursor does not jump to the finger.
        onPointerDown={(ev) => {
          ev.stopPropagation();
          scrubbing.current = true;
          moved.current = false;
        }}
        onPointerMove={(ev) => {
          if (!scrubbing.current) return;
          moved.current = true;
          pick(ev);
        }}
        onPointerUp={(ev) => {
          if (scrubbing.current && !moved.current) pick(ev);
          scrubbing.current = false;
        }}
        onPointerCancel={() => (scrubbing.current = false)}
      >
        {/* The ground is the day's sky every 10 minutes (shared/sky.ts, as in 明るさと空 and the strip):
            above the horizon the colour overhead, below it the colour low over the land. */}
        {curve.slice(0, -1).map((p, i) => {
          const c = skies[i];
          const x0 = x(p.min);
          const x1 = x(p.min + 10) + 0.4;
          return (
            <g key={p.min}>
              <rect x={x0} width={x1 - x0} y={PAD.top} height={y(0) - PAD.top} fill={c.zenith} />
              <rect x={x0} width={x1 - x0} y={y(0)} height={H - PAD.bottom - y(0)} fill={c.horizon} />
            </g>
          );
        })}
        {[0, ...TWILIGHTS.map((tw) => tw.deg)].map((d) => (
          <g key={d}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(d)} y2={y(d)} className={d === 0 ? "sun-horizon" : "sun-depth"} />
            <text x={PAD.left - 4} y={y(d) + 3.5} textAnchor="end" className="sun-tick" fontSize={tick}>
              {d === 0 ? "0°" : `−${-d}°`}
            </text>
          </g>
        ))}
        <text x={PAD.left - 4} y={y(high) + 8} textAnchor="end" className="sun-tick" fontSize={tick}>
          {high}°
        </text>
        <path d={path} className="sun-curve" />
        {/* The sun above the horizon in the icons' sun colour, not 日照's data colour (it is no 日照 value). */}
        {dayPath && <path d={dayPath} className="sun-curve day" style={{ stroke: ICON.sun }} />}
        {/* Where the sun crosses 0°, −6°, −12°, −18°: a dot on the curve, morning and evening. */}
        {[rise, set, t.civil.start, t.civil.end, t.nautical.start, t.nautical.end, t.astronomical.start, t.astronomical.end].map((m, i) =>
          m == null ? null : <circle key={i} cx={x(m)} cy={y(i < 2 ? 0 : TWILIGHTS[Math.floor((i - 2) / 2)].deg)} r={i < 2 ? 3.5 : 2.6} className={i < 2 ? "sun-mark rise" : "sun-mark"} />,
        )}
        {/* 月：地平線より上の高さを点線で（色は天気の絵の月の色）、選んだ時刻の位置に丸。 */}
        {moonPath && <path d={moonPath} className="moon-curve" style={{ stroke: ICON.moon }} />}
        {moonAt.altitude >= 0 && <circle cx={x(at)} cy={y(moonAt.altitude)} r={4.5} className="moon-dot" style={{ fill: ICON.moon }} />}
        <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={H - PAD.bottom} className="sun-cursor" />
        <circle cx={x(at)} cy={y(altAt)} r={5} className={altAt >= 0 ? "sun-dot day" : "sun-dot"} />
        {/* Hours as on the hour graph: bare numbers every 3 hours. */}
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <text key={h} x={x(h * 60)} y={H - 5} textAnchor={h === 24 ? "end" : "middle"} className="sun-tick" fontSize={tick}>
            {h}
          </text>
        ))}
      </svg>
      {/* The same slider as 条件から選ぶ (kit Slider): ticks at sunrise and sunset, no span (a moment, not an amount). */}
      <div className="sun-play">
      <Slider
        className="sun-slider"
        min={0}
        max={1430}
        step={10}
        ticks={[rise, set]}
        thumbs={[{ value: at, label: "時刻（10分ごと）", valueText: `${clockOf(at)} ${phase}`, onChange: setAt }]}
      />
      <Button size="sm" aria-pressed={playing} onClick={() => setPlaying(!playing)}>
        {playing ? "止める" : "動かす"}
      </Button>
      </div>
      {/* The moment: its time, which part of the day, the sun's height, and the sky's colour then. */}
      <div className="sun-now">
        <i className="sun-now-sky" style={{ background: `linear-gradient(${skyNow.zenith}, ${skyNow.horizon})` }} />
        <b className="sun-now-time">{clockOf(at)}</b>
        <span className="sun-now-phase">
          {phase}
          <small>
            時間帯は{part}・{skyNow.word}
          </small>
        </span>
        <span className="sun-now-alt">
          {altAt >= 0 ? `地平線の上 ${Math.round(altAt)}°` : `地平線の下 ${Math.round(-altAt)}°`}
          <small>{dirName(sunAzAt)}</small>
        </span>
      </div>
      <div className="sun-now moon">
        <MoonGlyph phase={phaseAt} size={28} />
        <span className="sun-now-phase">
          月 {moonAt.altitude >= 0 ? `地平線の上 ${Math.round(moonAt.altitude)}°・${dirName(moonAt.azimuth)}` : "地平線の下"}
          <small>
            月齢 {phaseAt.age.toFixed(1)}・明るい部分 {Math.round(phaseAt.illuminated * 100)}%
          </small>
        </span>
        <Button size="sm" className="moon-open" onClick={() => setMoonOpen(true)}>
          月のこよみ
        </Button>
      </div>
      {moonOpen && <MoonSheet date={date} station={station} onClose={() => setMoonOpen(false)} />}
      </div>

      {/* 1画面に収める（2026-11-18 渡辺さん「スクロールしなくていいサイズまで」）：日の出・南中・日の入りを3枚に、
          3つの薄明は朝と夕の2列の表に、説明は ⓘ に。 */}
      <div className="sun-keys">
        {[
          { label: "日の出", time: rise },
          { label: "南中", time: e.noon, note: `高さ ${Math.round(e.noonAltitude)}°` },
          { label: "日の入り", time: set },
        ].map((k) => (
          <div key={k.label} className="sun-key">
            <small>{k.label}</small>
            <b>{k.time == null ? "—" : clockOf(k.time)}</b>
            {k.note && <small>{k.note}</small>}
          </div>
        ))}
      </div>
      <div className="sun-keys moon">
        {[
          { label: "月の出", ev: sky3.times.rise },
          { label: "月の南中", ev: sky3.times.transit, note: sky3.times.transit ? `高さ ${Math.round(sky3.times.transit.altitude)}°` : undefined },
          { label: "月の入り", ev: sky3.times.set },
        ].map((k) => (
          <div key={k.label} className="sun-key">
            <small>{k.label}</small>
            <b>{k.ev ? clockOf(Math.round(k.ev.at)) : "—"}</b>
            <small>{k.ev ? (k.note ?? dirName(k.ev.azimuth)) : "この日は無し"}</small>
          </div>
        ))}
      </div>
      <table className="sun-tw">
        <thead>
          <tr>
            <th>薄明</th>
            <th>朝の始まり</th>
            <th>夕の終わり</th>
          </tr>
        </thead>
        <tbody>
          {TWILIGHTS.map((tw) => {
            const span = tw.id === "civil" ? t.civil : tw.id === "nautical" ? t.nautical : t.astronomical;
            return (
              <tr key={tw.id}>
                <th>
                  {/* The sky low over the land in the middle of this twilight (a clear evening). */}
                  <i className="sun-swatch" style={{ background: skyAt(tw.deg + 3, 1, 0, true).horizon }} />
                  {tw.label.replace("薄明", "")}
                </th>
                <td>{span.start == null ? "—" : clockOf(span.start)}</td>
                <td>{span.end == null ? "—" : clockOf(span.end)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th>昼の長さ</th>
            <td colSpan={2}>{hoursMinutes(length)}</td>
          </tr>
        </tfoot>
      </table>
      <InfoNote
        className="sun-info"
        more={
          <>
            左右になぞると10分ごとに動きます。空の色はこの日の天気（実績・予報）からの模式で、グラフの下の帯と同じです
            {filled > 0 ? "（データのない時間は晴れた日の空）" : ""}。地平線の下は、薄明が見やすいように広げて描いています。
            {TWILIGHTS.map((tw) => (
              <span key={tw.id} className="sun-info-tw">
                <b>{tw.label}</b>（太陽が地平線の下 {-tw.deg - 6}〜{-tw.deg}°）：{tw.note}
              </span>
            ))}
          </>
        }
      >
        空の色は模式・なぞると10分ごと
      </InfoNote>
    </ModalSheet>
  );
}

/**
 * 空を見上げる（2026-11-18 の見本）：地上に立って見た空を、方位（北・東・南・西・北）を横に、高さ（地平線〜天頂）を縦に
 * 広げた絵。南を真ん中に。太陽と月のその日の通り道（地平線より上）と、選んだ時刻の位置。空の色は選んだ時刻の模式の色。
 */
function SkyView({ look, sunAlt, sunAz, moon, phase, sunTrack, moonTrack, sky }: { look?: { azimuth: number; altitude: number } | null; at: number; sunAlt: number; sunAz: number; moon: { altitude: number; azimuth: number }; phase: { age: number; illuminated: number }; sunTrack: { alt: number; az: number }[]; moonTrack: { alt: number; az: number }[]; sky: SkyColour }) {
  const VW = 340;
  const VH = 230;
  if (look) return <SkyWindow look={look} sunAlt={sunAlt} sunAz={sunAz} moon={moon} phase={phase} sunTrack={sunTrack} moonTrack={moonTrack} sky={sky} w={VW} h={VH} />;
  const P = { l: 6, r: 6, t: 10, b: 34 };
  const gx = (az: number) => P.l + (((az % 360) + 360) % 360 / 360) * (VW - P.l - P.r);
  const top = 75;
  const gy = (alt: number) => P.t + (1 - Math.max(-8, Math.min(top, alt)) / top) * (VH - P.t - P.b - 12);
  const horizon = gy(0);
  const track = (pts: { alt: number; az: number }[]) => {
    let d = "";
    pts.forEach((p, i) => {
      if (p.alt < 0) return;
      const q = pts[i - 1];
      const start = !q || q.alt < 0 || Math.abs(gx(p.az) - gx(q.az)) > VW / 2;
      d += `${start ? "M" : "L"}${gx(p.az).toFixed(1)},${gy(p.alt).toFixed(1)} `;
    });
    return d;
  };
  const lbl = [
    [0, "北"],
    [90, "東"],
    [180, "南"],
    [270, "西"],
    [360, "北"],
  ] as const;
  return (
    <svg className="sky-view" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={`空を見上げた絵。太陽は${sunAlt >= 0 ? `${dirName(sunAz)}の高さ${Math.round(sunAlt)}°` : "地平線の下"}、月は${moon.altitude >= 0 ? `${dirName(moon.azimuth)}の高さ${Math.round(moon.altitude)}°` : "地平線の下"}`}>
      <defs>
        <linearGradient id="sky-view-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky.zenith} />
          <stop offset="1" stopColor={sky.horizon} />
        </linearGradient>
      </defs>
      <rect x={P.l} y={P.t} width={VW - P.l - P.r} height={horizon - P.t} fill="url(#sky-view-bg)" rx={RADIUS.xs} />
      <rect x={P.l} y={horizon} width={VW - P.l - P.r} height={gy(-8) - horizon} className="sky-ground" />
      {[30, 60].map((a) => (
        <g key={a}>
          <line x1={P.l} x2={VW - P.r} y1={gy(a)} y2={gy(a)} className="sky-alt" />
          <text x={P.l + 3} y={gy(a) - 3} className="sun-tick sky-alt-label">
            {a}°
          </text>
        </g>
      ))}
      <line x1={P.l} x2={VW - P.r} y1={horizon} y2={horizon} className="sun-horizon" />
      {lbl.map(([az, t]) => (
        <g key={az}>
          <line x1={gx(az)} x2={gx(az)} y1={horizon} y2={horizon + 4} className="sun-horizon" />
          <text x={gx(az)} y={gy(-8) + 14} textAnchor={az === 0 ? "start" : az === 360 ? "end" : "middle"} className="sun-tick sky-dir">
            {t}
          </text>
        </g>
      ))}
      <path d={track(sunTrack)} className="sun-curve day" style={{ stroke: ICON.sun }} />
      <path d={track(moonTrack)} className="moon-curve" style={{ stroke: ICON.moon }} />
      {sunAlt >= 0 && <circle cx={gx(sunAz)} cy={gy(sunAlt)} r={9} style={{ fill: ICON.sun }} className="sky-sun" />}
      {moon.altitude >= 0 && (
        <g transform={`translate(${gx(moon.azimuth) - 10} ${gy(moon.altitude) - 10})`}>
          <MoonGlyph phase={phase} size={20} />
        </g>
      )}
    </svg>
  );
}

/**
 * 端末の向きで見る窓（センサー連動）：向けた方向を真ん中に、横 60° の空。地平線と高さの線、方位の名前、太陽と月の
 * 通り道と位置。窓の外にあるときは、その向きの端に矢印と名前（そちらを向くと見える）。
 */
const FOV = 60;
function SkyWindow({ look, sunAlt, sunAz, moon, phase, sunTrack, moonTrack, sky, w, h }: { look: { azimuth: number; altitude: number }; sunAlt: number; sunAz: number; moon: { altitude: number; azimuth: number }; phase: { age: number; illuminated: number }; sunTrack: { alt: number; az: number }[]; moonTrack: { alt: number; az: number }[]; sky: SkyColour; w: number; h: number }) {
  const at = (az: number, alt: number) => placeIn(look, { azimuth: az, altitude: alt }, FOV, w, h);
  const horizon = at(look.azimuth, 0).y;
  const track = (pts: { alt: number; az: number }[]) => {
    let d = "";
    let prev: { x: number; y: number } | null = null;
    for (const p of pts) {
      const q = at(p.az, p.alt);
      const ok = p.alt >= 0 && Math.abs(q.dx) < FOV;
      if (!ok) {
        prev = null;
        continue;
      }
      d += `${prev ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)} `;
      prev = q;
    }
    return d;
  };
  const dirs = Array.from({ length: 16 }, (_, i) => i * 22.5).filter((az) => Math.abs(at(az, 0).dx) <= FOV / 2);
  const edge = (az: number, alt: number, name: string) => {
    const q = at(az, alt);
    if (q.inside || alt < 0) return null;
    const ang = Math.atan2(-q.dy, q.dx);
    const ex = w / 2 + Math.cos(ang) * (w / 2 - 22);
    const ey = h / 2 + Math.sin(ang) * (h / 2 - 16);
    return (
      <g className="sky-edge" transform={`translate(${ex.toFixed(1)} ${ey.toFixed(1)})`}>
        <path d="M-5,-4 L5,0 L-5,4 Z" transform={`rotate(${((ang * 180) / Math.PI).toFixed(1)})`} />
        <text y={-8} textAnchor="middle" className="sun-tick">
          {name}
        </text>
      </g>
    );
  };
  const sun = at(sunAz, sunAlt);
  const mo = at(moon.azimuth, moon.altitude);
  return (
    <svg className="sky-view window" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`端末を向けた方向の空：${dirName(look.azimuth)}・高さ${Math.round(look.altitude)}°`}>
      <defs>
        <linearGradient id="sky-window-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky.zenith} />
          <stop offset="1" stopColor={sky.horizon} />
        </linearGradient>
        <clipPath id="sky-window-clip">
          <rect width={w} height={h} rx={RADIUS.md} />
        </clipPath>
      </defs>
      <g clipPath="url(#sky-window-clip)">
        <rect width={w} height={h} fill="url(#sky-window-bg)" />
        {horizon < h && <rect y={Math.max(0, horizon)} width={w} height={h - Math.max(0, horizon)} className="sky-ground" />}
        {[30, 60].map((a) => {
          const y = at(look.azimuth, a).y;
          return y > 0 && y < h ? <line key={a} x1={0} x2={w} y1={y} y2={y} className="sky-alt" /> : null;
        })}
        {horizon > 0 && horizon < h && <line x1={0} x2={w} y1={horizon} y2={horizon} className="sun-horizon" />}
        {dirs.map((az) => (
          <text key={az} x={at(az, 0).x} y={Math.min(h - 6, Math.max(14, horizon + 14))} textAnchor="middle" className="sun-tick sky-dir">
            {dirName(az)}
          </text>
        ))}
        <path d={track(sunTrack)} className="sun-curve day" style={{ stroke: ICON.sun }} />
        <path d={track(moonTrack)} className="moon-curve" style={{ stroke: ICON.moon }} />
        {sunAlt >= 0 && sun.inside && <circle cx={sun.x} cy={sun.y} r={12} style={{ fill: ICON.sun }} className="sky-sun" />}
        {moon.altitude >= 0 && mo.inside && (
          <g transform={`translate(${mo.x - 13} ${mo.y - 13})`}>
            <MoonGlyph phase={phase} size={26} />
          </g>
        )}
        {edge(sunAz, sunAlt, "太陽")}
        {edge(moon.azimuth, moon.altitude, "月")}
        <text x={8} y={18} className="sun-tick sky-heading">
          {dirName(look.azimuth)} {Math.round(look.azimuth)}°・{look.altitude >= 0 ? `上へ ${Math.round(look.altitude)}°` : `下へ ${Math.round(-look.altitude)}°`}
        </text>
      </g>
    </svg>
  );
}
