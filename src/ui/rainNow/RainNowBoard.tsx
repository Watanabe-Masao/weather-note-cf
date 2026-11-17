// 雨の見込み（確認用）(research/rain-now, 2026-11-18 渡辺さん「A で進める」)：見本（research/rain-now/sample）の形を、
// 気象庁の本物のタイルで動かす。置き場所を決める前に、どのくらいの物が作れるかを確かめるための板で、管理者の
// 「研究用（テスト）」からだけ開く。アプリのほかの表示は変えない。
// - 地図：地点のまわりのタイル（段階 8〜10）。3時間前〜1時間先は5分ごとの強さ、その先15時間先までは1時間の量。
// - グラフ：地点の画素の色から読んだ段。上は強さ（5分ごと）、下は1時間の量（これまで解析雨量、これから今後の雨）。
// - 取れなかったこま・古いデータ・一覧が読めなかったことを、雨なしと分けて見せる。下に「取れ方」を出す（確認用）。
// - 現在地は押したときだけ端末に聞き、「＋」の印だけ出す（値は出さない。位置はサーバーに送らない）。
// 出典：気象庁ホームページ「雨雲の動き」「今後の雨」を加工して作成。
import { useEffect, useMemo, useState } from "react";
import { msOf, type RainFrame, RAIN_LEVELS, levelHex, rainPlace, type RainZoom } from "../../../shared/rainNow";
import { STATION_PLACES } from "../../../shared/stationPlaces";
import { Glyph, Segmented } from "../kit";
import { ModalSheet } from "../ModalSheet";
import { type Coast, prefetchFrame, RainNowMap } from "./RainNowMap";
import { RainNowGraph, type Span, SPANS } from "./RainNowGraph";
import { clockOf, clockOfName, frameKey, frameLabel, type Level, levelLabel, relLabel, SPEED_UP, STALE_AFTER, STEP_MS, strengthOf, useLevels, useRainNow } from "./rainNowData";
import "./rainNow.css";

let coastLoading: Promise<Coast | null> | null = null;
const loadCoast = () =>
  (coastLoading ??= fetch("/data/coast-japan.json")
    .then((r) => (r.ok ? (r.json() as Promise<Coast>) : null))
    .catch(() => null));

export function RainNowBoard({ station, onClose }: { station: string; onClose: () => void }) {
  const place = rainPlace(station);
  const name = STATION_PLACES[station]?.name ?? station;
  const [loaded, reload] = useRainNow(station);
  return (
    <ModalSheet title="雨の見込み（確認用）" onClose={onClose} className="rn-board">
      <div className="rn-page">
        {!place ? (
          <p className="rn-note">この地点の雨雲の場所はまだ決めていません（地点の表 shared/stationPlaces.ts）。</p>
        ) : loaded.s === "loading" ? (
          <p className="rn-note">気象庁の一覧を読んでいます…</p>
        ) : loaded.s === "failed" ? (
          <div className="rn-stale" role="status">
            <b>一覧が取れませんでした</b>
            <span>{loaded.message}。雨がないという意味ではありません。</span>
            <button type="button" className="rn-btn" onClick={reload}>
              読み直す
            </button>
          </div>
        ) : !loaded.data.now ? (
          <div className="rn-stale" role="status">
            <b>雨雲の動き（実況）の一覧が取れませんでした</b>
            <span>{loaded.data.lists.obs.error ?? "一覧が空でした"}。雨がないという意味ではありません。</span>
            <button type="button" className="rn-btn" onClick={reload}>
              読み直す
            </button>
          </div>
        ) : (
          <Board key={loaded.data.fetchedAt} data={loaded.data} place={{ ...place, name }} station={station} reload={reload} />
        )}
      </div>
    </ModalSheet>
  );
}

function Board({
  data,
  place,
  station,
  reload,
}: {
  data: NonNullable<Extract<ReturnType<typeof useRainNow>[0], { s: "ok" }>["data"]>;
  place: { name: string; lat: number; lon: number };
  station: string;
  reload: () => void;
}) {
  const now = data.now!;
  const frames = data.frames;
  const [m, setM] = useState(0);
  const [play, setPlay] = useState(false);
  const [zoom, setZoom] = useState<RainZoom>(8);
  const [span, setSpan] = useState<Span>("6");
  const [coast, setCoast] = useState<Coast | null>(null);
  const [here, setHere] = useState<{ lat: number; lon: number } | null>(null);
  const [hereNote, setHereNote] = useState<string | null>(null);
  useEffect(() => void loadCoast().then(setCoast), []);
  const all = useMemo(() => [...frames.filter((f) => f.kind !== "hourly"), ...data.hours], [frames, data.hours]);
  const levels = useLevels(station, all);
  const frame = frames.find((f) => f.m === m) ?? frames.find((f) => f.m === 0) ?? frames[0];
  const i = frames.indexOf(frame);
  const LAST = frames.at(-1)!.m;

  // 再生：今から先へ進み、いちばん先で今に戻って止まる。刻みに合わせて出す時間を変え、刻みが変わる所で一度止めて知らせる。
  const [note, setNote] = useState<string | null>(null);
  const startPlay = () => {
    if (play) return setPlay(false);
    if (m === LAST) setM(0);
    setPlay(true);
  };
  useEffect(() => {
    if (!play) return setNote(null);
    if (m === LAST) {
      setNote(`ここまで（${relLabel(frame)}）`);
      const t = window.setTimeout(() => (setPlay(false), setM(0)), 1400);
      return () => window.clearTimeout(t);
    }
    const next = frames[i + 1];
    const crossing = frame.kind !== "hourly" && next.kind === "hourly";
    setNote(crossing ? "ここから1時間ごと（今後の雨）" : frame.kind === "hourly" ? `1時間ごと・${SPEED_UP}倍速` : null);
    // 先の3こまを読んでおく
    for (const f of frames.slice(i + 1, i + 4)) prefetchFrame(place, f, zoom);
    const t = window.setTimeout(() => setM(next.m), crossing ? 1400 : frame.kind === "hourly" ? STEP_MS.hour : STEP_MS.five);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the frame follows m
  }, [play, m]);
  const go = (x: number) => {
    setPlay(false);
    setM(x);
    if (x > SPANS[span].to) setSpan(x > SPANS["12"].to ? "24" : "12");
  };
  const askHere = () => {
    if (!navigator.geolocation) return setHereNote("この端末では現在地を出せません");
    setHereNote("現在地を聞いています…");
    navigator.geolocation.getCurrentPosition(
      (p) => (setHere({ lat: p.coords.latitude, lon: p.coords.longitude }), setHereNote(null)),
      () => setHereNote("現在地は出せませんでした（許可されていないか、取れませんでした）"),
      { maximumAge: 300_000, timeout: 10_000 },
    );
  };

  // データの新しさ
  const clock = Date.now();
  const ageOf = (t: string | null) => (t ? Math.round((clock - msOf(t)) / 60_000) : null);
  const nowAge = ageOf(now);
  const hourly = data.lists.rasrf.latest;
  const hourlyAge = ageOf(hourly);
  const stale: string[] = [];
  if (nowAge != null && nowAge >= STALE_AFTER.nowcast) stale.push(`雨雲の動きは${clockOfName(now)}のまま（${nowAge}分前）`);
  if (hourly && hourlyAge != null && hourlyAge >= STALE_AFTER.hourly) stale.push(`今後の雨は${clockOfName(hourly)}発表のまま（${hourlyAge}分前）`);
  const listFailed = (["nowcast", "rasrf"] as const).filter((k) => !data.lists[k].ok || data.lists[k].count === 0);

  const fiveCount = frames.filter((f) => f.kind !== "hourly").length;
  const hourCount = frames.length - fiveCount;
  const isAmount = frame.kind === "hourly";
  return (
    <>
      {(stale.length > 0 || listFailed.length > 0) && (
        <p className="rn-stale" role="status">
          <b>新しいデータが取れていません</b>
          {stale.map((s) => (
            <span key={s}>{s}。</span>
          ))}
          {listFailed.map((k) => (
            <span key={k}>
              {k === "nowcast" ? "雨雲の動き（予測）" : "今後の雨"}の一覧が取れませんでした{data.lists[k].error ? `（${data.lists[k].error}）` : ""}。
            </span>
          ))}
        </p>
      )}
      <div className="rn-say">
        {aheadItems(now, frames, data.hours, levels).map((it) => (
          <div key={it.label} className="rn-say-item">
            <small>{it.label}</small>
            <b>{it.value}</b>
            {it.sub && <span>{it.sub}</span>}
          </div>
        ))}
      </div>
      <RainNowMap now={now} frame={frame} zoom={zoom} onZoom={setZoom} note={play ? note : null} place={place} here={here} coast={coast} />
      <input
        type="range"
        className="rn-scrub"
        min={0}
        max={frames.length - 1}
        value={i}
        onChange={(e) => go(frames[Number(e.target.value)].m)}
        aria-label="地図の時刻"
        aria-valuetext={`${frameLabel(now, frame)} ${relLabel(frame)}${isAmount ? " 1時間の量の予測" : frame.m > 0 ? " 予測" : " 実況"}`}
      />
      <div className="rn-scale">
        <span style={{ flex: Math.max(1, fiveCount - 1) }}>
          <i>{relLabel(frames[0])}</i>
          <i>今</i>
          <i>{relLabel(frames[fiveCount - 1])}</i>
        </span>
        {hourCount > 0 && (
          <span style={{ flex: hourCount }} className="hourly">
            <i>{`${frames.at(-1)!.m / 60}時間後`}</i>
          </span>
        )}
      </div>
      <div className="rn-ctl">
        <button type="button" className="rn-btn" aria-label="ひとつ前" onClick={() => go(frames[Math.max(0, i - 1)].m)}>
          <Glyph name="prev" size="12px" />
        </button>
        <button type="button" className={`rn-btn wide${play ? " on" : ""}`} aria-pressed={play} onClick={startPlay}>
          {play ? "停止" : "再生"}
        </button>
        <button type="button" className="rn-btn" aria-label="ひとつ先" onClick={() => go(frames[Math.min(frames.length - 1, i + 1)].m)}>
          <Glyph name="next" size="12px" />
        </button>
        <button type="button" className="rn-btn wide" onClick={() => go(0)}>
          今に戻る
        </button>
      </div>
      <div className="rn-legend" aria-label={`凡例：${isAmount ? "1時間の量（mm）" : "雨の強さ（mm/h）"}`}>
        <b className={`rn-legend-title${isAmount ? " amount" : ""}`} aria-live="polite">
          {isAmount ? "1時間の量（mm）" : "雨の強さ（mm/h）"}
        </b>
        {RAIN_LEVELS.map((l, k) => (
          <span key={l.label}>
            <i style={{ background: levelHex(k) }} />
            {k === 0 ? "<1" : l.from}
          </span>
        ))}
        <button type="button" className="rn-here" onClick={askHere}>
          ＋ 現在地{here ? "（出しています）" : "を出す"}
        </button>
        {hereNote && <span className="rn-here-note">{hereNote}</span>}
      </div>
      <div className="rn-span">
        <Segmented
          label="グラフの幅"
          value={span}
          onChange={setSpan}
          options={[
            { id: "6", label: "6時間" },
            { id: "12", label: "12時間" },
            { id: "24", label: "24時間" },
          ]}
        />
      </div>
      <RainNowGraph now={now} m={frame.m} span={span} onPick={go} frames={frames} hours={data.hours} levels={levels} />
      <p className="rn-issued">
        <span>雨雲の動き {clockOfName(now)}</span>
        {data.lists.nowcast.latest && <span>予測 {clockOfName(data.lists.nowcast.latest)}発表</span>}
        {hourly && <span>今後の雨 {clockOfName(hourly)}発表</span>}
      </p>
      <p className="rn-note">地点の値は画像の色から読んだ段です（10〜20mm/h のように幅で）。グラフの縦は段の目盛りで、等間隔ではありません。</p>
      <details className="rn-diag">
        <summary>取れ方（確認用）</summary>
        <Diag data={data} levels={levels} expected={all} reload={reload} />
      </details>
      <p className="rn-credit">出典：気象庁ホームページ「雨雲の動き」「今後の雨」を加工して作成。海岸線：Natural Earth。</p>
    </>
  );
}

function Diag({ data, levels, expected, reload }: { data: { lists: Record<"obs" | "nowcast" | "rasrf", { ok: boolean; count: number; latest: string | null; error?: string }>; fetchedAt: string }; levels: Map<string, Level>; expected: RainFrame[]; reload: () => void }) {
  const names = { obs: "雨雲の動き（実況）", nowcast: "雨雲の動き（予測）", rasrf: "今後の雨" } as const;
  const got = expected.map((f) => levels.get(frameKey(f)));
  const count = (p: (l: Level | undefined) => boolean) => got.filter(p).length;
  return (
    <div className="rn-diag-body">
      <table>
        <tbody>
          {(Object.keys(names) as (keyof typeof names)[]).map((k) => {
            const l = data.lists[k];
            return (
              <tr key={k}>
                <th scope="row">{names[k]}</th>
                <td>{l.ok ? `${l.count}こま` : `取れなかった（${l.error ?? "不明"}）`}</td>
                <td>{l.latest ? `${clockOfName(l.latest)}発表` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        地点の値：{expected.length}こまのうち 読めた {count((l) => typeof l === "number")}・取れなかった {count((l) => l === "missing")}・色が読めない {count((l) => l === "unread")}・読み込み中{" "}
        {count((l) => l === undefined)}
      </p>
      <p>
        一覧を読んだ時刻：{new Date(data.fetchedAt).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" })}{" "}
        <button type="button" className="rn-btn small" onClick={reload}>
          読み直す
        </button>
      </p>
    </div>
  );
}

/** この先の言葉：今／降りはじめ・いちばん強い・やむ／その後・この先15時間。段で言う（値そのものは画像から読めない）。 */
function aheadItems(now: string, frames: RainFrame[], hours: RainFrame[], levels: Map<string, Level>): { label: string; value: string; sub?: string }[] {
  const lv = (f: RainFrame | undefined) => (f ? levels.get(frameKey(f)) : undefined);
  const cur = frames.find((f) => f.m === 0);
  const ahead = frames.filter((f) => f.kind === "nowcast");
  const ls = ahead.map((f) => ({ f, l: lv(f) }));
  const out: { label: string; value: string; sub?: string }[] = [];
  if (lv(cur) === undefined || ls.some((x) => x.l === undefined)) return [{ label: "この先1時間", value: "読み込み中…" }];
  const curL = lv(cur);
  const lost = ls.filter((x) => typeof x.l !== "number").length;
  if (!ahead.length) out.push({ label: "この先1時間", value: "取れなかった", sub: "予測の一覧がありません" });
  else {
    const rain = ls.filter((x): x is { f: RainFrame; l: number } => typeof x.l === "number" && x.l >= 0);
    if (typeof curL === "number" && curL >= 0) out.push({ label: "今", value: strengthOf(curL), sub: `${levelLabel(curL)}mm/h` });
    else if (typeof curL !== "number") out.push({ label: "今", value: "取れなかった" });
    else if (rain[0]) out.push({ label: "降りはじめ", value: `${clockOf(now, rain[0].f.m)}ごろ`, sub: `${rain[0].f.m}分後` });
    else out.push({ label: "この先1時間", value: lost ? "雨の予測なし（一部取れず）" : "雨の予測なし" });
    if (rain.length) {
      const peak = rain.reduce((a, b) => (b.l > a.l ? b : a));
      out.push({ label: "いちばん強い", value: `${clockOf(now, peak.f.m)}ごろ`, sub: `${levelLabel(peak.l)}mm/h・${strengthOf(peak.l)}` });
      const stop = ls.find((x, k) => k > 0 && x.l === -1 && typeof ls[k - 1].l === "number" && (ls[k - 1].l as number) >= 0);
      out.push(stop ? { label: "やむ", value: `${clockOf(now, stop.f.m)}ごろ`, sub: `${stop.f.m}分後` } : { label: "その後", value: `${clockOf(now, ahead.at(-1)!.m)}以降も`, sub: "降り続く見込み" });
    }
    if (lost) out.push({ label: "この先1時間", value: `${lost}こま取れなかった` });
  }
  // この先15時間（今後の雨）：雨の時間の数と、いちばん多い1時間（段で）
  const next = hours.filter((f) => f.m > 0).map((f) => ({ f, l: lv(f) }));
  if (!next.length) out.push({ label: "この先15時間", value: "取れなかった", sub: "今後の雨の一覧がありません" });
  else if (next.some((x) => x.l === undefined)) out.push({ label: "この先15時間", value: "読み込み中…" });
  else {
    const ok = next.filter((x): x is { f: RainFrame; l: number } => typeof x.l === "number");
    const missed = next.length - ok.length;
    const rainy = ok.filter((x) => x.l >= 0);
    const most = rainy.reduce<{ f: RainFrame; l: number } | null>((a, b) => (a == null || b.l > a.l ? b : a), null);
    out.push(
      rainy.length
        ? { label: "この先15時間", value: `雨は${rainy.length}時間${missed ? "以上" : ""}`, sub: missed ? `${missed}時間分は取れなかった` : `多いのは${clockOf(now, most!.f.m - 60)}〜 ${levelLabel(most!.l)}mm` }
        : { label: "この先15時間", value: missed ? "雨の予測なし（一部取れず）" : "雨の予測なし", sub: missed ? `${missed}時間分は取れなかった` : undefined },
    );
  }
  return out;
}
