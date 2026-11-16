// 近づいている台風 (#220): JMA's typhoon information (防災情報の台風 JSON), read as its pages read
// it: the list of typhoons now (targetTc.json), then each one's forecast.json and specifications.json.
// Parsed in shared/typhoonForecast.ts; the app looks its station up in JMA's areas. Read only when
// asked and kept 30 minutes at the edge (index.ts), so JMA is not asked often. Anything that fails
// is no typhoon (and logged), never an error for the person. 出典：気象庁「台風情報」。

import { parseTyphoon, type TyphoonNow } from "../../shared/typhoonForecast";

const BASE = "https://www.jma.go.jp/bosai/typhoon/data/";

async function get(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export interface TyphoonsResponse {
  typhoons: TyphoonNow[];
  /** false when JMA could not be read (the list may then be empty though typhoons exist). */
  ok: boolean;
  fetchedAt: string;
}

export async function activeTyphoons(): Promise<TyphoonsResponse> {
  const fetchedAt = new Date().toISOString();
  let list: unknown;
  try {
    list = await get(`${BASE}targetTc.json`);
  } catch (e) {
    console.error("weather-note: typhoon list", e);
    return { typhoons: [], ok: false, fetchedAt };
  }
  const tcs = (Array.isArray(list) ? list : [])
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>).tropicalCyclone : null))
    .filter((x): x is string => typeof x === "string" && /^TC\d{4}$/.test(x));
  const typhoons: TyphoonNow[] = [];
  let ok = true;
  for (const tc of tcs) {
    try {
      const [forecast, spec] = await Promise.all([get(`${BASE}${tc}/forecast.json`), get(`${BASE}${tc}/specifications.json`)]);
      const t = parseTyphoon(tc, forecast, spec);
      if (t) typhoons.push(t);
      else console.error("weather-note: typhoon not understood", tc);
    } catch (e) {
      ok = false;
      console.error("weather-note: typhoon", tc, e);
    }
  }
  return { typhoons, ok, fetchedAt };
}
