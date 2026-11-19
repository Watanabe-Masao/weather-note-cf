// 再試行と、間隔を延ばしていく待ち（#299 P1、2026-11-19）。
//
// 気象庁：1回の取得で、すぐに返ってきた一時的な失敗（5xx・429・接続の切れ）だけを、待ちを延ばしながらやり直す
// （0.5秒 → 2秒、合わせて3回まで）。時間切れ（20秒）はやり直さない（待つ時間が長くなりすぎ、ほかの段を遅らせる）。
// 4xx（無い・断られた）もやり直さない。それでも取れなければ、今までどおり次の定時処理（5分後）が取り直す。
// D1：定時処理の段が、一時的な D1 の失敗（接続の切れ・混雑など）で止まったら、1秒待って段を1回だけやり直す
// （health.ts timed）。段はどれも重ならない作り（INSERT OR IGNORE など）なので、やり直しても二重にならない。

export const RETRY_WAITS_MS = [500, 2000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** すぐに返ってきた一時的な失敗か（やり直す価値がある）。 */
export const transientStatus = (status: number) => status === 429 || status >= 500;
const timedOut = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/** 時間切れつきの fetch に、一時的な失敗のやり直しを足したもの。 */
export function retryingFetch(timeoutMs: number, waits: number[] = RETRY_WAITS_MS, wait: (ms: number) => Promise<unknown> = sleep, base: typeof fetch = (u, i) => fetch(u, i)) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= waits.length;
      try {
        const r = await base(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        if (!last && transientStatus(r.status)) {
          await wait(waits[attempt]);
          continue;
        }
        return r;
      } catch (e) {
        if (last || timedOut(e)) throw e;
        await wait(waits[attempt]);
      }
    }
  };
}

/** D1 の一時的な失敗か（やり直せば通ることがあるもの）。表が無い・SQL の誤りなどはやり直さない。 */
export const transientD1 = (e: unknown) =>
  /network connection lost|connection (was )?reset|internal error|overloaded|timed? ?out|too many requests|object to be reset|storage caused object/i.test(String(e)) &&
  !/no such (table|column)|syntax error|constraint failed/i.test(String(e));
