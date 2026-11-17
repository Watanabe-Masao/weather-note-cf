// 監視の判断 (2026-11-17): how /api/health (worker/src/health.ts) is judged — what is wrong (異常) and
// what is getting near a limit or kept for nothing (気づいたこと). One place for it, used by both:
//   - the Worker's hourly look in its 5-minute run (worker/src/healthWatch.ts), which tells the
//     administrators when a problem starts and when it is over;
//   - scripts/health-check.mjs (GitHub Actions, health.yml), which writes the report and the issue.
// Each finding has a key that stays the same while the same thing is wrong (its text has times and
// counts in it, which change every hour), so a problem can be told once when it starts and once when
// it is over.
//
// Also here: whether the record (shiromatz) has the month to take next (#250, #262), asked the same
// way by both.
//
// Plain TypeScript with nothing imported and only types to strip, so Node runs it as it is (the
// script imports this file by its name, .ts included).

export interface Finding {
  /** Stays the same while the same thing is wrong (e.g. "forecastStale", "cronFailed:notify"). */
  key: string;
  text: string;
}
export interface Judged {
  problems: Finding[];
  notes: Finding[];
}

/** Whether the record has the month to take next: true / false only when it answered; null, with the reason, when it could not be asked. */
export interface ImportReady {
  lastTaken: string | null;
  next: string | null;
  available: boolean | null;
  reason?: string;
}

interface Stage {
  stage: string;
  failed: number;
  max_ms: number;
}
interface UsagePart {
  error?: string;
}
/** The part of /api/health that is judged (worker/src/health.ts gives all of it). */
export interface HealthView {
  state: {
    forecastLastOk: string | null;
    typhoonLastOk: string | null;
    chartsLastOk?: string | null;
    openAlerts: { key: string; since: string }[];
    accountErrorsLastDay: { place: string; n: number }[];
    forecastImport?: { lastTaken: string | null; next: string | null };
  };
  room: {
    d1Size: { percent: number } | null;
    d1WritesMonth: { percent: number };
    r2: { percentOfFree: number };
    cron: { runsLastDay: number; stages: Stage[] };
  };
  waste: {
    unparsed: number;
    parseFailed: number;
    fetchFailuresLastDay: number;
  };
  usage?: {
    error?: string;
    workers?: UsagePart & { cpuP99PercentOfRun?: number; requestsPercent?: number; cpuPercentEstimate?: number };
    d1?: UsagePart & { rowsWrittenPercent?: number };
    r2?: UsagePart & { bytesPercentOfFree?: number; classAPercentOfFree?: number };
  };
}

const H = 3_600_000;

/** Judges /api/health (null when it could not be read: only the record's note, if any). */
export function judgeHealth(h: HealthView | null, now: number, importReady: ImportReady | null = null): Judged {
  const problems: Finding[] = [];
  const notes: Finding[] = [];
  const problem = (key: string, text: string) => problems.push({ key, text });
  const note = (key: string, text: string) => notes.push({ key, text });
  const ago = (iso: string | null | undefined) => (iso ? (now - Date.parse(iso)) / H : Infinity);
  const hours = (x: number) => (x === Infinity ? "記録なし" : `${x.toFixed(1)}時間前`);

  if (h) {
    const s = h.state,
      room = h.room,
      waste = h.waste;
    // 状態
    if (ago(s.forecastLastOk) > 0.5) problem("forecastStale", `予報の電文を最後に取れたのは ${hours(ago(s.forecastLastOk))}（5分ごとのはず）。`);
    if (ago(s.typhoonLastOk) > 0.5) problem("typhoonStale", `台風の電文を最後に取れたのは ${hours(ago(s.typhoonLastOk))}。`);
    if (s.chartsLastOk !== undefined && ago(s.chartsLastOk) > 1) note("chartsStale", `天気図の保存が最後にうまくいったのは ${hours(ago(s.chartsLastOk))}。`);
    for (const a of s.openAlerts) problem(`alert:${a.key}`, `アプリの警告が開いたまま：${a.key}（${a.since} から）。`);
    const errs = s.accountErrorsLastDay.reduce((n, e) => n + e.n, 0);
    if (errs >= 3) problem("accountErrors", `アカウントの処理の失敗が24時間で ${errs} 回（${s.accountErrorsLastDay.map((e) => `${e.place} ${e.n}`).join("・")}）。`);
    else if (errs) note("accountErrors", `アカウントの処理の失敗が24時間で ${errs} 回。`);
    for (const st of room.cron.stages) if (st.failed >= 3) problem(`cronFailed:${st.stage}`, `定時処理「${st.stage}」が24時間で ${st.failed} 回失敗。`);
    if (room.cron.runsLastDay < 250) note("cronRuns", `定時処理が24時間で ${room.cron.runsLastDay} 回（288回のはず）。`);
    // 余裕
    if (room.d1Size && room.d1Size.percent >= 50) note("d1Size", `データベースの大きさが上限の ${room.d1Size.percent}%。`);
    if (room.d1WritesMonth.percent >= 50) note("d1Writes", `データベースの書き込み（月の見込み）が込みの量の ${room.d1WritesMonth.percent}%。`);
    if (room.r2.percentOfFree >= 70) note("r2", `R2 が無料枠の ${room.r2.percentOfFree}%。`);
    for (const st of room.cron.stages) if (st.max_ms >= 60_000) note(`cronSlow:${st.stage}`, `定時処理「${st.stage}」が長い（最長 ${Math.round(st.max_ms / 1000)}秒、待ち時間を含む）。`);
    const cpu = h.usage?.workers?.cpuP99PercentOfRun;
    if (typeof cpu === "number" && cpu >= 30) note("cpuP99", `計算時間の長い回（99%）が1回の上限の ${cpu}%。`);
    // 実際の使用量（Cloudflare の集計）
    const u = h.usage ?? {};
    if (u.error) note("usage", `実際の使用量が読めません（${u.error}）。`);
    for (const [name, part] of Object.entries({ Workers: u.workers, D1: u.d1, R2: u.r2 }))
      if (part && part.error) note(`usage:${name}`, `実際の使用量（${name}）が読めません：${part.error}`);
    const high: [string, string, number | undefined][] = [
      ["requests", "リクエスト", u.workers?.requestsPercent],
      ["cpu", "計算時間（目安）", u.workers?.cpuPercentEstimate],
      ["d1RowsWritten", "データベースの書き込み", u.d1?.rowsWrittenPercent],
      ["r2Bytes", "R2 の保存", u.r2?.bytesPercentOfFree],
      ["r2ClassA", "R2 の書き込み", u.r2?.classAPercentOfFree],
    ];
    for (const [key, name, p] of high) if (typeof p === "number" && p >= 50) note(`month:${key}`, `今月の${name}が込みの量（無料枠）の ${p}%。`);
    // 無駄
    if (waste.unparsed > 50) problem("unparsed", `読めていない電文が ${waste.unparsed} 通たまっています。`);
    if (waste.parseFailed > 0) note("parseFailed", `読めなかった電文が ${waste.parseFailed} 通（解析器の見直しが要るかも）。`);
    if (waste.fetchFailuresLastDay > 12) note("fetchFailures", `予報の取得の失敗が24時間で ${waste.fetchFailuresLastDay} 回。`);
  }

  // 過去の記録の取り込み: not a problem; a note only when the record could not be asked.
  if (importReady?.next && importReady.available === null) note("importUnknown", `記録に ${importReady.next} があるか確かめられませんでした（${importReady.reason}）。`);

  return { problems, notes };
}

export const RECORD_REPO = "shiromatz/Japan-Meteorological-Agency-Weather-Forecast";
/** The month's zip on the record's main (raw, as the app takes it: forecast/forecast_YYYYMM.zip). */
export const recordZipUrl = (month: string) => `https://raw.githubusercontent.com/${RECORD_REPO}/refs/heads/main/forecast/forecast_${month.replace("-", "")}.zip`;
export const importTitle = (month: string) => `取り込める月があります：${month}`;

type Head = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

/**
 * Whether the record has the month to take next (one HEAD). `available` is true or false only when the
 * record answered (404 is false); null, with the reason, when it could not be asked.
 */
export async function checkImport(
  position: { lastTaken: string | null; next: string | null } | null | undefined,
  get: Head = fetch,
  userAgent = "weather-note health",
): Promise<ImportReady> {
  const lastTaken = position?.lastTaken ?? null;
  const next = position?.next ?? null;
  if (!next) return { lastTaken, next, available: null };
  try {
    const r = await get(recordZipUrl(next), { method: "HEAD", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": userAgent } });
    if (r.status === 404) return { lastTaken, next, available: false };
    if (r.ok) return { lastTaken, next, available: true };
    return { lastTaken, next, available: null, reason: `HTTP ${r.status}` };
  } catch (e) {
    return { lastTaken, next, available: null, reason: (e as Error).message };
  }
}
