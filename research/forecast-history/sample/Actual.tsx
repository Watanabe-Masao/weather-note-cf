// 予報の履歴 R6 の見本：対象日の「実績」（気象庁 過去の気象データ、高知 47893）。上の予報と同じ形で並べ、
// 予報と見比べられるようにする（天気の絵・最高／最低・時間帯ごとの天気と降水量）。
// データは research/actuals（GitHub Actions で取得）から作った actuals.json。出典：気象庁ホームページ。

import { WeatherIcon } from "../../../src/ui/WeatherIcon";
import { md } from "./model";

export interface ActualDay {
  precip: number | null;
  max: number | null;
  min: number | null;
  wxDay: string | null;
  wxNight: string | null;
  hours: {
    h: number;
    precip: number | null;
    temp: number | null;
    wx: string | null;
  }[];
}

const fmt = (v: number | null | undefined) =>
  v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1);

export function ActualBlock({
  day,
  a,
}: {
  day: string;
  a: ActualDay | null | undefined;
}) {
  const names = ["00-06", "06-12", "12-18", "18-24"];
  const hourly = a?.hours ?? [];
  const done = hourly.length >= 24; // その日が終わっている（観測が24時までそろっている）
  return (
    <div className="fh-issue fh-actual-block">
      <div className="dd-hero">
        <span className="dd-pic">
          {a?.wxDay ? (
            <WeatherIcon text={a.wxDay} size={44} />
          ) : (
            <span className="fh-focus-nopic" />
          )}
        </span>
        {a && done ? (
          <span className="dd-temps">
            <span className="tone-hot">{fmt(a.max)}</span>
            <span className="dd-slash">/</span>
            <span className="tone-cold">{fmt(a.min)}</span>
            <small>℃</small>
          </span>
        ) : (
          <span className="dd-temps" />
        )}
        <span className="dd-kind">
          <span className="fh-kchip actual">実績</span>
          {md(day)}
          {!done && (
            <span className="fh-lead">
              {hourly.length ? `${hourly[hourly.length - 1].h}時まで` : "まだ"}
            </span>
          )}
        </span>
      </div>
      <div className="fh-ptab">
        {names.map((n) => (
          <span key={n} className="h">
            {n}
          </span>
        ))}
        {[0, 1, 2, 3].map((c) => (
          <span key={`w${c}`} className="w">
            {[c * 6 + 3, c * 6 + 6].map((h, k) => {
              const t = hourly.find((x) => x.h === h)?.wx ?? null;
              return t ? (
                <WeatherIcon
                  key={k}
                  text={t}
                  size={20}
                  night={h <= 6 || h > 18}
                />
              ) : (
                <span key={k} className="w-none" />
              );
            })}
          </span>
        ))}
        {[0, 1, 2, 3].map((c) => {
          const hs = hourly.filter((x) => x.h > c * 6 && x.h <= c * 6 + 6);
          const full = hs.length === 6;
          const sum = hs.reduce((t, x) => t + (x.precip ?? 0), 0);
          return (
            <span
              key={`p${c}`}
              className={`v${full ? "" : " past"}${full && sum > 0 ? " ch" : ""}`}
            >
              {full ? `${fmt(Math.round(sum * 10) / 10)}mm` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
