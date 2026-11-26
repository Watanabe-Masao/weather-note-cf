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
// Plain TypeScript with only types to strip, so Node runs it as it is (the script imports this file
// by its name, .ts included). What it imports is named the same way, .ts included — Node does not
// guess the extension, and without it the GitHub Actions check stops before it asks anything
// (11/25, test/health-check-node.test.ts).

import { airFeed } from "./airSchedule.ts";

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
    radarLastOk?: string | null;
    longRangeLastOk?: string | null;
    amedasLastOk?: string | null;
    airLastOk?: string | null;
    airForecastLastOk?: string | null;
    soramameLastOk?: string | null;
    /** 週の点検が最後に終わった時刻（worker/src/weeklyAudit.ts）。表が無いときは無い。 */
    weeklyAuditAt?: string | null;
    /** GitHub の控えにまだ置いていない日の数（worker/src/offsite.ts）。鍵が無いときは無い。 */
    offsitePending?: number;
    warnings?: { lastOk: string | null; fetchFailuresLastDay: number };
    /** 欠けの発見（worker/src/completeness.ts）。pending は新しい順。 */
    completeness?: {
      forecast: Record<string, { pending: string[]; pendingCount: number; lostCount: number }>;
      lostLastDay: { source: string; n: number }[];
      /** 空気のデータ（worker/src/airAudit.ts、11/25）。pending は新しい順。 */
      air?: {
        cams: { pending: string[]; pendingCount: number };
        soramame: { pending: string[]; pendingCount: number; newest: string | null };
        forecast: { expected: number; kept: number };
      } | null;
    };
    openAlerts: { key: string; since: string }[];
    accountErrorsLastDay: { place: string; n: number }[];
    /** 失敗の種類ごとの数（文言は出さない。#292、2026-11-19）。無い health もある。 */
    accountErrorKindsLastDay?: { kind: string; n: number }[];
    forecastImport?: { lastTaken: string | null; next: string | null };
  };
  room: {
    d1Size: { percent: number } | null;
    d1WritesMonth: { percent: number };
    r2: { percentOfFree: number };
    cron: { runsLastDay: number; stages: Stage[]; missing?: number; gaps?: { from: string; to: string; n: number }[] };
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

/** 日本時間の「11/18 3:05」。 */
const jstClock = (iso: string) => {
  const d = new Date(Date.parse(iso) + 9 * H);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
/** 定時処理の抜け（health.ts cronGaps）を言葉に：大きい順に3つまで。続いて抜けたか、ばらばらかが分かるように。 */
export function gapText(gaps: { from: string; to: string; n: number }[] | undefined): string {
  if (!gaps?.length) return "";
  const big = [...gaps].sort((a, b) => b.n - a.n).slice(0, 3);
  return `抜けた時間：${big.map((g) => (g.n === 1 ? `${jstClock(g.from)}` : `${jstClock(g.from)}〜${jstClock(g.to).split(" ")[1]}（${g.n}回）`)).join("・")}${gaps.length > 3 ? " ほか" : ""}。`;
}

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
    // 雨雲レーダー：気象庁の一覧は約3時間分。2時間止まると、取り直せない時刻が出はじめる。
    if (s.radarLastOk !== undefined) {
      if (ago(s.radarLastOk) > 2) problem("radarStale", `雨雲レーダーの保存が最後にうまくいったのは ${hours(ago(s.radarLastOk))}（約3時間を過ぎた分は取り直せない）。`);
      else if (ago(s.radarLastOk) > 1) note("radarStale", `雨雲レーダーの保存が最後にうまくいったのは ${hours(ago(s.radarLastOk))}。`);
    }
    // 長い先の予報：30分ごとに読む。配信の長い一覧は7日分なので、半日止まっても取り直せる（注意だけ）。
    if (s.amedasLastOk !== undefined) {
      // 気象庁は約10日置くので、すぐには失われない。半日で注意、2日で異常（取り直せる残りが減っていく）。
      if (ago(s.amedasLastOk) > 48) problem("amedasStale", `アメダスの観測の保存が最後にうまくいったのは ${hours(ago(s.amedasLastOk))}（約10日を過ぎた分は取り直せない）。`);
      else if (ago(s.amedasLastOk) > 12) note("amedasStale", `アメダスの観測の保存が最後にうまくいったのは ${hours(ago(s.amedasLastOk))}。`);
    }
    // 空気質は 2023-01 からいつでも取り直せるので、止まっても注意だけ（2日）。
    if (s.airLastOk !== undefined && ago(s.airLastOk) > 48) note("airStale", `空気質の保存が最後にうまくいったのは ${hours(ago(s.airLastOk))}（後から取り直せる）。`);
    // 空気質の予測（11/25、airForecast.ts）：1時間ごとに取る。画面の今日と先の日はこの値なので、3時間で注意、1日で異常
    // （予報の履歴は持たないので、止まった間の予測は取り直せない。画面は取得の時刻と「2時間以上たっています」を出す）。
    if (s.airForecastLastOk !== undefined) {
      if (ago(s.airForecastLastOk) > 24) problem("airForecastStale", `空気質の予測（CAMS）を最後に取れたのは ${hours(ago(s.airForecastLastOk))}（1時間ごとのはず、画面の今日と先の日が古いまま）。`);
      else if (ago(s.airForecastLastOk) > 3) note("airForecastStale", `空気質の予測（CAMS）を最後に取れたのは ${hours(ago(s.airForecastLastOk))}（1時間ごとのはず）。`);
    }
    // 大気汚染の実測は1年さかのぼって取れる：2日で注意、2週間で異常（取り直せる残りが減っていく）。
    if (s.soramameLastOk !== undefined) {
      if (ago(s.soramameLastOk) > 14 * 24) problem("soramameStale", `大気汚染の実測（そらまめくん）の保存が最後にうまくいったのは ${hours(ago(s.soramameLastOk))}（1年を過ぎた分は取り直せない）。`);
      else if (ago(s.soramameLastOk) > 48) note("soramameStale", `大気汚染の実測（そらまめくん）の保存が最後にうまくいったのは ${hours(ago(s.soramameLastOk))}。`);
    }
    // 週の点検（#370）：7日ごと。8日を過ぎたら注意（点検が止まっても、データそのものは失われない）。
    if (s.weeklyAuditAt !== undefined && ago(s.weeklyAuditAt) > 8 * 24) note("weeklyAuditStale", `週の点検が最後に終わったのは ${s.weeklyAuditAt ? `${(ago(s.weeklyAuditAt) / 24).toFixed(1)}日前` : "記録なし"}（7日ごとのはず）。`);
    // 原本の控え（#370）：5分ごとに1日ずつ置くので、ふだんは0日。3日より多くたまったら注意（原本は R2 に残っている）。
    if (s.offsitePending !== undefined && s.offsitePending > 3) note("offsiteBehind", `GitHub の控えが ${s.offsitePending}日分たまっています（原本は R2 にあり、失われてはいない）。`);
    if (s.longRangeLastOk !== undefined && ago(s.longRangeLastOk) > 12) note("longRangeStale", `長い先の予報の電文の保存が最後にうまくいったのは ${hours(ago(s.longRangeLastOk))}。`);
    // 警報・注意報 (2026-11-18 渡辺さん OK)：配信の長い一覧は7日分。7日止まると取り戻せない（一覧から外れた電文は名前が
    // 分からず取りに行けない、#267）。1日で注意、3日で異常（まだ4日分は取り戻せるうちに気づく）。まだ一度も読んで
    // いない（記録が無い）ときは判断しない。
    const w = s.warnings;
    if (w && (w.lastOk || w.fetchFailuresLastDay > 0)) {
      const a = ago(w.lastOk);
      if (a > 72) problem("warningStale", `警報・注意報の電文の保存が最後にうまくいったのは ${hours(a)}（7日を過ぎた分は取り戻せない）。`);
      else if (a > 24) note("warningStale", `警報・注意報の電文の保存が最後にうまくいったのは ${hours(a)}。`);
    }
    // 欠けの発見（#299）：最新が届いても、間の定時の発表が抜けていれば欠け。取り戻せるのは長い一覧の7日まで。
    // まだ取り戻せる欠けが5日を過ぎたら異常（残り2日）、3時間を過ぎたら注意（次の回で取り戻せていない）。
    // 取り戻せない欠けが24時間で新しく出たら注意（記録して説明する、R-11）。
    const c = s.completeness;
    if (c) {
      const pend = Object.entries(c.forecast).flatMap(([k, a]) => a.pending.map((t) => ({ k, t })));
      const oldest = pend.reduce<{ k: string; t: string } | null>((a, b) => (a == null || b.t < a.t ? b : a), null);
      const NAME: Record<string, string> = { VPFD51: "府県天気予報", VPFW50: "府県週間天気予報" };
      const say = (p: { k: string; t: string }) => `${NAME[p.k] ?? p.k}の ${jstClock(p.t)} の発表`;
      if (oldest && ago(oldest.t) > 5 * 24) problem("forecastGap", `予報の電文の欠け：${say(oldest)}など ${pend.length}回が保存されていません（7日を過ぎると取り戻せない）。`);
      else if (oldest && ago(oldest.t) > 3) note("forecastGap", `予報の電文の欠け：${say(oldest)}など ${pend.length}回が保存されていません（まだ取り戻せる）。`);
      // 空気のデータ（11/25、提供スケジュールは shared/airSchedule.ts）：遅れ・欠け・予測のそろい。
      const a = c.air;
      if (a) {
        const sora = airFeed("soramame");
        if (a.soramame.newest) {
          const late = ago(a.soramame.newest);
          if (sora.stopH != null && late > sora.stopH) problem("soramameLate", `大気汚染の実測（そらまめくん）の最新は ${jstClock(a.soramame.newest)}（ふだん約1時間遅れ。${sora.stopH}時間を過ぎた）。`);
          else if (late > sora.lateH) note("soramameLate", `大気汚染の実測（そらまめくん）の最新は ${jstClock(a.soramame.newest)}（ふだん約1時間遅れ）。`);
        }
        const gaps = [
          a.cams.pendingCount ? `CAMS の終わった日 ${a.cams.pendingCount}時間（${jstClock(a.cams.pending[0])} など。いつでも取り直せる）` : "",
          a.soramame.pendingCount ? `そらまめくん ${a.soramame.pendingCount}時間（${jstClock(a.soramame.pending[0])} など。1年までは取り直せる）` : "",
        ].filter(Boolean);
        if (gaps.length) note("airGap", `空気のデータの欠け：${gaps.join("・")}。`);
        if (a.forecast.expected && a.forecast.kept < a.forecast.expected * 0.75) note("airForecastShort", `空気質の予測が、今日から4日先までの ${a.forecast.expected}時間のうち ${a.forecast.kept}時間しかありません。`);
      }
      const lost = c.lostLastDay.reduce((n, l) => n + l.n, 0);
      if (lost) note("dataLost", `取り戻せない欠けが24時間で ${lost} 件（${c.lostLastDay.map((l) => `${l.source} ${l.n}`).join("・")}）。`);
    }
    for (const a of s.openAlerts) problem(`alert:${a.key}`, `アプリの警告が開いたまま：${a.key}（${a.since} から）。`);
    const errs = s.accountErrorsLastDay.reduce((n, e) => n + e.n, 0);
    const kinds = s.accountErrorKindsLastDay?.length ? `。種類：${s.accountErrorKindsLastDay.map((k) => `${failureKindName(k.kind)} ${k.n}`).join("・")}` : "";
    if (errs >= 3) problem("accountErrors", `アカウントの処理の失敗が24時間で ${errs} 回（${s.accountErrorsLastDay.map((e) => `${e.place} ${e.n}`).join("・")}）${kinds}。`);
    else if (errs) note("accountErrors", `アカウントの処理の失敗が24時間で ${errs} 回。`);
    for (const st of room.cron.stages) if (st.failed >= 3) problem(`cronFailed:${st.stage}`, `定時処理「${st.stage}」が24時間で ${st.failed} 回失敗。`);
    if (room.cron.runsLastDay < 250) note("cronRuns", `定時処理の記録が、決まった24時間（288回）のうち ${room.cron.runsLastDay} 回。${gapText(room.cron.gaps)}`);
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

/**
 * アカウントの処理の失敗の種類（#292、2026-11-19）：公開の health には文言を出さず、種類ごとの数だけを出す。
 * 毎朝の見張りが、ログを探さずに原因の見当をつけられるように。
 * 場所と原因を分ける（2026-11-19 の独立レビュー）：表の作成の中で起きた失敗は「schema:原因」（例 schema:d1 ＝
 * 表の作成の中でデータベースが失敗）。原因は包まれた中の文言から見る。上から順に当てはめる。
 */
export const FAILURE_KINDS = [
  ["promise", /created by a request that has since ended|cross_request_promise/i],
  ["timeout", /timed? ?out|TimeoutError/i],
  ["aborted", /AbortError|aborted/i],
  ["network", /network connection|connection (was )?reset|fetch failed/i],
  ["d1", /D1_|SQLITE_/],
] as const;
export const FAILURE_KIND_NAME: Record<string, string> = {
  promise: "要求をまたいだ待ち",
  timeout: "時間切れ",
  aborted: "中断",
  network: "接続の切れ",
  d1: "データベース",
  other: "その他",
};
/** 種類の名前（表の作成の中なら「表の作成（原因）」）。 */
export const failureKindName = (k: string) => (k.startsWith("schema:") ? `表の作成（${FAILURE_KIND_NAME[k.slice(7)] ?? k.slice(7)}）` : (FAILURE_KIND_NAME[k] ?? k));
export function failureKind(message: string): string {
  const schema = /^\w*Error: schema:/.test(message);
  // ensureSchema は「schema: <文> — <元の失敗>」と包む。原因は包まれた中で見る。
  const at = message.indexOf(" — ");
  const inner = schema && at >= 0 ? message.slice(at + 3) : message;
  let cause = "other";
  for (const [k, re] of FAILURE_KINDS)
    if (re.test(inner)) {
      cause = k;
      break;
    }
  return schema ? `schema:${cause}` : cause;
}
