// 監視と管理 (2026-11-17): the month's real use, as Cloudflare counts it for the bill — read from its
// GraphQL Analytics API with a read-only token (Account Analytics: Read, the secret CF_ANALYTICS_TOKEN)
// — so the room left is a measure, not an estimate. Each product is asked apart: one that does not
// answer is said (null with its reason), never shown as 0.
// The month is the calendar month in UTC (Cloudflare's billing periods follow the account's own start
// day; the dashboard's Billable Usage is the authority for the bill).

export interface UsageEnv {
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
}

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const SCRIPT = "weather-note-cf";
const BUCKET = "weather-note-archive";

/** R2's Class A operations (writes and lists); the rest are Class B (reads). Cloudflare's pricing page. */
const CLASS_A = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);

type Post = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

async function ask<T>(env: Required<UsageEnv>, query: string, variables: Record<string, unknown>, post: Post): Promise<T> {
  const r = await post(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { accountTag: env.CF_ACCOUNT_ID, ...variables } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = (await r.json()) as { data?: { viewer?: { accounts?: T[] } }; errors?: { message: string }[] | null };
  if (body.errors?.length) throw new Error(body.errors[0].message.slice(0, 200));
  const a = body.data?.viewer?.accounts?.[0];
  if (!a) throw new Error("no account in the answer");
  return a;
}

type Part<T> = { ok: true; value: T } | { ok: false; error: string };
async function part<T>(f: () => Promise<T>): Promise<Part<T>> {
  try {
    return { ok: true, value: await f() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Month-to-date use (UTC month) of the Worker, D1, and R2, as Cloudflare counts it. */
export async function monthUsage(env: UsageEnv, now = Date.now(), post: Post = (u, i) => fetch(u, i)) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return { ok: false as const, error: "CF_ANALYTICS_TOKEN / CF_ACCOUNT_ID が設定されていません" };
  const e = env as Required<UsageEnv>;
  const d = new Date(now);
  const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const from = monthStart.toISOString();
  const to = d.toISOString();
  const fromDate = from.slice(0, 10);
  const toDate = to.slice(0, 10);

  const workers = await part(async () => {
    const a = await ask<{ w: { sum: { requests: number; errors: number; subrequests: number }; quantiles: { cpuTimeP50: number; cpuTimeP99: number } }[] }>(
      e,
      `query ($accountTag: string!, $from: Time!, $to: Time!, $script: string!) { viewer { accounts(filter: { accountTag: $accountTag }) {
         w: workersInvocationsAdaptive(limit: 1, filter: { scriptName: $script, datetime_geq: $from, datetime_leq: $to }) {
           sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } } } } }`,
      { from, to, script: SCRIPT },
      post,
    );
    const g = a.w[0];
    return {
      requests: g?.sum.requests ?? 0,
      errors: g?.sum.errors ?? 0,
      subrequests: g?.sum.subrequests ?? 0,
      // CPU time in microseconds (median and 99th percentile of the invocations).
      cpuP50Us: g?.quantiles.cpuTimeP50 ?? 0,
      cpuP99Us: g?.quantiles.cpuTimeP99 ?? 0,
    };
  });

  const d1 = await part(async () => {
    const a = await ask<{ q: { sum: { readQueries: number; writeQueries: number; rowsRead: number; rowsWritten: number } }[]; s: { max: { databaseSizeBytes: number } }[] }>(
      e,
      `query ($accountTag: string!, $from: Date!, $to: Date!) { viewer { accounts(filter: { accountTag: $accountTag }) {
         q: d1AnalyticsAdaptiveGroups(limit: 1, filter: { date_geq: $from, date_leq: $to }) { sum { readQueries writeQueries rowsRead rowsWritten } }
         s: d1StorageAdaptiveGroups(limit: 1, filter: { date_geq: $from, date_leq: $to }, orderBy: [date_DESC]) { max { databaseSizeBytes } dimensions { date } } } } }`,
      { from: fromDate, to: toDate },
      post,
    );
    const q = a.q[0]?.sum;
    return {
      rowsRead: q?.rowsRead ?? 0,
      rowsWritten: q?.rowsWritten ?? 0,
      readQueries: q?.readQueries ?? 0,
      writeQueries: q?.writeQueries ?? 0,
      // The account's databases together (this app has one).
      sizeBytes: a.s[0]?.max.databaseSizeBytes ?? null,
    };
  });

  // Ordering by a field needs it among the dimensions (as D1's `date` above); without it Cloudflare answers
  // "cannot order by datetime: it is neither aggregated, nor a dimension" and R2 is never read.
  const r2 = await part(async () => {
    const a = await ask<{ o: { sum: { requests: number }; dimensions: { actionType: string } }[]; s: { max: { payloadSize: number; objectCount: number } }[] }>(
      e,
      `query ($accountTag: string!, $from: Time!, $to: Time!, $bucket: string!) { viewer { accounts(filter: { accountTag: $accountTag }) {
         o: r2OperationsAdaptiveGroups(limit: 100, filter: { datetime_geq: $from, datetime_leq: $to, bucketName: $bucket }) { sum { requests } dimensions { actionType } }
         s: r2StorageAdaptiveGroups(limit: 1, filter: { datetime_geq: $from, datetime_leq: $to, bucketName: $bucket }, orderBy: [datetime_DESC]) { max { payloadSize objectCount } dimensions { datetime } } } } }`,
      { from, to, bucket: BUCKET },
      post,
    );
    let classA = 0;
    let classB = 0;
    for (const g of a.o) (CLASS_A.has(g.dimensions.actionType) ? (classA += g.sum.requests) : (classB += g.sum.requests));
    return { classA, classB, bytes: a.s[0]?.max.payloadSize ?? 0, objects: a.s[0]?.max.objectCount ?? 0 };
  });

  return { ok: true as const, from, to, workers, d1, r2 };
}

/**
 * 定時処理の回（2026-11-18）：Cloudflare 自身の記録（workersInvocationsScheduled）で、決まった窓の中に始まった
 * 回を数える。D1 とは別の記録なので、D1 に何も残っていない回が「始まらなかった」のか「始まったが D1 に書けな
 * かった」のかを分けられる。答えが空のこともある（Cloudflare 側の取り込みの遅れ・欠け）ので、空は「0回」と
 * 言わずに empty として返す。
 */
export async function scheduledRuns(env: UsageEnv, window: { from: string; to: string }, post: Post = (u, i) => fetch(u, i)) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return { ok: false as const, error: "CF_ANALYTICS_TOKEN / CF_ACCOUNT_ID が設定されていません" };
  const e = env as Required<UsageEnv>;
  return part(async () => {
    const a = await ask<{ s: { scheduledDatetime: string; status: string; cpuTimeUs: number }[] }>(
      e,
      `query ($accountTag: string!, $from: Time!, $to: Time!, $script: string!) { viewer { accounts(filter: { accountTag: $accountTag }) {
         s: workersInvocationsScheduled(limit: 1000, filter: { scriptName: $script, scheduledDatetime_geq: $from, scheduledDatetime_leq: $to }) {
           scheduledDatetime status cpuTimeUs } } } }`,
      { from: window.from, to: window.to, script: SCRIPT },
      post,
    );
    const times = new Set<string>();
    const byStatus: Record<string, number> = {};
    let cpuMaxUs = 0;
    for (const r of a.s) {
      times.add(new Date(r.scheduledDatetime).toISOString());
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      cpuMaxUs = Math.max(cpuMaxUs, r.cpuTimeUs ?? 0);
    }
    return { empty: a.s.length === 0, runs: times.size, times: [...times], byStatus, cpuMaxUs };
  });
}
