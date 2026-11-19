// 太陽 (#151): opened from the sun strip under the hour graph. The sun's height through the day
// against the horizon and the three twilights, and the times they begin and end.

import { clockOf, dayEdges, dayParts, altitudeCurve, twilights, TWILIGHTS } from "../../shared/dayParts";
import { shownClock, shownDayLength, shownSun } from "../data/sun";
import { dateLabel, hoursMinutes } from "../design/format";
import { skyAt, type SkyColour } from "../../shared/sky";
import { ModalSheet } from "./ModalSheet";
import { Button, Fold, IconButton, InfoNote, Segmented } from "./kit";
import { TimeBar } from "./TimeBar";
import { moonLimb, moonNorth, moonPhase, moonPosition, moonTimes, moonTint, moonTopo } from "../../shared/moon";
import { DEFAULT_LAT_LON, solarAltitude, solarAzimuth, stationLatLon } from "../../shared/sunTimes";
import { jstToday } from "../../shared/dates";
import { azDiff, magneticDeclination, project, tapCorrection } from "../../shared/skyLook";
import { useCamera } from "./useCamera";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";
import { useSkyLook } from "./useSkyLook";
import { CompassTrim } from "./CompassTrim";
import { dirName, MoonGlyph, MoonSphere } from "./moonParts";
import { latLonText, useHere } from "./useHere";
import stations from "../../shared/stations.json";
import { MoonSheet } from "./MoonSheet";
import { onSkyVars, SKY_ICON, TWILIGHT_BAND } from "../design/tokens";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { svgTextSize, useDrawnWidth } from "./useDrawnWidth";

/** 空の色の上に描くもの（#241、11/20）：テーマによらず暗い地に合わせた色で。 */
const ON_SKY = onSkyVars() as CSSProperties;
/** 薄明の帯の高さ（グラフの単位）。 */
const TW_STRIP = 6;

const W = 340;
const H = 270; // 11/19：出入りを2行に詰めた分、グラフ（主役）を大きく
const PAD = { left: 38, right: 8, top: 10, bottom: 20 };

export function SunSheet({
  date,
  station,
  hour,
  sky,
  onClose,
}: {
  date: string;
  station: string;
  hour: number | null;
  /** The day's own sky every 10 minutes (the 太陽 strip's, from the day's weather), by hour; an hour
   *  without data falls back to a clear day's sky (#151: the strip and the sheet tell the same sky). */
  sky?: (SkyColour[] | null)[];
  onClose: () => void;
}) {
  // 計算の地点（11/19）：観測所か、現在地（太陽と月の計算だけ。天気は観測所のまま）。
  const here = useHere();
  const hereOn = here.state.kind === "on" ? here.state : null;
  const place = hereOn ? { lat: hereOn.lat, lon: hereOn.lon } : station;
  const placeKey = hereOn ? `${hereOn.lat},${hereOn.lon}` : station;
  const stationName = (stations as { blockNo: string; name: string }[]).find((x) => x.blockNo === station)?.name ?? "観測所";
  // The day's sun, worked out once per day and place (not on every move of the finger).
  const { e, t, curve, skies, filled } = useMemo(() => {
    const c = altitudeCurve(date, place, 10);
    // Each 10 minutes: the day's own sky when its hour has data, else a clear day's (and how many were clear).
    const own = (min: number) => sky?.[Math.floor(min / 60)]?.[Math.floor((min % 60) / 10)] ?? null;
    const skies = c.map((p) => own(p.min) ?? skyAt(p.deg, 1, 0, p.min > 720));
    const filled = c.slice(0, -1).filter((p) => !own(p.min)).length;
    return { e: dayEdges(date, place), t: twilights(date, place), curve: c, skies, filled };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- place は placeKey で見る（毎回作る物なので）
  }, [date, placeKey, sky]);
  // 月（2026-11-18、shared/moon.ts・Astronomy Engine）：10分ごとの高さと方位、その日の出・南中・入り。太陽の方位も。
  const ll = hereOn ? { lat: hereOn.lat, lon: hereOn.lon } : (stationLatLon(station) ?? DEFAULT_LAT_LON);
  const sky3 = useMemo(() => {
    const day0 = Date.parse(`${date}T00:00:00+09:00`);
    const moon = curve.map((p) => moonPosition(day0 + p.min * 60_000, ll.lat, ll.lon));
    const sunAz = curve.map((p) => solarAzimuth(date, p.min, ll.lat, ll.lon));
    return { moon, sunAz, times: moonTimes(date, ll.lat, ll.lon), day0 };
  }, [date, curve, ll.lat, ll.lon]);
  // 日の出・日の入り（分）：画面はどこも計算の値（src/data/sun.ts shownSun）。無い日は文字に「なし」、絵は区切りの代わりの値。
  const shown = shownSun(date, place);
  const rise = shown.rise ?? e.rise;
  const set = shown.set ?? e.set;
  // 上端は太陽と月の高い方から決める（月が太陽より高く昇る日に、月の線が上端に張り付かないように）。
  const peak = Math.max(e.noonAltitude, ...sky3.moon.map((m) => m.altitude));
  const high = Math.min(90, Math.max(30, Math.ceil((peak + 8) / 10) * 10));
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
  const [twOpen, setTwOpen] = useState(false);
  // 今に付いていく（11/19 渡辺さん「時間帯を今に追跡する機能と、ここからどう変わるかを見る時間帯変更の両方」）：今日のときだけ。
  // 端末の向きで見はじめると付いていき（20秒ごとに今の分へ）、つまみ・グラフ・動かすで時刻を動かすと止まる。「今」で戻る。
  const isToday = date === jstToday();
  const [follow, setFollow] = useState(false);
  useEffect(() => {
    if (!follow) return;
    const tick = () => {
      const d = new Date(Date.now() + 9 * 3_600_000);
      setAt(d.getUTCHours() * 60 + d.getUTCMinutes());
    };
    tick();
    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
  }, [follow]);
  const move = (m: number) => {
    setFollow(false);
    setAt(m);
  };
  // 時間の動きを見る（再生）：10分ずつ進め、24時で頭に戻る。もう一度押すと止まる。
  const [playing, setPlaying] = useState(false);
  const play = () => {
    setFollow(false);
    setPlaying(!playing);
  };
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setAt((a) => (a >= 1430 ? 0 : a + 10)), 90);
    return () => window.clearInterval(id);
  }, [playing]);
  // 端末の向きで見る（センサー連動）：向けた方向を真ん中にした窓。ずれはコンパス補正の目盛りをなぞって直せる。
  const [offset, setOffset] = useState(0);
  // 本物を押して直す（11/19）：カメラに写った本物の月か太陽を押すと、方位のずれをコンパス補正に足す。
  const [aiming, setAiming] = useState(false);
  const [aimNote, setAimNote] = useState("");
  const tap = {
    armed: aiming,
    onTap: (c: { dAz: number; dAlt: number; name: string }) => {
      setOffset((o) => Math.max(-180, Math.min(180, Math.round((o + c.dAz) * 10) / 10)));
      // 高さも直す（11/19 渡辺さん「推定高度の再計算もついでに」）：真ん中の＋で合わせるので画角のずれが入らない。
      setAltOffset((o) => Math.max(-30, Math.min(30, Math.round((o + c.dAlt) * 10) / 10)));
      setAiming(false);
      const sg = (v: number) => (v >= 0 ? `+${v.toFixed(1)}` : `−${(-v).toFixed(1)}`);
      setAimNote(`${c.name}に合わせました：方位 ${sg(c.dAz)}°・高さ ${sg(c.dAlt)}°`);
    },
  };
  const sensor = useSkyLook(magneticDeclination(ll.lat, ll.lon), offset);
  // 高さの補正（本物に合わせたときの差）。方位を 0°に戻すと一緒に戻す。
  const [altOffset, setAltOffset] = useState(0);
  const sensorLook = sensor.look ? { ...sensor.look, altitude: sensor.look.altitude + altOffset } : null;
  const camera = useCamera();
  // 方位を直す（11/19）：ボタン1つ。長押しでなぞって直す、短く押すとカメラのときは本物に合わせる、ほかは使い方を出す。
  const trim = (
    <CompassTrim
      value={offset}
      onChange={(v) => {
        setOffset(v);
        if (v === 0) setAltOffset(0);
      }}
      heading={sensor.look?.azimuth ?? 0}
      pressed={aiming}
      onTap={camera.state === "on" ? () => (setAiming(!aiming), setAimNote("")) : undefined}
      onHint={() => setAimNote("長押ししたまま左右になぞると方位を直せます。カメラを付けると、短く押して本物の月か太陽に合わせられます")}
    />
  );
  const [full, setFull] = useState(false);
  // 拡大（11/19 渡辺さん「拡大機能も」）：1〜20倍。2本指でつまむ、窓の ＋ −。なぞって見る窓の向きも全画面と共有する。
  const [zoom, setZoom] = useState(1);
  const [panView, setPanView] = useState<{ azimuth: number; altitude: number } | null>(null);
  const { state: sensorState, stop: stopSensor } = sensor;
  const { state: cameraState, stop: stopCamera } = camera;
  // 向きで見るのをやめたら、カメラも全画面も閉じる。
  useEffect(() => {
    if (sensorState === "off") {
      if (cameraState !== "off") stopCamera();
      setFull(false);
    }
  }, [sensorState, cameraState, stopCamera]);
  useEffect(() => {
    if (cameraState !== "on") setAiming(false);
  }, [cameraState]);
  useEffect(() => {
    if (view !== "sky" && sensorState !== "off") stopSensor();
  }, [view, sensorState, stopSensor]);
  useEffect(() => {
    if (sensorState === "on" && isToday) {
      setPlaying(false);
      setFollow(true);
    }
  }, [sensorState, isToday]);
  // その時刻の太陽と月（分まで。10分ごとの点から拾わない：太陽は10分で約2.5°動く）。
  const altAt = solarAltitude(date, at, ll.lat, ll.lon);
  // The sun's state in words that never clash with the app's five parts (朝・日中・昼・夕方・夜,
  // shared/dayParts): those are named beside it, so 19:00 reads 航海薄明 ・ 時間帯は夜.
  const phase = altAt >= 0 ? "日の出ている間" : altAt >= -6 ? "市民薄明" : altAt >= -12 ? "航海薄明" : altAt >= -18 ? "天文薄明" : "暗い夜空";
  const part = dayParts(date, place).find((p) => p.id !== "night" && at >= p.from && at < p.to)?.label ?? "夜";
  const skyNow = skies[Math.min(skies.length - 1, Math.round(at / 10))];
  const msAt = sky3.day0 + at * 60_000;
  const topoAt = moonTopo(msAt, ll.lat, ll.lon);
  // 空を見上げるの月：見かけの大きさ・光っている側・模様の向き・高さの色も（11/19 レビュー）。
  const moonAt = { altitude: topoAt.altitude, azimuth: topoAt.azimuth, diameter: topoAt.diameter, limb: moonLimb(msAt, ll.lat, ll.lon), north: moonNorth(msAt, ll.lat, ll.lon), tint: moonTint(topoAt.altitude) };
  const sunAzAt = solarAzimuth(date, at, ll.lat, ll.lon);
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
    move(Math.min(1430, Math.max(0, Math.round(m / 10) * 10)));
  };
  const length = shownDayLength(shown);

  return (
    <ModalSheet title={`${dateLabel(date)}の太陽と月${hereOn ? "（現在地）" : ""}`} onClose={onClose} className="sun-sheet">
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
      {view === "sky" && !full && <SkyView look={sensor.state === "on" ? sensorLook : null} stream={camera.stream} tap={tap} zoom={zoom} onZoom={setZoom} panView={panView} onPan={setPanView} at={at} sunAlt={altAt} sunAz={sunAzAt} moon={moonAt} phase={phaseAt} sunTrack={curve.map((p, i) => ({ alt: p.deg, az: sky3.sunAz[i] }))} moonTrack={sky3.moon.map((m) => ({ alt: m.altitude, az: m.azimuth }))} sky={skyNow} />}
      {full && view === "sky" && (sensor.state !== "on" || sensorLook) && (
        <SkyFull
          onClose={() => setFull(false)}
          sky={(w, h) => sensor.state !== "on" || !sensorLook ? <SkyPan full zoom={zoom} onZoom={setZoom} view={panView} onView={setPanView} sunAlt={altAt} sunAz={sunAzAt} moon={moonAt} phase={phaseAt} sunTrack={curve.map((p, i) => ({ alt: p.deg, az: sky3.sunAz[i] }))} moonTrack={sky3.moon.map((m) => ({ alt: m.altitude, az: m.azimuth }))} sky={skyNow} w={w} h={h} /> : <SkyWindow full zoom={zoom} onZoom={setZoom} look={sensorLook} stream={camera.stream} tap={tap} sunAlt={altAt} sunAz={sunAzAt} moon={moonAt} phase={phaseAt} sunTrack={curve.map((p, i) => ({ alt: p.deg, az: sky3.sunAz[i] }))} moonTrack={sky3.moon.map((m) => ({ alt: m.altitude, az: m.azimuth }))} sky={skyNow} w={w} h={h} />}
          controls={
            <>
              <p className="sky-full-read">
                <b>{clockOf(at)}</b> {sensorLook ? `${dirName(sensorLook.azimuth)} ${Math.round(sensorLook.azimuth)}°・${sensorLook.altitude >= 0 ? `上へ ${Math.round(sensorLook.altitude)}°` : `下へ ${Math.round(-sensorLook.altitude)}°`}` : "なぞって向きを回す"}
                <small>
                  太陽 {altAt >= 0 ? `${dirName(sunAzAt)} ${Math.round(altAt)}°` : "地平線の下"}・月 {moonAt.altitude >= 0 ? `${dirName(moonAt.azimuth)} ${Math.round(moonAt.altitude)}°` : "地平線の下"}
                </small>
              </p>
              <TimeBar value={at} onChange={move} ticks={[rise, set]} valueText={clockOf(at)} follow={isToday ? follow : undefined} onFollow={() => (follow ? setFollow(false) : (setPlaying(false), setFollow(true)))} playing={playing} onPlay={play} />
              {sensor.state === "on" && (
                <div className="sky-sensor">
                  <Button size="sm" aria-pressed={camera.state === "on"} onClick={() => (camera.state === "on" ? camera.stop() : void camera.start())}>
                    カメラ
                  </Button>
                  {trim}
                </div>
              )}
              <small className="sky-sensor-state" aria-live="polite">
                {aiming ? "本物の太陽か月を真ん中の＋に合わせて、画面をタップしてください" : aimNote}
              </small>
            </>
          }
        />
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
        {/* 目盛りの文字はページの地の上（テーマの色）、線は空の上（ON_SKY）。 */}
        {[0, ...TWILIGHTS.map((tw) => tw.deg)].map((d) => (
          <text key={d} x={PAD.left - 4} y={y(d) + 3.5} textAnchor="end" className="sun-tick" fontSize={tick}>
            {d === 0 ? "0°" : `−${-d}°`}
          </text>
        ))}
        <text x={PAD.left - 4} y={y(high) + 8} textAnchor="end" className="sun-tick" fontSize={tick}>
          {high}°
        </text>
        <g style={ON_SKY}>
        {/* 薄明の段（11/20 渡辺さん）：下の端に、市民・航海・天文の帯。空はなめらかなまま、段の区切りをここで読む。色は薄明の表の見本と同じ。 */}
        {curve.slice(0, -1).map((p) => {
          const mid = (p.deg + (curve[curve.indexOf(p) + 1]?.deg ?? p.deg)) / 2;
          const k = mid > 0 || mid <= -18 ? null : mid > -6 ? TWILIGHT_BAND.civil : mid > -12 ? TWILIGHT_BAND.nautical : TWILIGHT_BAND.astronomical;
          return k ? <rect key={`tw${p.min}`} x={x(p.min)} width={x(p.min + 10) - x(p.min) + 0.4} y={H - PAD.bottom - TW_STRIP} height={TW_STRIP} fill={k} className="sun-tw-strip" /> : null;
        })}
        {[0, ...TWILIGHTS.map((tw) => tw.deg)].map((d) => (
          <line key={d} x1={PAD.left} x2={W - PAD.right} y1={y(d)} y2={y(d)} className={d === 0 ? "sun-horizon" : "sun-depth"} />
        ))}
        <path d={path} className="sun-curve" />
        {/* The sun above the horizon in the icons' sun colour, not 日照's data colour (it is no 日照 value). */}
        {dayPath && <path d={dayPath} className="sun-curve day" style={{ stroke: SKY_ICON.sun }} />}
        {/* 日の出入り（太陽の上端が地平線、中心は −0.833°）と −6°・−12°・−18° を曲線の上に点で。日の出入りの点は 0° の線（地平線）より
            わずかに下：中心が 0° になるのは数分あと（定義の違い、11/19）。日の出入りの無い日は点を打たない。 */}
        {[shown.rise, shown.set, t.civil.start, t.civil.end, t.nautical.start, t.nautical.end, t.astronomical.start, t.astronomical.end].map((m, i) =>
          m == null ? null : <circle key={i} cx={x(m)} cy={y(i < 2 ? -0.833 : TWILIGHTS[Math.floor((i - 2) / 2)].deg)} r={i < 2 ? 3.5 : 2.6} className={i < 2 ? "sun-mark rise" : "sun-mark"} />,
        )}
        {/* 月：地平線より上の高さを点線で（色は天気の絵の月の色）、選んだ時刻の位置に丸。 */}
        {moonPath && <path d={moonPath} className="moon-curve" style={{ stroke: SKY_ICON.moon }} />}
        {moonAt.altitude >= 0 && <circle cx={x(at)} cy={y(moonAt.altitude)} r={4.5} className="moon-dot" style={{ fill: SKY_ICON.moon }} />}
        <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={H - PAD.bottom} className="sun-cursor" />
        <circle cx={x(at)} cy={y(altAt)} r={5} className={altAt >= 0 ? "sun-dot day" : "sun-dot"} />
        </g>
        {/* Hours as on the hour graph: bare numbers every 3 hours. */}
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <text key={h} x={x(h * 60)} y={H - 5} textAnchor={h === 24 ? "end" : "middle"} className="sun-tick" fontSize={tick}>
            {h}
          </text>
        ))}
      </svg>
      {/* The same slider as 条件から選ぶ (kit Slider): ticks at sunrise and sunset, no span (a moment, not an amount). */}
      {/* 時刻の操作（TimeBar）：◀ つまみ ▶、現在時刻（付いていく・もう一度でやめる）、▶／⏸。 */}
      <TimeBar value={at} onChange={move} ticks={[rise, set]} valueText={`${clockOf(at)} ${phase}`} follow={isToday ? follow : undefined} onFollow={() => (follow ? setFollow(false) : (setPlaying(false), setFollow(true)))} playing={playing} onPlay={play} />
      {view === "sky" && (
        <div className="sky-sensor">
          {/* ボタンは短い言葉で、押している（使っている）ものは選んでいる色（11/19 渡辺さん「ごちゃごちゃしている」）。 */}
          <Button size="sm" aria-pressed={sensor.state !== "off"} onClick={() => (sensor.state === "off" ? void sensor.start() : sensor.stop())}>
            端末の向き
          </Button>
          <Button size="sm" onClick={() => setFull(true)}>
            全画面
          </Button>
          {sensor.state === "on" && (
            <>
              <Button size="sm" aria-pressed={camera.state === "on"} onClick={() => (camera.state === "on" ? camera.stop() : void camera.start())}>
                カメラ
              </Button>
              <span className="sky-sensor-break" aria-hidden />
              {trim}
            </>
          )}
          <small className="sky-sensor-state" aria-live="polite">
            {aiming ? "本物の太陽か月を真ん中の＋に合わせて、画面をタップしてください" : aimNote}
            {sensor.state === "on" && !sensor.calibrated && "方位を合わせるため、一度端末を立てて地平線の方へ向けてください（見上げている間はコンパスがずれやすい）"}
            {{ off: "", waiting: "向きを読んでいます…", on: "", denied: "向きのセンサーが許可されませんでした（設定で許可できます）", unsupported: "この端末では向きのセンサーを読めません", noHeading: "方位が読めません（傾きだけ）" }[sensor.state]}
            {{ off: "", starting: "カメラを開いています…", on: "", denied: "カメラが許可されませんでした（設定で許可できます）", unsupported: "この端末ではカメラを使えません" }[camera.state]}
          </small>
        </div>
      )}
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
        {/* 11/19 渡辺さん「この回転や傾きをこっちにも」：出ている間は月のこよみの「見え方」と同じ（光っている側の傾き・模様の向き・
            高さの色）。地平線の下は暦の形のまま。 */}
        {moonAt.altitude >= 0 ? (
          <span className="sun-now-moon" aria-hidden>
            <MoonSphere phase={phaseAt} size={28} limb={moonAt.limb} north={moonAt.north} tint={moonAt.tint} dark={false} />
          </span>
        ) : (
          <MoonGlyph phase={phaseAt} size={28} />
        )}
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
      {moonOpen && <MoonSheet date={date} station={station} here={hereOn} onHere={() => (hereOn || here.state.kind === "asking" ? here.stop() : here.ask())} onClose={() => setMoonOpen(false)} />}
      </div>

      {/* 太陽と月の出入り（11/19 レビュー「6枚のカードを太陽と月の2行に」）：1行ずつ、時刻の順に。月はその日の暦どおり
          （0時台の月の入りは、前の晩に昇った月）。薄明と昼の長さは畳む（開くと3つの薄明の表）。 */}
      <div className="sun-keys">
        <span className="sun-keys-name">太陽</span>
        {[
          { label: "日の出", time: shown.rise, none: true },
          { label: "南中", time: e.noon, note: `${Math.round(e.noonAltitude)}°` },
          { label: "日の入り", time: shown.set, none: true },
        ].map((k) => (
          <div key={k.label} className="sun-key">
            <small>{k.label}</small>
            <b>{"none" in k ? shownClock(k.time) : k.time == null ? "—" : clockOf(k.time)}</b>
            {k.note && <small>{k.note}</small>}
          </div>
        ))}
      </div>
      <div className="sun-keys moon">
        <span className="sun-keys-name">月</span>
        {[
          { label: "月の出", ev: sky3.times.rise },
          { label: "南中", ev: sky3.times.transit, note: sky3.times.transit ? `${Math.round(sky3.times.transit.altitude)}°` : undefined },
          { label: "月の入り", ev: sky3.times.set },
        ]
          .sort((a, b) => (a.ev?.at ?? 9e9) - (b.ev?.at ?? 9e9))
          .map((k) => (
            <div key={k.label} className="sun-key">
              <small>{k.label}</small>
              <b>{k.ev ? clockOf(Math.round(k.ev.at)) : "—"}</b>
              <small>{k.ev ? (k.note ?? dirName(k.ev.azimuth)) : "この日は無し"}</small>
            </div>
          ))}
      </div>
      <Fold open={twOpen} onToggle={() => setTwOpen(!twOpen)} openLabel={`薄明と昼の長さ（昼 ${hoursMinutes(length)}）`} closeLabel="薄明と昼の長さを閉じる">
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
                  {/* グラフの下の端の帯と同じ色（11/20）。 */}
                  <i className="sun-swatch" style={{ background: TWILIGHT_BAND[tw.id] }} />
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
      </Fold>
      <div className="sun-foot">
      <InfoNote
        className="sun-info"
        more={
          <>
            日の出・日の入りは、太陽の上端が地平線に接する時刻（大気差込み）の計算です（国立天文台の暦と1分以内）。グラフの点は太陽の中心の高さなので、0° の線（地平線）よりわずかに下にあります。
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
        <Button size="sm" aria-pressed={!!hereOn} onClick={() => (hereOn || here.state.kind === "asking" ? here.stop() : here.ask())}>
          現在地で計算
        </Button>
      </div>
      <small className="sun-here" aria-live="polite">
        {hereOn
          ? `太陽と月は現在地（${latLonText(hereOn.lat, hereOn.lon)}）で計算。空の色と天気は${stationName}`
          : { off: `太陽と月は${stationName}（観測所）の場所で計算`, asking: "現在地を読んでいます…", denied: "位置情報が許可されませんでした（設定で許可できます）。観測所で計算しています", unavailable: "現在地を読めませんでした。観測所で計算しています", outside: "現在地は日本の中だけ使えます。観測所で計算しています" }[here.state.kind as "off" | "asking" | "denied" | "unavailable" | "outside"]}
      </small>
    </ModalSheet>
  );
}

/**
 * 空を見上げる（2026-11-18 の見本）：地上に立って見た空を、方位（北・東・南・西・北）を横に、高さ（地平線〜天頂）を縦に
 * 広げた絵。南を真ん中に。太陽と月のその日の通り道（地平線より上）と、選んだ時刻の位置。空の色は選んだ時刻の模式の色。
 */
function SkyView({ look, stream, tap, zoom, onZoom, panView, onPan, sunAlt, sunAz, moon, phase, sunTrack, moonTrack, sky }: { look?: { azimuth: number; altitude: number } | null; stream?: MediaStream | null; tap?: SkyTap; zoom: number; onZoom: (z: number) => void; panView: { azimuth: number; altitude: number } | null; onPan: (v: { azimuth: number; altitude: number }) => void; at: number; sunAlt: number; sunAz: number; moon: SkyMoon; phase: { age: number; illuminated: number }; sunTrack: { alt: number; az: number }[]; moonTrack: { alt: number; az: number }[]; sky: SkyColour }) {
  // 窓の大きさ（11/19 渡辺さん「画面をもっと大きく使いたい」）：340×230 から縦に伸ばして 340×300。
  const VW = 340;
  const VH = 300;
  if (look) return <SkyWindow look={look} tap={tap} zoom={zoom} onZoom={onZoom} sunAlt={sunAlt} sunAz={sunAz} moon={moon} phase={phase} sunTrack={sunTrack} moonTrack={moonTrack} sky={sky} w={VW} h={VH} stream={stream} />;
  return <SkyPan zoom={zoom} onZoom={onZoom} view={panView} onView={onPan} sunAlt={sunAlt} sunAz={sunAz} moon={moon} phase={phase} sunTrack={sunTrack} moonTrack={moonTrack} sky={sky} w={VW} h={VH} />;
}

/** なぞって見る窓の横の画角（°）。 */
const PAN_FOV = 90;

/**
 * なぞって見る窓（2026-11-19 渡辺さん「東西南北が一列ではなく、横スクロールで向いている視野を」）：端末の向きで見るときと同じ
 * 透視の窓（横 90°）を、指で左右（と上下）になぞって回す。はじめは、地平線の上の太陽、なければ月、なければ南を真ん中に
 * （なぞるまでは時刻に合わせて付いていく）。←→ で 5°、↑↓ で高さ。
 */
function SkyPan({ w, h, zoom, onZoom, view, onView, full, ...p }: Omit<SkyProps, "look"> & { w: number; h: number; zoom: number; onZoom: (z: number) => void; view: { azimuth: number; altitude: number } | null; onView: (v: { azimuth: number; altitude: number }) => void; full?: boolean }) {
  const auto =
    p.sunAlt >= 0 ? { azimuth: p.sunAz, altitude: p.sunAlt } : p.moon.altitude >= 0 ? { azimuth: p.moon.azimuth, altitude: p.moon.altitude } : { azimuth: 180, altitude: 15 };
  // 地平線は窓の下の端近くに（下の地面が空白にならないよう。縦の画角は約 80°、真ん中を 33° 上にすると地平線は下から 1/7 ほど）。
  const look = view ?? { azimuth: auto.azimuth, altitude: Math.max(33, Math.min(45, auto.altitude - 5)) };
  const drag = useRef<{ x: number; y: number; az: number; alt: number; k: number } | null>(null);
  const pinch = usePinch(zoom, onZoom);
  const norm = (a: number) => ((a % 360) + 360) % 360;
  const clampAlt = (a: number) => Math.max(-10, Math.min(89, a));
  return (
    <div
      className={full ? "sky-pan full" : "sky-pan"}
      data-no-sheet-drag
      tabIndex={0}
      role="group"
      aria-label={`空を見上げた窓：${dirName(look.azimuth)}・高さ${Math.round(look.altitude)}°・${zoom.toFixed(1)}倍。なぞると向きが回り、2本指でつまむと拡大`}
      onPointerDown={(e) => {
        // 窓の上の − ＋ は押すだけ（つかまない：つかむと押した印がボタンに届かない）
        if ((e.target as Element).closest?.("button")) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        if (pinch.down(e)) {
          drag.current = null;
          return;
        }
        // なぞる量は拡大に合わせる（拡大すると細かく回る）
        drag.current = { x: e.clientX, y: e.clientY, az: look.azimuth, alt: look.altitude, k: PAN_FOV / zoom / (e.currentTarget.clientWidth || w) };
      }}
      onPointerMove={(e) => {
        if (pinch.move(e)) return;
        const d = drag.current;
        if (!d) return;
        onView({ azimuth: norm(d.az - (e.clientX - d.x) * d.k), altitude: clampAlt(d.alt + (e.clientY - d.y) * d.k) });
      }}
      onPointerUp={(e) => {
        pinch.up(e);
        drag.current = null;
      }}
      onPointerCancel={(e) => {
        pinch.up(e);
        drag.current = null;
      }}
      onKeyDown={(e) => {
        const st = 5 / zoom;
        const step = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
        if (e.key === "+" || e.key === "=") return onZoom(clampZoom(zoom * 1.5));
        if (e.key === "-") return onZoom(clampZoom(zoom / 1.5));
        if (!step) return;
        e.preventDefault();
        onView({ azimuth: norm(look.azimuth + step[0]), altitude: clampAlt(look.altitude + step[1]) });
      }}
    >
      <SkyWindow {...p} look={{ ...look, roll: 0 }} w={w} h={h} fov={PAN_FOV} pan full={full} zoom={zoom} onZoom={onZoom} />
    </div>
  );
}

/** 拡大の幅（倍）。 */
const ZOOM_MAX = 20;
const clampZoom = (z: number) => Math.max(1, Math.min(ZOOM_MAX, Math.round(z * 10) / 10));

/** 2本指でつまむ（11/19）：2本目が置かれたら、指の間の長さの比で拡大する。down・move は、つまんでいる間 true を返す。 */
function usePinch(zoom: number, onZoom: (z: number) => void) {
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ d: number; z: number } | null>(null);
  const dist = () => {
    const [a, b] = [...pts.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  return {
    down(e: PointerEvent) {
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.current.size === 2) start.current = { d: dist(), z: zoom };
      return pts.current.size >= 2;
    },
    move(e: PointerEvent) {
      if (!pts.current.has(e.pointerId)) return false;
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.current.size < 2 || !start.current) return false;
      onZoom(clampZoom(start.current.z * (dist() / start.current.d)));
      return true;
    },
    up(e: PointerEvent) {
      pts.current.delete(e.pointerId);
      if (pts.current.size < 2) start.current = null;
    },
  };
}

/**
 * 端末の向きで見る窓（センサー連動）：向けた方向を真ん中に、カメラと同じ見え方（透視）の空。地平線と高さの線、方位の名前、
 * 太陽と月の通り道と位置。窓の外にあるときは、その向きの端に矢印と名前（そちらを向くと見える）。
 * カメラ（AR 風、2026-11-19）を入れると、空の色の代わりに背面カメラの映像を下に敷く。
 */
const FOV = 60;
/** 空を見上げるの月：位置と、見かけの大きさ（直径°）・光っている側・模様の向き（どちらも天頂から反時計回り）・高さの色。 */
type SkyMoon = { altitude: number; azimuth: number; diameter?: number; limb?: number; north?: number; tint?: string };
/** 太陽の見かけの大きさ（直径°、年の平均）。 */
const SUN_DIAMETER = 0.533;
/** 背面カメラ（1倍）の長い辺の画角（°）：iPhone の広角（26mm 相当、4:3）でおよそ 67°。映像を窓に「覆う」で合わせる。 */
const CAMERA_LONG_FOV = 67;
type SkyProps = { look: { azimuth: number; altitude: number; roll?: number }; sunAlt: number; sunAz: number; moon: SkyMoon; phase: { age: number; illuminated: number }; sunTrack: { alt: number; az: number }[]; moonTrack: { alt: number; az: number }[]; sky: SkyColour };
/** 本物を押して直す：armed の間に窓を押すと、近い方の天体（地平線の上の太陽か月）との方位・高さの差を返す。 */
type SkyTap = { armed: boolean; onTap: (c: { dAz: number; dAlt: number; name: string }) => void };
function SkyWindow({ look, sunAlt, sunAz, moon, phase, sunTrack, moonTrack, sky, w, h, stream, full, tap, fov = FOV, pan, zoom = 1, onZoom }: SkyProps & { w: number; h: number; stream?: MediaStream | null; full?: boolean; tap?: SkyTap; fov?: number; pan?: boolean; zoom?: number; onZoom?: (z: number) => void }) {
  const pinch = usePinch(zoom, onZoom ?? (() => {}));
  const svgRef = useRef<SVGSVGElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.srcObject = stream ?? null;
    if (stream) void v.play().catch(() => {});
  }, [stream]);
  // 焦点（画面の px）：カメラのときは映像の長い辺の画角を、窓を覆う大きさに合わせる。無いときは横 60°。
  const focal = (() => {
    if (!stream) return (zoom * w) / 2 / Math.tan((fov / 2) * (Math.PI / 180));
    const vw = dims?.w ?? 3;
    const vh = dims?.h ?? 4;
    const scale = Math.max(w / vw, h / vh);
    // カメラの映像は、真ん中を拡大した分だけ大きく描く（デジタルの拡大）。
    return (zoom * scale * Math.max(vw, vh)) / 2 / Math.tan((CAMERA_LONG_FOV / 2) * (Math.PI / 180));
  })();
  const at = (az: number, alt: number) => project(look, { azimuth: az, altitude: alt }, focal, w, h);
  // 地平線（2026-11-19 ロール）：縦に固定した画面を横・斜めに持つと、地平線は画面の中で傾く。地平線の2点を通る線と、
  // その下側（地面）を画面の四角から切り出した形で描く。
  const hp1 = at(look.azimuth - 45, 0);
  const hp2 = at(look.azimuth + 45, 0);
  const hdx = hp2.x - hp1.x;
  const hdy = hp2.y - hp1.y;
  const hlen = Math.hypot(hdx, hdy) || 1;
  const tilt = (Math.atan2(hdy, hdx) * 180) / Math.PI;
  const below = at(look.azimuth, -20);
  const side = (x: number, y: number) => hdx * (y - hp1.y) - hdy * (x - hp1.x);
  const groundSign = Math.sign(side(below.x, below.y)) || 1;
  const ground = (() => {
    const box = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
    const out: number[][] = [];
    for (let i = 0; i < 4; i++) {
      const a = box[i];
      const b = box[(i + 1) % 4];
      const sa = side(a[0], a[1]) * groundSign;
      const sb = side(b[0], b[1]) * groundSign;
      if (sa >= 0) out.push(a);
      if (sa >= 0 !== sb >= 0) {
        const t = sa / (sa - sb);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out.length ? `M${out.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L")} Z` : "";
  })();
  const far = 3 * (w + h);
  const hx = (hdx / hlen) * far;
  const hy = (hdy / hlen) * far;
  const line = (pts: { alt: number; az: number }[], above = true) => {
    let d = "";
    let prev = false;
    for (const p of pts) {
      const q = at(p.az, p.alt);
      const ok = (!above || p.alt >= 0) && q.front && q.x > -w && q.x < 2 * w && q.y > -h && q.y < 2 * h;
      if (!ok) {
        prev = false;
        continue;
      }
      d += `${prev ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)} `;
      prev = true;
    }
    return d;
  };
  const ring = (alt: number) => line(Array.from({ length: 121 }, (_, i) => ({ alt, az: look.azimuth - 90 + i * 1.5 })), false);
  // 球の基準線（11/19 渡辺さん「球体の基準線が欲しい」）：高さの輪と方位の線（天頂へ集まる）。拡大するほど細かく。
  const gridStep = zoom >= 8 ? 5 : zoom >= 3 ? 10 : 15;
  const gridAlts = Array.from({ length: Math.floor(89 / gridStep) }, (_, i) => (i + 1) * gridStep);
  const gridAzs = Array.from({ length: 360 / gridStep }, (_, i) => i * gridStep).filter((az) => Math.abs(azDiff(az, look.azimuth)) <= 95);
  const meridian = (az: number) => line(Array.from({ length: 91 }, (_, i) => ({ alt: i, az })), false);
  const altLabel = (alt: number) => {
    const q = at(look.azimuth, alt);
    return q.front && q.y > 30 && q.y < h - 24 ? q : null;
  };
  const dirs = Array.from({ length: 16 }, (_, i) => i * 22.5).map((az) => ({ az, q: at(az, 0) })).filter(({ q }) => q.front && q.x > 0 && q.x < w && (Math.abs(tilt) < 20 || (q.y > -14 && q.y < h)));
  const edge = (az: number, alt: number, name: string) => {
    const q = at(az, alt);
    if (q.inside || alt < 0) return null;
    const ang = Math.atan2(-q.sy, q.sx);
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
  const together = !sun.inside && !mo.inside && sunAlt >= 0 && moon.altitude >= 0 && Math.abs(Math.atan2(-sun.sy, sun.sx) - Math.atan2(-mo.sy, mo.sx)) < 0.25;
  const big = full ? 1.6 : 1;
  // 見かけの大きさ（半径、画面の単位）：2·焦点·tan(直径/2) の半分。
  const radiusOf = (deg: number) => Math.max(1.5, focal * Math.tan((deg / 2) * (Math.PI / 180)));
  const sunR = radiusOf(SUN_DIAMETER);
  const moonR = radiusOf(moon.diameter ?? 0.518);
  // 月のところで、天頂の向きが画面の上から何度回っているか（反時計回り）。
  const upAt = (() => {
    const q = at(moon.azimuth, moon.altitude + 1);
    return (Math.atan2(-(q.x - mo.x), -(q.y - mo.y)) * 180) / Math.PI;
  })();
  return (
    <div
      className={`sky-stage${full ? " full" : ""}${stream ? " camera" : ""}`}
      style={full ? ON_SKY : { ...ON_SKY, aspectRatio: `${w} / ${h}` }}
      // 2本指でつまむと拡大（なぞって見る窓は SkyPan が受ける）
      onPointerDown={pan ? undefined : (e) => void pinch.down(e)}
      onPointerMove={pan ? undefined : (e) => void pinch.move(e)}
      onPointerUp={pan ? undefined : (e) => pinch.up(e)}
      onPointerCancel={pan ? undefined : (e) => pinch.up(e)}
      // パソコンのトラックパッドでつまむ（ctrl + ホイール）とき
      onWheel={onZoom ? (e) => e.ctrlKey && onZoom(clampZoom(zoom * Math.exp(-e.deltaY / 200))) : undefined}
    >
      {stream && <video ref={video} className="sky-video" style={zoom > 1 ? { transform: `scale(${zoom})` } : undefined} playsInline muted autoPlay onLoadedMetadata={(e) => setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })} />}
      <svg
        ref={svgRef}
        className={`sky-view ${pan ? "pan" : "window"}${tap?.armed ? " aiming" : ""}`}
        onPointerUp={(e) => {
          if (!tap?.armed || !svgRef.current) return;
          // 真ん中の＋で合わせる（11/19 渡辺さん）：押した場所ではなく窓の真ん中を使う（指のずれと画角のずれが入らない）。
          void e;
          const pt = { x: w / 2, y: h / 2 };
          const bodies = [
            sunAlt >= -1 ? { name: "太陽", azimuth: sunAz, altitude: sunAlt } : null,
            moon.altitude >= -1 ? { name: "月", azimuth: moon.azimuth, altitude: moon.altitude } : null,
          ].filter((b): b is { name: string; azimuth: number; altitude: number } => !!b);
          const near = bodies
            .map((b) => ({ b, p: at(b.azimuth, b.altitude) }))
            .filter((q) => q.p.front)
            .sort((a, c) => Math.hypot(a.p.x - pt.x, a.p.y - pt.y) - Math.hypot(c.p.x - pt.x, c.p.y - pt.y))[0];
          if (!near) return;
          const c = tapCorrection(look, pt, near.b, focal, w, h);
          tap.onTap({ ...c, name: near.b.name });
        }}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid slice"
        role="img" aria-label={`端末を向けた方向の空：${dirName(look.azimuth)}・高さ${Math.round(look.altitude)}°`}>
        <defs>
          <linearGradient id="sky-window-bg" x1="0" y1="0" x2="0" y2="1" gradientTransform={tilt ? `rotate(${tilt.toFixed(1)} 0.5 0.5)` : undefined}>
            <stop offset="0" stopColor={sky.zenith} />
            <stop offset="1" stopColor={sky.horizon} />
          </linearGradient>
        </defs>
        {!stream && <rect width={w} height={h} fill="url(#sky-window-bg)" />}
        {!stream && ground && <path d={ground} className="sky-ground" />}
        {gridAzs.map((az) => (
          <path key={`m${az}`} d={meridian(az)} className={az % 45 === 0 ? "sky-grid major" : "sky-grid"} />
        ))}
        {gridAlts.map((a) => (
          <path key={a} d={ring(a)} className={a % 30 === 0 ? "sky-alt" : "sky-grid"} />
        ))}
        {gridAlts.map((a) => {
          const q = altLabel(a);
          return q ? (
            <text key={`l${a}`} x={q.x + 4} y={q.y - 3} className="sun-tick sky-alt-label">
              {a}°
            </text>
          ) : null;
        })}
        <line x1={hp1.x - hx} y1={hp1.y - hy} x2={hp2.x + hx} y2={hp2.y + hy} className="sun-horizon" />
        {dirs.map(({ az, q }) => (
          <text key={az} transform={`translate(${q.x.toFixed(1)} ${(Math.abs(tilt) < 20 ? Math.min(h - 20, Math.max(full || pan ? 0 : 24, q.y)) : q.y).toFixed(1)}) rotate(${tilt.toFixed(1)})`} y={14} textAnchor="middle" className="sun-tick sky-dir">
            {dirName(az)}
          </text>
        ))}
        <path d={line(sunTrack)} className="sun-curve day" style={{ stroke: SKY_ICON.sun }} />
        <path d={line(moonTrack)} className="moon-curve" style={{ stroke: SKY_ICON.moon }} />
        {/* 本当の大きさ（11/19 レビュー）：見かけの直径 × 焦点。小さくて見つけにくいので、細い輪と名前を添える。 */}
        {sunAlt >= 0 && sun.inside && (
          <g className="sky-body">
            <circle cx={sun.x} cy={sun.y} r={sunR} style={{ fill: SKY_ICON.sun }} className="sky-sun" />
            <circle cx={sun.x} cy={sun.y} r={sunR + 7 * big} className="sky-body-ring" />
            <text x={sun.x} y={sun.y - sunR - 10 * big} textAnchor="middle" className="sun-tick sky-body-name">
              太陽
            </text>
          </g>
        )}
        {moon.altitude >= 0 && mo.inside && (
          <g className="sky-body">
            {/* 傾き：光っている側と模様の向きは天頂から測った角なので、画面の上と天頂の向きの差（ロール）を足す。 */}
            <g transform={`translate(${(mo.x - moonR).toFixed(1)} ${(mo.y - moonR).toFixed(1)})`}>
              <MoonGlyph phase={phase} size={moonR * 2} limb={moon.limb != null ? moon.limb + upAt : undefined} north={moon.north != null ? moon.north + upAt : undefined} tint={moon.tint} seen />
            </g>
            <circle cx={mo.x} cy={mo.y} r={moonR + 7 * big} className="sky-body-ring" />
            <text x={mo.x} y={mo.y - moonR - 10 * big} textAnchor="middle" className="sun-tick sky-body-name">
              月
            </text>
          </g>
        )}
        {tap?.armed && (
          <g className="sky-aim">
            <line x1={w / 2 - 16} x2={w / 2 + 16} y1={h / 2} y2={h / 2} />
            <line x1={w / 2} x2={w / 2} y1={h / 2 - 16} y2={h / 2 + 16} />
            <circle cx={w / 2} cy={h / 2} r={22} />
          </g>
        )}
        {/* 下を向いて地平線が窓より上にあるとき（11/19 IMG_2663）：何も無い面に見えないよう、地面だと書く。 */}
        {!stream && hp1.y < 0 && hp2.y < 0 && (
          <text x={w / 2} y={h / 2} textAnchor="middle" className="sun-tick sky-ground-note">
            地面の方を向いています（上へ向けると空）
          </text>
        )}
        {/* 太陽と月が同じ向きの外にあるとき（新月の前後）は、矢印を1つにまとめて名前を重ねない（11/19）。 */}
        {together ? edge(sunAz, sunAlt, "太陽と月") : edge(sunAz, sunAlt, "太陽")}
        {!together && edge(moon.azimuth, moon.altitude, "月")}
        {!full && (
          <text x={8} y={18} className="sun-tick sky-heading">
            {dirName(look.azimuth)} {Math.round(look.azimuth)}°・{look.altitude >= 0 ? `上へ ${Math.round(look.altitude)}°` : `下へ ${Math.round(-look.altitude)}°`}
          </text>
        )}
      </svg>
      {/* 倍率（11/19 渡辺さん「倍率のボタンは無くし、2本指で。画面にチップで倍率を」）。 */}
      {onZoom && (
        <span className="sky-mag" aria-live="polite">
          {zoom >= 10 ? Math.round(zoom) : zoom.toFixed(1)}倍
        </span>
      )}
    </div>
  );
}

/**
 * 全画面（2026-11-19）：端末の向きで見る空を画面いっぱいに。上に向いている方位と高さ・閉じる、下に時刻のつまみ・動かす・
 * カメラ・ずれの手直し。閉じると太陽と月のシートの同じ所に戻る。
 */
/** 横向きの全画面で、右に寄せる操作の欄の幅（px）。 */
const FULL_SIDE = 300;
function SkyFull({ sky, controls, onClose }: { sky: (w: number, h: number) => ReactNode; controls: ReactNode; onClose: () => void }) {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  // 横向き（11/19 渡辺さん「画面の横向きに対応できますか？」）：低い横長の画面では、操作を右の縦の欄に寄せ、空はその左に。
  // 真ん中の＋や拡大の真ん中が欄の下に隠れないよう、空の幅は欄を除いた分にする。
  const land = size.w > size.h && size.h < 520;
  const skyW = land ? size.w - FULL_SIDE : size.w;
  return createPortal(
    <div className={land ? "sky-full land" : "sky-full"} role="dialog" aria-modal="true" aria-label="空を見上げる（全画面）">
      <div className="sky-full-sky" style={land ? { right: FULL_SIDE } : undefined}>
        {sky(skyW, size.h)}
      </div>
      <div className="sky-full-top">
        <IconButton label="全画面を閉じる" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
      <div className="sky-full-bottom">{controls}</div>
    </div>,
    document.body,
  );
}
