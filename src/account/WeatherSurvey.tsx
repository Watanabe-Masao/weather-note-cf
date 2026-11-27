// 今の天気のアンケート（2026-11-28 渡辺さん「今の天気だけをアンケート形式で。これは別で使います」「アンケートの入り口は今
// 作りましょう。雨を選択したらポツポツ、パラパラ、ザーザー、ゴウゴウ」）。記録のシートで「今の天気」を選んだとき。
// 送った 1 件は天気の記録（weather_obs、正本）に入る。肌感の記録の「今の天気」も同じ表に入るので、一覧には両方出る。
// アメダスとの突き合わせは、今は作らない。

import { useEffect, useState } from "react";
import { rainLabel, RAIN_LEVELS, type RainLevel, type Sky, SKIES, skyLabel } from "../../shared/nowWeather";
import { newId } from "../beta/reports";
import { Button, Chip } from "../ui/kit";
import { api } from "./account";

interface Obs {
  id: string;
  source: string;
  at: string;
  sky: string;
  rain: string | null;
  station: string | null;
}

const SOURCE: Record<string, string> = { survey: "今の天気", feel: "肌感の記録", photo: "空の写真" };
const jst = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function WeatherSurvey({ station }: { station: string }) {
  const [sky, setSky] = useState<Sky | null>(null);
  const [rain, setRain] = useState<RainLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [list, setList] = useState<Obs[] | null>(null);

  useEffect(() => {
    api<{ list: Obs[] }>("/api/me/weather")
      .then((r) => setList(r.list))
      .catch(() => setList([]));
  }, []);

  const pickSky = (v: Sky) => {
    setSky(v);
    if (v !== "rain") setRain(null);
    setSaved(null);
  };
  const send = () => {
    if (!sky || busy) return;
    setBusy(true);
    setError(null);
    const at = new Date().toISOString();
    api<{ list: Obs[] }>("/api/me/weather", { id: newId(), at, sky, rain: sky === "rain" ? rain : null, station })
      .then((r) => {
        setList(r.list);
        setSaved(`${jst(at)} ${skyLabel(sky)}${sky === "rain" && rain ? `（${rainLabel(rain)}）` : ""}を記録しました`);
        setSky(null);
        setRain(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const undo = (id: string) => {
    api<{ list: Obs[] }>("/api/me/weather/delete", { id })
      .then((r) => {
        setList(r.list);
        setSaved(null);
      })
      .catch((e) => setError((e as Error).message));
  };

  return (
    <>
      <section className="set-group" aria-labelledby="ws-now">
        <h3 id="ws-now">今の天気</h3>
        <p className="set-lead">いま見えている空を選んでください。予報や観測と合っているかの答え合わせに使います。</p>
        <div className="chip-row" role="group" aria-label="今の天気">
          {SKIES.map((k) => (
            <Chip key={k.id} on={sky === k.id} onClick={() => pickSky(k.id)}>
              {k.label}
            </Chip>
          ))}
        </div>
        {sky === "rain" && (
          <>
            <p className="set-help">雨の強さ（見た・聞いた感じ）</p>
            <div className="chip-row" role="group" aria-label="雨の強さ">
              {RAIN_LEVELS.map((k) => (
                <Chip key={k.id} on={rain === k.id} onClick={() => setRain(rain === k.id ? null : k.id)}>
                  {k.label}
                </Chip>
              ))}
            </div>
          </>
        )}
        <Button kind="primary" block busy={busy} disabled={!sky || busy || (sky === "rain" && !rain)} onClick={send}>
          {!sky ? "天気を選んでください" : sky === "rain" && !rain ? "雨の強さを選んでください" : "記録する"}
        </Button>
        {saved && (
          <p className="set-help" role="status">
            {saved}
          </p>
        )}
        {error && <p className="warn">{error}</p>}
      </section>
      <section className="set-group" aria-labelledby="ws-list">
        <h3 id="ws-list">あなたの天気の記録</h3>
        {list == null ? (
          <p className="set-help">読み込んでいます…</p>
        ) : list.length === 0 ? (
          <p className="set-help">まだありません。肌感の記録で選んだ「今の天気」も、ここに出ます。</p>
        ) : (
          <ul className="sp-list">
            {list.map((o) => (
              <li key={o.id}>
                <b>
                  {jst(o.at)}・{skyLabel(o.sky) ?? o.sky}
                  {o.rain ? `（${rainLabel(o.rain) ?? o.rain}）` : ""}
                </b>
                <small>
                  {SOURCE[o.source] ?? o.source}から
                  {o.source === "survey" && (
                    <Button size="sm" kind="quiet" onClick={() => undo(o.id)}>
                      取り消す
                    </Button>
                  )}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
