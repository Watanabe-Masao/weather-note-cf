// 台風の詳細 (#220): one typhoon at the station, opened from その日の要約 on a typhoon day. A map of its
// own (the coast from Natural Earth, drawn here in km around the station) with three ways to look:
//  実際       the track (the best track, or the telegrams kept until it has the typhoon) and, at a
//             chosen hour, JMA's 強風域 and 暴風域 as JMA draws them;
//  当時の予報 each announcement kept (from 2026-11), its forecast as JMA gave it — the line, the
//             予報円 and the 暴風警戒域 — never moved or filled in (気象業務法 第17条);
//  今         JMA's information now, as the typhoon card reads it.
// Under the map, the station's own line: for each announcement, the hours its 暴風警戒域 held the
// station, and at the end what happened. Anything not read is said, never drawn as nothing.
// 出典：気象庁（ベストトラック／防災情報XML／台風情報）、地図：Natural Earth。判定は Weather Note。

import { useEffect, useMemo, useRef, useState } from "react";
import stations from "../../shared/stations.json";
import { stationLatLon } from "../../shared/sunTimes";
import { type Storm } from "../../shared/typhoon";
import type { TyphoonNow } from "../../shared/typhoonForecast";
import {
  type Announcement,
  announcementLines,
  type Coast,
  coastPath,
  drawnCircle,
  keyHours,
  projection,
  stormHours,
  type StormHour,
} from "../../shared/typhoonMap";
import { useTyphoonRecord } from "../data/typhoon";
import type { TyphoonInfo } from "../data/typhoonNow";
import { TYPE_SIZE } from "../design/tokens";
import { Glyph, Segmented } from "./kit";
import { ModalSheet } from "./ModalSheet";

const H = 3_600_000;
const jst = (t: number) => new Date(t + 9 * H);
const md = (t: number) => `${jst(t).getUTCMonth() + 1}/${jst(t).getUTCDate()}`;
const mdh = (t: number) => `${md(t)} ${jst(t).getUTCHours()}時`;
const dayStart = (t: number) =>
  Math.floor((t + 9 * H) / (24 * H)) * 24 * H - 9 * H;

// ---- what is read once and kept for the session ----------------------------------------------------
let coastLoading: Promise<Coast | null> | null = null;
const loadCoast = () =>
  (coastLoading ??= fetch("/data/coast-japan.json")
    .then((r) => (r.ok ? (r.json() as Promise<Coast>) : null))
    .catch(() => null));

type Loaded<T> =
  { state: "loading" } | { state: "ok"; value: T } | { state: "failed" };
function useLoaded<T>(
  load: (() => Promise<T | null>) | null,
  key: string,
): Loaded<T> {
  const [v, setV] = useState<Loaded<T>>({ state: "loading" });
  useEffect(() => {
    if (!load) return;
    let live = true;
    setV({ state: "loading" });
    load().then(
      (x) =>
        live &&
        setV(x == null ? { state: "failed" } : { state: "ok", value: x }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names what is loaded
  }, [key]);
  return v;
}
const telegramsOf = new Map<string, Promise<Announcement[] | null>>();
function loadTelegrams(number: string) {
  if (!telegramsOf.has(number))
    telegramsOf.set(
      number,
      fetch(`/api/typhoon-telegrams?number=${number}`)
        .then((r) =>
          r.ok
            ? (r.json() as Promise<{ announcements: Announcement[] }>)
            : null,
        )
        .then((j) => j?.announcements ?? null)
        .catch(() => null),
    );
  return telegramsOf.get(number)!;
}

type View = "real" | "then" | "now";
const HALF = 900; // km from the station to the map's edge, at the start

export function TyphoonSheet({
  station,
  date,
  number,
  info,
  onClose,
}: {
  station: string;
  date: string;
  number: number;
  info: TyphoonInfo;
  onClose: () => void;
}) {
  const at = stationLatLon(station);
  const name =
    (stations as { blockNo: string; name: string }[]).find(
      (s) => s.blockNo === station,
    )?.name ?? "観測点";
  const record = useTyphoonRecord();
  const year = Number(date.slice(0, 4));
  const storm: Storm | null =
    typeof record === "object"
      ? (record.storms.find((s) => s.year === year && s.number === number) ??
        record.storms.find((s) => s.year === year - 1 && s.number === number) ??
        null)
      : null;
  const yyNN = `${String((storm?.year ?? year) % 100).padStart(2, "0")}${String(number).padStart(2, "0")}`;
  const coast = useLoaded(loadCoast, "coast");
  const tele = useLoaded(year >= 2026 ? () => loadTelegrams(yyNN) : null, yyNN);
  const now: TyphoonNow | null =
    info.typhoons.find(
      (t) =>
        t.number === number &&
        Number(t.issued.slice(0, 4)) === (storm?.year ?? year),
    ) ?? null;

  const hours = useMemo(
    () => (storm && at ? stormHours(storm, at.lat, at.lon) : []),
    [storm, at?.lat, at?.lon],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = useMemo(() => keyHours(hours), [hours]);
  const lines = useMemo(
    () =>
      tele.state === "ok" && at
        ? announcementLines(tele.value, at.lat, at.lon)
        : [],
    [tele, at?.lat, at?.lon],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const [view, setView] = useState<View>("real");
  const [pick, setPick] = useState<number | null>(null);
  const [ann, setAnn] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  // The width the map is drawn at, so a label is a given size on screen (sw below).
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapPx, setMapPx] = useState(0);
  const hasMap = at != null;
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    setMapPx(el.clientWidth);
    const ro = new ResizeObserver(() => setMapPx(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasMap]);
  const chosenKey =
    pick ?? keys.find((k) => k.why === "いちばん近い")?.t ?? keys[0]?.t ?? null;
  const hour = hours.find((h) => h.t === chosenKey) ?? null;
  const chosenAnn = lines.length ? lines[ann ?? lines.length - 1] : null;

  if (!at) return null;
  const project = projection(at.lat, at.lon);
  const half = HALF / zoom;
  const box = { x: -half, y: -half * 1.05, w: half * 2, h: half * 2.1 };
  const px = (lat: number, lon: number) => project(lat, lon);
  // n screen px in the map's own units, by the width the map is drawn at (measured; 360 until it is). The
  // labels are the type scale's xs on screen: assuming 360 drew them at about 10px on a 360-wide phone.
  const sw = (n: number) => (n * box.w) / (mapPx || 360);

  // The station's days with the typhoon (within 500 km), for the band's axis.
  const near = hours.filter((h) => h.km <= 500 || h.level > 0);
  const from = near.length ? dayStart(near[0].t) : null;
  const to = near.length ? dayStart(near[near.length - 1].t) + 24 * H : null;
  const nearest = hours.length
    ? hours.reduce((a, b) => (b.km < a.km ? b : a))
    : null;
  const maxLevel = hours.reduce((m, h) => Math.max(m, h.level), 0);

  const sub = !storm
    ? record === "loading"
      ? "進路を読み込み中…"
      : "この台風の進路はまだ記録に入っていません。"
    : `${name}は${maxLevel === 2 ? "暴風域" : maxLevel === 1 ? "強風域" : "域の外"}${nearest ? `（いちばん近く ${nearest.km.toFixed(0)}km${nearest.pressure ? `・${nearest.pressure.toFixed(0)}hPa` : ""}）` : ""}`;

  return (
    <ModalSheet
      title={`台風${number}号${storm?.name ? `（${storm.name}）` : ""}`}
      label={`台風${number}号の詳細`}
      onClose={onClose}
      className="typhoon-sheet"
    >
      <p className="ty-sub">
        {storm ? `${storm.year}年・` : ""}
        {sub}
      </p>
      <Segmented<View>
        label="見るもの"
        value={view}
        onChange={setView}
        options={[
          { id: "real", label: "実際" },
          { id: "then", label: "当時の予報" },
          { id: "now", label: "今" },
        ]}
      />
      <div className="ty-map" ref={mapRef}>
        <svg
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          role="img"
          aria-label={`台風${number}号の進路と${name}`}
        >
          {coast.state === "ok" && (
            <path
              className="ty-land"
              d={coastPath(coast.value, project, box)}
              strokeWidth={sw(0.6)}
            />
          )}
          {view === "real" && (
            <RealLayer hours={hours} hour={hour} px={px} sw={sw} />
          )}
          {view === "then" && chosenAnn && (
            <ForecastLayer a={chosenAnn.a} hours={hours} px={px} sw={sw} />
          )}
          {view === "now" && now && <NowLayer t={now} px={px} sw={sw} />}
          {hours
            .filter((h) => jst(h.t).getUTCHours() === 9)
            .map((h) => {
              const [x, y] = px(h.lat, h.lon);
              return (
                <g
                  key={h.t}
                  className={view === "real" ? "ty-tick" : "ty-tick quiet"}
                >
                  <circle cx={x} cy={y} r={sw(2.5)} />
                  <text x={x + sw(7)} y={y + sw(4)} fontSize={sw(TYPE_SIZE.xs)}>
                    {md(h.t)} 9時
                  </text>
                </g>
              );
            })}
          <circle
            className="ty-station"
            cx={0}
            cy={0}
            r={sw(4.5)}
            strokeWidth={sw(1.5)}
          />
          <text
            className="ty-station-name"
            x={-sw(8)}
            y={sw(4)}
            fontSize={sw(TYPE_SIZE.xs)}
            textAnchor="end"
          >
            {name}
          </text>
        </svg>
        <div className="ty-zoom">
          <button
            aria-label="拡大"
            onClick={() => setZoom((z) => Math.min(4, z * 1.5))}
          >
            <Glyph name="plus" size="14px" />
          </button>
          <button
            aria-label="縮小"
            onClick={() => setZoom((z) => Math.max(0.67, z / 1.5))}
          >
            <Glyph name="minus" size="14px" />
          </button>
        </div>
        {coast.state === "failed" && (
          <p className="ty-map-note">海岸線を読み込めませんでした。</p>
        )}
      </div>
      <Legend view={view} />

      {view === "real" && keys.length > 0 && (
        <div className="ty-chips" role="group" aria-label="時刻">
          {keys.map((k) => (
            <button
              key={k.t}
              aria-pressed={k.t === chosenKey}
              onClick={() => setPick(k.t)}
            >
              {mdh(k.t)}
              <small>{k.why}</small>
            </button>
          ))}
        </div>
      )}
      {view === "then" && lines.length > 0 && (
        <div className="ty-chips" role="group" aria-label="発表">
          {lines.map((l, i) => (
            <button
              key={l.a.issuedAt}
              aria-pressed={l === chosenAnn}
              onClick={() => setAnn(i)}
            >
              {mdh(Date.parse(l.a.issuedAt))}
              <small>発表</small>
            </button>
          ))}
        </div>
      )}
      <p className="ty-say">
        {view === "real" &&
          (hour ? (
            <>
              <b>{mdh(hour.t)}</b>：中心は{name}から約{hour.km.toFixed(0)}km
              {hour.pressure ? `、${hour.pressure.toFixed(0)}hPa` : ""}。{name}
              は
              <strong className={hour.level ? "in" : undefined}>
                {hour.level === 2
                  ? "暴風域の中"
                  : hour.level === 1
                    ? "強風域の中"
                    : "域の外"}
              </strong>
              。
            </>
          ) : storm ? (
            "この台風の進路には、強風域・暴風域の大きさがありません。"
          ) : (
            sub
          ))}
        {view === "then" &&
          (year < 2026 || (tele.state === "ok" && !tele.value.length)
            ? "この台風の当時の発表は残っていません（残し始めたのは 2026年11月から）。"
            : tele.state === "loading"
              ? "当時の発表を読み込み中…"
              : tele.state === "failed"
                ? "当時の発表を読み込めませんでした。"
                : chosenAnn && (
                    <>
                      <b>{mdh(Date.parse(chosenAnn.a.issuedAt))}の発表</b>：
                      {name}は
                      {chosenAnn.hours.length ? (
                        <strong className="in">
                          {mdh(chosenAnn.hours[0])}〜
                          {mdh(chosenAnn.hours[chosenAnn.hours.length - 1] + H)}
                          に暴風警戒域
                        </strong>
                      ) : (
                        "暴風警戒域の外"
                      )}
                      {chosenAnn.level
                        ? `（このとき${chosenAnn.level === 2 ? "暴風域" : "強風域"}の中）`
                        : ""}
                      。
                    </>
                  ))}
        {view === "now" &&
          (now
            ? `${now.issued ? `${mdh(Date.parse(now.issued))}の発表` : "今の発表"}：中心は${now.at.location ?? "—"}、${now.pressure ?? "—"}hPa。`
            : info.state === "failed"
              ? "今の台風情報を取得できませんでした。"
              : info.state === "loading"
                ? "今の台風情報を読み込み中…"
                : "この台風について、気象庁の今の発表はありません。")}
      </p>

      {from != null && to != null && (
        <>
          <h4 className="ty-band-title">
            {name}にとって（
            {md(from) === md(to - H) ? md(from) : `${md(from)}〜${md(to - H)}`}
            ）
          </h4>
          <div className="ty-rows">
            {year >= 2026 && tele.state === "ok" && lines.length ? (
              lines.map((l) => (
                <div className="ty-row" key={l.a.issuedAt}>
                  <time>{mdh(Date.parse(l.a.issuedAt))}</time>
                  <div>
                    {l.hours.length
                      ? `${mdh(l.hours[0])}〜${mdh(l.hours[l.hours.length - 1] + H)} 暴風警戒域`
                      : "暴風警戒域の外"}
                    <Band
                      from={from}
                      to={to}
                      marks={l.hours.map((t) => ({ t, k: "w" as const }))}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="ty-row none">
                <time>当時の発表</time>
                <div>
                  {year < 2026 || tele.state === "ok"
                    ? "残っていません（2026年11月以降の台風から）"
                    : tele.state === "loading"
                      ? "読み込み中…"
                      : "読み込めませんでした"}
                </div>
              </div>
            )}
            <div className="ty-row real">
              <time>実際</time>
              <div>
                {inWords(hours)}
                <Band
                  from={from}
                  to={to}
                  marks={hours
                    .filter((h) => h.level > 0)
                    .map((h) => ({
                      t: h.t,
                      k: h.level === 2 ? ("s" as const) : ("g" as const),
                    }))}
                />
              </div>
            </div>
          </div>
        </>
      )}
      <p className="ty-source">
        出典：気象庁（
        {view === "now"
          ? "台風情報"
          : "ベストトラック／当時の発表＝防災情報XML"}
        ）。予報は気象庁の発表のまま重ねています。{name}が域に入ったかは Weather
        Note の判定。地図：Natural Earth。
      </p>
    </ModalSheet>
  );
}

function inWords(hours: StormHour[]): string {
  const g = hours.filter((h) => h.level > 0);
  if (!g.length) return "強風域・暴風域には入らなかった";
  const s = hours.filter((h) => h.level === 2);
  return `${mdh(g[0].t)}〜${mdh(g[g.length - 1].t + H)} 強風域${s.length ? `、${mdh(s[0].t)}〜${mdh(s[s.length - 1].t + H)} 暴風域` : ""}`;
}

type Px = (lat: number, lon: number) => [number, number];

function RealLayer({
  hours,
  hour,
  px,
  sw,
}: {
  hours: StormHour[];
  hour: StormHour | null;
  px: Px;
  sw: (n: number) => number;
}) {
  const line = hours.map((h) => px(h.lat, h.lon).join(",")).join(" ");
  const c = (
    x: { lat: number; lon: number; km: number } | null,
    cls: string,
  ) => {
    if (!x) return null;
    const [cx, cy] = px(x.lat, x.lon);
    return (
      <circle className={cls} cx={cx} cy={cy} r={x.km} strokeWidth={sw(1.4)} />
    );
  };
  return (
    <g>
      {hour && c(hour.gale, "ty-gale")}
      {hour && c(hour.storm, "ty-storm")}
      <polyline className="ty-track" points={line} strokeWidth={sw(2)} />
      {hour && (
        <circle
          className="ty-centre"
          cx={px(hour.lat, hour.lon)[0]}
          cy={px(hour.lat, hour.lon)[1]}
          r={sw(5)}
          strokeWidth={sw(2)}
        />
      )}
    </g>
  );
}

function ForecastLayer({
  a,
  hours,
  px,
  sw,
}: {
  a: Announcement;
  hours: StormHour[];
  px: Px;
  sw: (n: number) => number;
}) {
  const times = a.times.filter((x) => x.lat != null && x.lon != null);
  const now = times.find((x) => x.hours === 0);
  const ahead = times.filter((x) => x.hours > 0);
  const circle = (
    c: ReturnType<typeof drawnCircle>,
    cls: string,
    key: string,
  ) => {
    if (!c) return null;
    const [cx, cy] = px(c.lat, c.lon);
    return (
      <circle
        key={key}
        className={cls}
        cx={cx}
        cy={cy}
        r={c.km}
        strokeWidth={sw(1)}
        strokeDasharray={`${sw(3)} ${sw(3)}`}
      />
    );
  };
  return (
    <g>
      <polyline
        className="ty-track quiet"
        points={hours.map((h) => px(h.lat, h.lon).join(",")).join(" ")}
        strokeWidth={sw(1.5)}
      />
      {ahead.map((x) =>
        circle(drawnCircle(x.warning), "ty-warning", `w${x.validAt}`),
      )}
      {ahead.map((x) =>
        circle(drawnCircle(x.probability), "ty-prob", `p${x.validAt}`),
      )}
      {now && circle(drawnCircle(now.gale), "ty-gale thin", "g")}
      <polyline
        className="ty-forecast"
        points={times.map((x) => px(x.lat!, x.lon!).join(",")).join(" ")}
        strokeWidth={sw(1.6)}
        strokeDasharray={`${sw(5)} ${sw(4)}`}
      />
      {now && (
        <circle
          className="ty-centre at"
          cx={px(now.lat!, now.lon!)[0]}
          cy={px(now.lat!, now.lon!)[1]}
          r={sw(5)}
          strokeWidth={sw(2)}
        />
      )}
    </g>
  );
}

function NowLayer({
  t,
  px,
  sw,
}: {
  t: TyphoonNow;
  px: Px;
  sw: (n: number) => number;
}) {
  const c = (
    x: { lat: number; lon: number; km: number } | null,
    cls: string,
    key: string,
  ) => {
    if (!x) return null;
    const [cx, cy] = px(x.lat, x.lon);
    return (
      <circle
        key={key}
        className={cls}
        cx={cx}
        cy={cy}
        r={x.km}
        strokeWidth={sw(1.2)}
      />
    );
  };
  const centres = [
    [t.at.lat, t.at.lon] as [number, number],
    ...t.ahead.filter((a) => a.center).map((a) => a.center!),
  ];
  return (
    <g>
      {t.warning.map((w, i) => {
        const [cx, cy] = px(w.lat, w.lon);
        return (
          <circle
            key={`w${i}`}
            className="ty-warning"
            cx={cx}
            cy={cy}
            r={w.km}
            strokeWidth={sw(1)}
            strokeDasharray={`${sw(3)} ${sw(3)}`}
          />
        );
      })}
      {c(t.gale, "ty-gale", "g")}
      {c(t.storm, "ty-storm", "s")}
      <polyline
        className="ty-forecast"
        points={centres.map(([la, lo]) => px(la, lo).join(",")).join(" ")}
        strokeWidth={sw(1.6)}
        strokeDasharray={`${sw(5)} ${sw(4)}`}
      />
      <circle
        className="ty-centre"
        cx={px(t.at.lat, t.at.lon)[0]}
        cy={px(t.at.lat, t.at.lon)[1]}
        r={sw(5)}
        strokeWidth={sw(2)}
      />
    </g>
  );
}

function Legend({ view }: { view: View }) {
  return (
    <p className="ty-legend">
      {view === "real" && (
        <>
          <span>
            <i className="tr" />
            進路
          </span>
          <span>
            <i className="g" />
            強風域
          </span>
          <span>
            <i className="s" />
            暴風域
          </span>
        </>
      )}
      {view !== "real" && (
        <>
          <span>
            <i className="fc" />
            予報の進路
          </span>
          <span>
            <i className="p" />
            予報円
          </span>
          <span>
            <i className="w" />
            暴風警戒域
          </span>
        </>
      )}
    </p>
  );
}

/** One line over the station's days: w = 暴風警戒域 (forecast), g = 強風域, s = 暴風域, by the hour. */
function Band({
  from,
  to,
  marks,
}: {
  from: number;
  to: number;
  marks: { t: number; k: "w" | "g" | "s" }[];
}) {
  const span = to - from;
  const days: number[] = [];
  for (let t = from; t <= to; t += 24 * H) days.push(t);
  return (
    <>
      <div className="ty-bar" aria-hidden>
        {marks
          .filter((m) => m.t >= from && m.t < to)
          .map((m) => (
            <span
              key={m.t}
              className={m.k}
              style={{
                left: `${((m.t - from) / span) * 100}%`,
                width: `${(H / span) * 100 + 0.2}%`,
              }}
            />
          ))}
      </div>
      <div className="ty-axis" aria-hidden>
        {days.map((t) => (
          <span key={t}>{md(t)}</span>
        ))}
      </div>
    </>
  );
}
