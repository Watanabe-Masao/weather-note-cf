// 出典のリンク（FS-02、2026-11-23）：Open-Meteo は CC BY 4.0 で「値のそばにリンクとライセンス」、気象庁はページへのリンク。
import { JMA_FORECAST_URL, OPEN_METEO_LICENCE_URL, OPEN_METEO_URL } from "../sourceTag";

/** 「Open-Meteo（CC BY 4.0）」：名前とライセンスにリンク。 */
export function OpenMeteoCredit() {
  return (
    <>
      <a href={OPEN_METEO_URL} target="_blank" rel="noopener noreferrer">
        Open-Meteo
      </a>
      （
      <a href={OPEN_METEO_LICENCE_URL} target="_blank" rel="noopener noreferrer">
        CC BY 4.0
      </a>
      ）
    </>
  );
}

/** 気象庁 府県天気予報（高知県）のページへのリンク。 */
export function JmaForecastLink() {
  return (
    <a href={JMA_FORECAST_URL} target="_blank" rel="noopener noreferrer">
      気象庁の府県天気予報のページ
    </a>
  );
}
