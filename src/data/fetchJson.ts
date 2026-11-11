// The app's one way to call the API. What reaches the screen is always a message for people:
// the Worker's own Japanese message when it sent one, otherwise a fixed sentence. Browser and
// network wording ("Load failed", "HTTP 502", a timeout name) never shows (the same rule as the
// Worker's errors).

const TIMEOUT_MS = 35_000;

/** The Worker's messages are Japanese sentences; anything else is not shown as it is. */
const ownMessage = (m: unknown): m is string => typeof m === "string" && /[぀-ヿ一-鿿]/.test(m) && m.length <= 200;

export async function fetchJson<T>(path: string, fetcher: typeof fetch = fetch): Promise<T> {
  let r: Response;
  try {
    r = await fetcher(path, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new Error("取得に時間がかかりすぎました。時間をおいて再試行してください。");
    throw new Error("通信できませんでした。電波の状態を確かめてください。");
  }
  const data: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new Error(ownMessage(message) ? message : "取得に失敗しました。時間をおいて再試行してください。");
  }
  if (data === null) throw new Error("取得したデータを読み取れませんでした。時間をおいて再試行してください。");
  return data as T;
}
