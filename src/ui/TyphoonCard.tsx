// 近づいている台風 (#220): a card at the top while a typhoon concerns the station — inside its 強風域
// or 暴風域 now, inside its 暴風警戒域 ahead, or its centre within 1000 km. Everything on it is JMA's
// as JMA gives it (shared/typhoonForecast.ts): where the centre is, its pressure and wind, and which
// of JMA's areas holds the station. Nothing is forecast here. From it, the past typhoon days can be
// set beside today (条件から選ぶ, 台風の日).

import stations from "../../shared/stations.json";
import { stationLatLon } from "../../shared/sunTimes";
import { stationOnTyphoon, typhoonConcerns, type TyphoonNow } from "../../shared/typhoonForecast";
import { Button } from "./kit";

export const JMA_TYPHOON_PAGE = "https://www.jma.go.jp/bosai/map.html#contents=typhoon";

/** 17日 9時 from JST ISO. */
const when = (iso: string) => (iso ? `${+iso.slice(8, 10)}日 ${+iso.slice(11, 13)}時` : "");

export function TyphoonCard({ station, typhoons, onCompare }: { station: string; typhoons: TyphoonNow[]; onCompare: () => void }) {
  const at = stationLatLon(station);
  const stationName = (stations as { blockNo: string; name: string }[]).find((x) => x.blockNo === station)?.name ?? "観測点";
  if (!at) return null;
  const shown = typhoons.map((t) => ({ t, s: stationOnTyphoon(t, at.lat, at.lon) })).filter(({ s }) => typhoonConcerns(s));
  if (!shown.length) return null;
  return (
    <section className="typhoon-cards" aria-label="近づいている台風">
      {shown.map(({ t, s }) => {
        const where = s.storm ? "暴風域に入っています" : s.gale ? "強風域に入っています" : s.warning ? "暴風警戒域に入っています（予報）" : null;
        const level = s.storm ? "storm" : s.gale || s.warning ? "gale" : "near";
        return (
          <article key={t.tc} className={`typhoon-card ${level}`}>
            <header>
              <span className={`typhoon-mark${s.storm ? " violent" : ""}`} aria-hidden>
                台
              </span>
              <b>
                {t.category === "台風" ? `台風${t.number}号` : t.category}
                {t.name ? <small>{t.name}</small> : null}
              </b>
              {t.pressure != null && (
                <span className="typhoon-pressure num">
                  {t.pressure}
                  <small>hPa</small>
                </span>
              )}
            </header>
            <p className="typhoon-where">
              {[t.at.location, t.at.course && t.at.speedKmh != null ? `${t.at.course}へ ${t.at.speedKmh}km/h` : t.at.course, t.wind != null ? `最大風速 ${t.wind}m/s` : null]
                .filter(Boolean)
                .join("・")}
            </p>
            <p className="typhoon-here">
              {stationName}は{" "}
              {where ? <strong>{where}</strong> : <span>中心から約 {Math.round(s.km / 10) * 10}km</span>}
            </p>
            <div className="typhoon-actions">
              <Button size="sm" onClick={onCompare}>
                前の台風の日と比べる
              </Button>
              <a href={JMA_TYPHOON_PAGE} target="_blank" rel="noreferrer" className="typhoon-link">
                気象庁の台風情報 ↗
              </a>
            </div>
            <p className="typhoon-source">出典：気象庁「台風情報」（{when(t.issued)}発表）。域に入っているかは気象庁の円で Weather Note が判定。</p>
          </article>
        );
      })}
    </section>
  );
}
