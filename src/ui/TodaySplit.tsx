// 今日の1日モード：その日の値を「ここまで（観測）」と「このあと（予報）」に分けて見せる（2026-11-22 渡辺さん、案A）。
// 今日の時間は、過ぎた時間が観測、これからの時間が予報（authority.ts）。1日の最高・最低は日の行の値（表と同じ、src/todaySplit.ts withDay）。
// 2つの区切りの値と1行の言葉。線は24時間のグラフ1本に任せる（2026-11-24 渡辺さん「1日画面の重なり」：線が2本あった）。
// 出す値は帯で選んだ仲間のもの：気温は最高・最低、雨・風は降水・風。
import { hoursWeather } from "../../shared/dayWeather";
import type { WeatherRow } from "../../shared/types";
import { WeatherIcon } from "./WeatherIcon";

import { fig, restWord, splitToday, t1, withDay, type Shown, type SplitGroup } from "../todaySplit";


export function TodaySplit({
  rows,
  station,
  day,
  group,
  nextMin,
}: {
  rows: WeatherRow[] | null;
  station: string;
  day: { max: number | null; min: number | null };
  group: SplitGroup;
  /** 明日の最低（表と同じ書き方の文字。夜の冷え込みは明日の朝の最低で言う、2026-11-24 渡辺さん C） */
  nextMin: string | null;
}) {
  const raw = splitToday(rows);
  if (!raw) return null;
  // 値（ここまで／このあと・言葉）は日の値にそろえ、線は時間の値のまま。
  const s = withDay(raw, day);
  const cell = (p: Shown, kind: "obs" | "fc") => {
    const wx = hoursWeather(s.rows, p.hours, station).text;
    return (
      <div className={`ts-cell ${kind}`}>
        <p className="ts-cap">
          <span className={`ts-tag ${kind}`}>{kind === "obs" ? "観測" : "予報"}</span>
          <span className="ts-when">{kind === "obs" ? "ここまで" : "このあと"}</span>
          <small>
            {p.from}〜{p.to}時
          </small>
        </p>
        {wx && (
          <div className="ts-wx">
            <WeatherIcon text={wx} size={22} />
            <span>{wx}</span>
          </div>
        )}
        <dl className="ts-vals">
          {group === "temp" ? (
            <>
          <dt>最高</dt>
          <dd>
            <b className="tone-hot">{p.max ? fig(p.max) : "—"}</b>
            <small>{p.max?.n != null ? `${p.max.n}時` : ""}</small>
          </dd>
          <dt>最低</dt>
          <dd>
            <b className="tone-cold">{p.min ? fig(p.min) : "—"}</b>
            <small>{p.min?.n != null ? `${p.min.n}時` : ""}</small>
          </dd>
            </>
          ) : (
            <>
          <dt>降水</dt>
          <dd>
            <b className="tone-rain">{p.rain == null ? "—" : p.rain.toFixed(1)}</b>
            <small>mm</small>
          </dd>
          <dt>風</dt>
          <dd>
            <b className="tone-wind">{t1(p.wind?.v)}</b>
            <small>m/s{p.wind ? `・${p.wind.n}時` : ""}</small>
          </dd>
            </>
          )}
        </dl>
      </div>
    );
  };
  const word = restWord(s, group, nextMin);
  return (
    <section className="ts" aria-label="今日：ここまでの観測と、このあとの予報">
      <div className="ts-cells">
        {cell(s.obs, "obs")}
        {cell(s.fc, "fc")}
      </div>
      {word && <p className="ts-say">{word}</p>}
    </section>
  );
}
