// データの保守（管理者だけ、2026-11-19 渡辺さん「日々の運用で使いやすいように」）。
//
// 毎日の運用の順に並べる：①今の状態（見張りと同じ判定。異常・注意の行と手順の番号）と「まとめてコピー」（このまま
// メインのスレッドに貼れる）、②取得の様子（取り直しのボタンは要る段だけ）、③欠け、④エラーの記録（文言つき、コピーできる）、
// ③b 週の点検（全期間の最新と履歴、R2 の実物）、⑤重なりを確かめる（読むだけ）、⑥表の点検（行数とつながり、読むだけ）、⑦大きさ。何も消さない。サーバーは worker/src/maintenance.ts・refetch.ts。

import { AIR_FEEDS } from "../../shared/airSchedule";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ModalSheet } from "../ui/ModalSheet";
import { Button, Fold } from "../ui/kit";
import { api } from "./account";

type Stage = { id: string; name: string; reach: string; lastOk: string | null; waiting: number | null; left: number; available: boolean; needed: boolean; why: string[]; last: { at: string; ok: boolean; detail: string } | null };
type Series = { expected: number; kept: number; pendingCount: number; lostCount: number; absentCount?: number; pending: string[]; lost: string[]; absent?: string[] };
/** 空気のデータ（worker/src/airAudit.ts、11/25）。pending・absent は新しい順に6つまで。 */
type AirC = {
  cams: { expected: number; kept: number; pending: string[]; pendingCount: number; watermark: string | null };
  soramame: { expected: number; kept: number; pending: string[]; pendingCount: number; absent: string[]; absentCount: number; watermark: string | null; newest: string | null };
  forecast: { expected: number; kept: number; pendingCount: number };
};
type Dup = { name: string; n: number; examples: string[]; note?: string };
type Summary = {
  at: string;
  failed?: { part: string; message: string }[];
  judged: { problems: { key: string; text: string }[]; notes: { key: string; text: string }[] };
  refetch: { perHour: number; stages: Stage[] };
  completeness?: { forecast: Record<string, Series>; radar: Record<string, Series>; air?: AirC | null; lostAll: { source: string; n: number }[]; absentAll?: { source: string; n: number }[] };
  errors: { at: string; where: string; message: string }[];
  room: null | { d1Size: { bytes: number; percent: number } | null; d1WritesMonth: { estimate: number; percent: number; rowsLastDay: number }; r2: { bytes: number; percentOfFree: number }; cronRunsLastDay: number; cronMissing: number };
  lastDupCheck: { at: string; result: Dup[] } | null;
  lastAudit?: { at: string; result: { tables: { name: string; rows: number }[]; links: { name: string; n: number }[] } } | null;
  weeklyAudit?: { at: string; result: Weekly } | null;
  offsite?: { configured: boolean; lastDay: string | null; lastAt: string | null; days: number; bytes: number; pending: number; oldestPending: string | null; lastError: { at: string; day: string | null; error: string } | null } | null;
};
type Weekly = {
  series: { id: string; name: string; part: string; first: string | null; last: string | null; have: number; missing: number | null; gapCount: number; gaps: { from: string; to: string; n: number | null }[]; ageH: number | null; freshH: number; fresh: boolean; note: string }[];
  holes: { source: string; lost: number; recovered: number; absent: number }[];
  r2: { checked: number; missing: string[]; wrongSize: string[] } | null;
  latestOk: boolean;
  historyOk: boolean;
  failed: { part: string; message: string }[];
};

const NAME: Record<string, string> = { VPFD51: "府県天気予報", VPFW50: "府県週間天気予報", hrpns: "雨雲レーダー", rasrf: "解析雨量" };
const clock = (iso: string) => {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const ymd = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const age = (h: number | null) => (h == null ? "—" : h < 48 ? `${Math.round(h)}時間前` : `${Math.round(h / 24)}日前`);
const mb = (b: number) => `${(b / 1_048_576).toFixed(1)}MB`;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** メインのスレッドに貼るまとめ（文字だけ）。 */
function digest(s: Summary): string {
  const out = [`【データの保守】${clock(s.at)}`];
  const { problems, notes } = s.judged;
  out.push(problems.length ? `異常 ${problems.length}：` : "異常なし", ...problems.map((p) => `・${p.text}`));
  if (notes.length) out.push(`注意 ${notes.length}：`, ...notes.map((p) => `・${p.text}`));
  out.push("取得：", ...s.refetch.stages.map((x) => `・${x.name}：最後に取れた ${x.lastOk ? clock(x.lastOk) : "—"}${x.waiting ? `・取り残し ${x.waiting}` : ""}${x.needed ? `（${x.why.join("・")}）` : ""}`));
  if (s.errors.length) out.push(`エラー（新しい順、${Math.min(10, s.errors.length)}件）：`, ...s.errors.slice(0, 10).map((e) => `・${clock(e.at)} ${e.where}：${e.message}`));
  if (s.failed?.length) out.push("読めなかった部分：", ...s.failed.map((f) => `・${f.part}：${f.message}`));
  if (s.room) out.push(`大きさ：DB ${s.room.d1Size ? `${mb(s.room.d1Size.bytes)}（${s.room.d1Size.percent}%）` : "—"}・月の書き込み見込み ${s.room.d1WritesMonth.percent}%・R2 ${mb(s.room.r2.bytes)}・定時処理 ${s.room.cronRunsLastDay}/288`);
  return out.join("\n");
}

/**
 * 画面の全部を文字に（11/28 渡辺さん「一発で全部コピーできるようにできませんか？」）。まとめ（digest）に、欠けの時刻・空気のデータ・
 * 週の点検（抜けた区間まで）・原本の控え・エラーの全部・重なり・表の点検（表ごとの行数まで）・大きさの細かい値を足す。
 * 畳んで見えていない所も入れる。提供スケジュールの説明文（変わらない文）は入れない。
 */
export function fullText(s: Summary): string {
  const out = [digest(s)];
  const series = s.completeness ? [...Object.entries(s.completeness.forecast), ...Object.entries(s.completeness.radar)].filter(([, a]) => a.expected) : [];
  if (series.length) {
    out.push("", "欠け（最大14日）：");
    for (const [k, a] of series) {
      out.push(`・${NAME[k] ?? k}：${a.expected}回中${a.kept}回${a.pendingCount ? `・まだ取り戻せる ${a.pendingCount}` : ""}${a.lostCount ? `・取り戻せない ${a.lostCount}` : ""}${a.absentCount ? `・気象庁が出していない ${a.absentCount}` : ""}`);
      for (const t of a.pending) out.push(`  ${clock(t)}（まだ取り戻せる）`);
      for (const t of a.lost) out.push(`  ${clock(t)}（取り戻せない）`);
    }
  }
  const a = s.completeness?.air;
  if (a) {
    out.push("", "空気のデータ：");
    out.push(`・空気質の予測（CAMS）：今日から4日先まで ${a.forecast.expected}時間中 ${a.forecast.kept}時間`);
    out.push(`・空気質（CAMS、終わった日）：手前14日 ${a.cams.expected}時間中 ${a.cams.kept}時間${a.cams.watermark ? `（続けて確かめられた位置 ${clock(a.cams.watermark)}）` : ""}${a.cams.pendingCount ? `・欠け ${a.cams.pendingCount}時間（${a.cams.pending.map(clock).join("・")}）` : ""}`);
    out.push(`・大気汚染の実測：最新 ${a.soramame.newest ? clock(a.soramame.newest) : "なし"}・手前14日 ${a.soramame.expected}時間中 ${a.soramame.kept}時間${a.soramame.absentCount ? `・提供元が出していない ${a.soramame.absentCount}時間` : ""}${a.soramame.pendingCount ? `・欠け ${a.soramame.pendingCount}時間（${a.soramame.pending.map(clock).join("・")}）` : ""}`);
  }
  const w = s.weeklyAudit?.result;
  if (w) {
    out.push("", `週の点検（${clock(s.weeklyAudit!.at)}）：最新 ${w.latestOk ? "すべて新しい" : `遅れ ${w.series.filter((x) => !x.fresh).length}`}・履歴 ${w.historyOk ? "抜けなし" : `抜けのある系列 ${w.series.filter((x) => x.gapCount).length}`}`);
    for (const x of w.series) {
      out.push(
        `・${x.name} ${x.part}：${ymd(x.first)}〜${ymd(x.last)}・${x.have.toLocaleString()}${x.missing == null ? "通" : "回分"}・最新 ${age(x.ageH)}${x.fresh ? "" : `（${x.freshH}時間より古い）`}・${x.gapCount ? (x.missing == null ? `長く空いたところ ${x.gapCount}` : `抜け ${x.missing.toLocaleString()}回（${x.gapCount}か所）`) : "抜けなし"}`,
      );
      for (const g of x.gaps) out.push(`  ${clock(g.from)} 〜 ${clock(g.to)} の間${g.n == null ? "" : `（${g.n}回）`}`);
      if (x.gapCount > x.gaps.length) out.push(`  ほか ${x.gapCount - x.gaps.length}か所`);
      if (x.gapCount && x.note) out.push(`  ${x.note}`);
    }
    if (w.r2) out.push(`・R2 の実物：${w.r2.checked}件中 ${w.r2.checked - w.r2.missing.length - w.r2.wrongSize.length}件そのまま${w.r2.missing.length ? `・無い ${w.r2.missing.join("・")}` : ""}${w.r2.wrongSize.length ? `・大きさが違う ${w.r2.wrongSize.join("・")}` : ""}`);
    if (w.holes.length) out.push(`・毎時の欠けの発見（これまで）：${w.holes.map((h) => `${h.source} 取り戻せない ${h.lost}・後で取り戻した ${h.recovered}・出ていない ${h.absent}`).join("／")}`);
    if (w.failed.length) out.push(`・読めなかった部分：${w.failed.map((f) => `${f.part}（${f.message}）`).join("・")}`);
  }
  if (s.offsite)
    out.push(
      "",
      s.offsite.configured
        ? `原本の控え（GitHub）：${s.offsite.days}日分（${mb(s.offsite.bytes)}）・最後に置いた日 ${s.offsite.lastDay ?? "—"}${s.offsite.pending ? `・まだ ${s.offsite.pending}日（${s.offsite.oldestPending} から）` : "・遅れなし"}${s.offsite.lastError ? `・${clock(s.offsite.lastError.at)} の失敗：${s.offsite.lastError.error}` : ""}`
        : "原本の控え（GitHub）：まだ設定されていません",
    );
  if (s.errors.length > 10) out.push("", `エラーの記録（全部 ${s.errors.length}件）：`, ...s.errors.map((e) => `・${clock(e.at)} ${e.where}：${e.message}`));
  if (s.lastDupCheck) out.push("", `重なり（${clock(s.lastDupCheck.at)}）：`, ...s.lastDupCheck.result.map((d) => `・${d.name}：${d.n ? `${d.n}（${d.examples.join("・")}）${d.note ? `（${d.note}）` : ""}` : "0"}`));
  if (s.lastAudit) {
    out.push("", `表の点検（${clock(s.lastAudit.at)}）：`, ...s.lastAudit.result.links.map((l) => `・${l.name}：${l.n}`));
    out.push("表ごとの行数：", ...s.lastAudit.result.tables.map((t) => `・${t.name} ${t.rows.toLocaleString()}`));
  }
  if (s.room)
    out.push(
      "",
      `大きさ：データベース ${s.room.d1Size ? `${mb(s.room.d1Size.bytes)}（${s.room.d1Size.percent}%）` : "—"}・月の書き込みの見込み ${Math.round(s.room.d1WritesMonth.estimate / 1_000) / 10}万行（${s.room.d1WritesMonth.percent}%）・1日 ${s.room.d1WritesMonth.rowsLastDay.toLocaleString()}行・R2 ${mb(s.room.r2.bytes)}（${s.room.r2.percentOfFree}%）・定時処理 ${s.room.cronRunsLastDay}/288${s.room.cronMissing ? `（記録の無い回 ${s.room.cronMissing}）` : ""}`,
    );
  return out.join("\n");
}

/** 管理者ページの「運用」：データの保守の中身。 */
export function MaintenanceBody() {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [openErrors, setOpenErrors] = useState(false);
  const [openGaps, setOpenGaps] = useState(false);
  const [openTables, setOpenTables] = useState(false);
  const [openWeekly, setOpenWeekly] = useState(false);
  const load = useCallback(() => {
    api<Summary>("/api/admin/maintenance")
      .then(setS)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);
  if (!s) return error ? <p className="warn">{error}</p> : <p className="set-help">読み込んでいます…</p>;
  const say = (what: string, ok: boolean) => {
    setCopied(ok ? `${what}をコピーしました。メインのスレッドに貼れます。` : "コピーできませんでした（ブラウザが許可していません）。");
    window.setTimeout(() => setCopied(null), 4000);
  };
  const refetch = (id: string) => {
    setBusy(id);
    setError(null);
    api("/api/admin/refetch", { stage: id })
      .then(load)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(null));
  };
  const dup = () => {
    setBusy("dup");
    api("/api/admin/dupcheck", {})
      .then(load)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(null));
  };
  const audit = () => {
    setBusy("audit");
    api("/api/admin/audit", {})
      .then(load)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(null));
  };
  const weekly = () => {
    setBusy("weekly");
    setError(null);
    api("/api/admin/weekly-audit", {})
      .then(load)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(null));
  };
  const { problems, notes } = s.judged;
  const w = s.weeklyAudit?.result;
  const level = problems.length || s.failed?.length ? "bad" : notes.length ? "note" : "ok";
  const series = s.completeness ? [...Object.entries(s.completeness.forecast), ...Object.entries(s.completeness.radar)].filter(([, a]) => a.expected) : [];
  const gaps = series.reduce((n, [, a]) => n + a.pendingCount + a.lostCount, 0);
  return (
    <div className="mt">
      {/* ① 今の状態 */}
      <section className={`set-group mt-now ${level}`} aria-labelledby="mt-now">
        <h3 id="mt-now">
          今の状態 <span className={`mt-badge ${level}`}>{problems.length ? `異常 ${problems.length}` : notes.length ? `注意 ${notes.length}` : "異常なし"}</span>
        </h3>
        {[...problems.map((p) => ({ ...p, bad: true })), ...notes.map((p) => ({ ...p, bad: false }))].map((p) => (
          <p key={p.key} className={p.bad ? "mt-line bad" : "mt-line"}>
            {p.text}
          </p>
        ))}
        {s.failed?.length
          ? s.failed.map((f) => (
              <p key={f.part} className="mt-line bad">
                読めなかった部分：{f.part}（{f.message}）
              </p>
            ))
          : null}
        <small className="set-help">
          {clock(s.at)} の時点。毎時の見張りと同じ判定です。手順の番号は障害の手引き（docs/runbook.md）。「全部コピー」は、畳んである所（欠けの時刻・週の点検の抜けた区間・表ごとの行数など）も含めて、この画面の全部を文字にします。
        </small>
        <div className="actions tight">
          <Button size="sm" onClick={() => void copy(digest(s)).then((ok) => say("まとめ", ok))}>
            まとめてコピー
          </Button>
          <Button size="sm" onClick={() => void copy(fullText(s)).then((ok) => say("全部", ok))}>
            全部コピー
          </Button>
          <Button size="sm" onClick={load}>
            読み直す
          </Button>
        </div>
        {copied ? (
          <small className="set-help" role="status">
            {copied}
          </small>
        ) : null}
      </section>

      {/* ② 取得の様子と取り直し */}
      <section className="set-group" aria-labelledby="mt-fetch">
        <h3 id="mt-fetch">取得の様子</h3>
        <ul className="mt-list">
          {s.refetch.stages.map((x) => (
            <li key={x.id}>
              <b>{x.name}</b>
              <small className="set-help">
                最後に取れた {x.lastOk ? clock(x.lastOk) : "—"}
                {x.waiting ? `・取り残し ${x.waiting}` : ""}・一覧に載るのは {x.reach}
              </small>
              {x.last ? <small className={x.last.ok ? "set-help" : "set-help warn"}>前回押した {clock(x.last.at)}：{x.last.detail}</small> : null}
              {x.needed ? (
                <>
                  <small className="set-help warn">{x.why.join("・")}</small>
                  <div className="actions tight">
                    <Button size="sm" busy={busy === x.id} disabled={!!busy || !x.left || !x.available} onClick={() => refetch(x.id)}>
                      {busy === x.id ? "取っています…" : `今すぐ取り直す（あと${x.left}回）`}
                    </Button>
                  </div>
                </>
              ) : (
                <small className="set-help mt-fine">今は取り直す必要はありません。</small>
              )}
            </li>
          ))}
        </ul>
        <small className="set-help">取り直しは定時処理（5分ごと）と同じ取り方を1回だけ動かします。重なって保存されることはありません。1つの段は1時間に{s.refetch.perHour}回まで。</small>
      </section>

      {/* ③ 欠け */}
      <section className="set-group" aria-labelledby="mt-gaps">
        <h3 id="mt-gaps">欠け</h3>
        <ul className="mt-list">
          {series.map(([k, a]) => (
            <li key={k}>
              <span>
                <b>{NAME[k] ?? k}</b>：{a.expected}回中{a.kept}回
                {a.pendingCount ? `・まだ取り戻せる ${a.pendingCount}` : ""}
                {a.lostCount ? `・取り戻せない ${a.lostCount}` : ""}
                {a.absentCount ? `・気象庁が出していない ${a.absentCount}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {gaps ? (
          <Fold open={openGaps} onToggle={() => setOpenGaps(!openGaps)} openLabel="欠けた時刻を見る" closeLabel="閉じる">
            <ul className="mt-list small">
              {series.flatMap(([k, a]) => [...a.pending.map((t) => `${NAME[k] ?? k} ${clock(t)}（まだ取り戻せる）`), ...a.lost.map((t) => `${NAME[k] ?? k} ${clock(t)}（取り戻せない）`)]).map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Fold>
        ) : (
          <small className="set-help mt-fine">欠けはありません（見ている範囲：最大14日）。</small>
        )}
      </section>

      {/* ③a 空気のデータ（11/25 渡辺さん「提供スケジュールを管理し、チェック・対応・判断ができるように」）：
          系統ごとに 提供元がいつ出すか・こちらがいつ取るか（shared/airSchedule.ts）と、今の様子（最新・欠け・出ていない）。 */}
      {s.completeness?.air && (
        <section className="set-group" aria-labelledby="mt-air">
          <h3 id="mt-air">空気のデータ（提供スケジュールと今の様子）</h3>
          <ul className="mt-list">
            {AIR_FEEDS.map((f) => {
              const a = s.completeness!.air!;
              const now =
                f.id === "forecast"
                  ? `今日から4日先まで ${a.forecast.expected}時間中 ${a.forecast.kept}時間`
                  : f.id === "cams"
                    ? `手前14日 ${a.cams.expected}時間中 ${a.cams.kept}時間${a.cams.watermark ? `（続けて確かめられた位置 ${clock(a.cams.watermark)}）` : ""}`
                    : `最新 ${a.soramame.newest ? clock(a.soramame.newest) : "なし"}・手前14日 ${a.soramame.expected}時間中 ${a.soramame.kept}時間${a.soramame.absentCount ? `・提供元が出していない ${a.soramame.absentCount}時間` : ""}`;
              const pend = f.id === "cams" ? a.cams.pending : f.id === "soramame" ? a.soramame.pending : [];
              return (
                <li key={f.id}>
                  <span>
                    <b>{f.name}</b>：{now}
                    {pend.length ? `・欠け ${f.id === "cams" ? a.cams.pendingCount : a.soramame.pendingCount}時間（${pend.slice(0, 3).map(clock).join("・")}）` : ""}
                  </span>
                  <small className="set-help mt-fine">
                    提供：{f.publish}。取得：{f.fetch}。遅れの目安：{f.lateH}時間{f.stopH ? `（${f.stopH}時間で異常）` : ""}。取り戻せる：{f.reach}。欠けたら：{f.refill}。手順 {f.runbook}
                  </small>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ③b 週の点検（全期間、読むだけ。weeklyAudit.ts） */}
      <section className="set-group" aria-labelledby="mt-weekly">
        <h3 id="mt-weekly">週の点検</h3>
        {w ? (
          <>
            <p className={w.latestOk ? "mt-line" : "mt-line bad"}>最新：{w.latestOk ? "すべて新しい" : `遅れ ${w.series.filter((x) => !x.fresh).length}`}</p>
            <p className={w.historyOk ? "mt-line" : "mt-line bad"}>履歴：{w.historyOk ? "抜けなし" : `抜けのある系列 ${w.series.filter((x) => x.gapCount).length}`}</p>
            <ul className="mt-list small mt-weekly">
              {w.series.map((x) => (
                <li key={`${x.id} ${x.part}`}>
                  <b>{x.name}</b>
                  <small className="set-help">
                    {x.part}・{ymd(x.first)}〜{ymd(x.last)}・{x.have.toLocaleString()}
                    {x.missing == null ? "通" : "回分"}
                  </small>
                  <small className={x.fresh ? "set-help" : "set-help warn"}>
                    最新 {age(x.ageH)}
                    {x.fresh ? "" : `（${x.freshH}時間より古い）`}・{x.gapCount ? (x.missing == null ? `長く空いたところ ${x.gapCount}` : `抜け ${x.missing.toLocaleString()}回（${x.gapCount}か所）`) : "抜けなし"}
                  </small>
                </li>
              ))}
            </ul>
            {w.series.some((x) => x.gapCount) ? (
              <Fold open={openWeekly} onToggle={() => setOpenWeekly(!openWeekly)} openLabel="抜けた区間と取り直せるかを見る" closeLabel="閉じる">
                <ul className="mt-list small">
                  {w.series
                    .filter((x) => x.gapCount)
                    .map((x) => (
                      <li key={`${x.id} ${x.part}`}>
                        <b>{x.name}</b>
                        {x.gaps.map((g) => (
                          <small key={g.from} className="set-help">
                            {clock(g.from)} 〜 {clock(g.to)} の間{g.n == null ? "" : `（${g.n}回）`}
                          </small>
                        ))}
                        {x.gapCount > x.gaps.length ? <small className="set-help">ほか {x.gapCount - x.gaps.length}か所</small> : null}
                        <small className="set-help">{x.note}</small>
                      </li>
                    ))}
                </ul>
              </Fold>
            ) : null}
            {w.r2 ? (
              <p className={w.r2.missing.length || w.r2.wrongSize.length ? "mt-line bad" : "mt-line"}>
                R2 の実物：{w.r2.checked}件中 {w.r2.checked - w.r2.missing.length - w.r2.wrongSize.length}件そのまま
                {w.r2.missing.length ? `・無い ${w.r2.missing.length}（${w.r2.missing.slice(0, 2).join("・")}）` : ""}
                {w.r2.wrongSize.length ? `・大きさが違う ${w.r2.wrongSize.length}（${w.r2.wrongSize.slice(0, 2).join("・")}）` : ""}
              </p>
            ) : null}
            {w.holes.length ? (
              <small className="set-help">
                毎時の欠けの発見（これまで）：{w.holes.map((h) => `${h.source.replace(/^(forecast|radar):/, "")} 取り戻せない ${h.lost}・後で取り戻した ${h.recovered}・出ていない ${h.absent}`).join("／")}
              </small>
            ) : null}
            {w.failed.length ? <small className="set-help warn">読めなかった部分：{w.failed.map((f) => `${f.part}（${f.message}）`).join("・")}</small> : null}
            <small className="set-help">{clock(s.weeklyAudit!.at)} に点検した結果。</small>
          </>
        ) : (
          <small className="set-help">まだ点検していません。</small>
        )}
        <small className="set-help">週に1回（3時台）、保存している系列を取り始めから今まで見て、「最新」と「履歴」を分けて数えます。R2 のファイルも20件選んで確かめます。読むだけで、何も消しません。</small>
        <div className="actions tight">
          <Button size="sm" busy={busy === "weekly"} disabled={!!busy} onClick={weekly}>
            {busy === "weekly" ? "点検しています…" : "今すぐ点検する"}
          </Button>
        </div>
      </section>

      {/* ③c 原本の控え（GitHub の非公開リポジトリ、offsite.ts） */}
      {s.offsite ? (
        <section className="set-group" aria-labelledby="mt-offsite">
          <h3 id="mt-offsite">原本の控え（GitHub）</h3>
          {s.offsite.configured ? (
            <>
              <p className={s.offsite.pending > 3 || s.offsite.lastError ? "mt-line bad" : "mt-line"}>
                {s.offsite.days}日分（{mb(s.offsite.bytes)}）・最後に置いた日 {s.offsite.lastDay ?? "—"}
                {s.offsite.pending ? `・まだ ${s.offsite.pending}日（${s.offsite.oldestPending} から）` : "・遅れなし"}
              </p>
              {s.offsite.lastError ? (
                <small className="set-help warn">
                  {clock(s.offsite.lastError.at)} の失敗{s.offsite.lastError.day ? `（${s.offsite.lastError.day}）` : ""}：{s.offsite.lastError.error}
                </small>
              ) : null}
            </>
          ) : (
            <p className="mt-line">まだ設定されていません。鍵が入ると、保存の始まりの日から1日ずつ置きます。</p>
          )}
          <small className="set-help">R2 の原本（電文・長い先の予報・アメダス・天気図・雨雲）を、1日ずつ tar にまとめて（多い日は分けて）GitHub の非公開リポジトリに月ごとに置き、読み戻して確かめます。置いたファイルは消しません。</small>
        </section>
      ) : null}

      {/* ④ エラーの記録 */}
      <section className="set-group" aria-labelledby="mt-errors">
        <h3 id="mt-errors">エラーの記録</h3>
        {s.errors.length ? (
          <>
            <p className="mt-line">
              {s.errors.length}件（新しいもの {clock(s.errors[0].at)} {s.errors[0].where}）
            </p>
            <Fold open={openErrors} onToggle={() => setOpenErrors(!openErrors)} openLabel="文言を見る" closeLabel="閉じる">
              <ul className="mt-list small mt-errors">
                {s.errors.map((e, i) => (
                  <li key={i}>
                    <b>
                      {clock(e.at)} {e.where}
                    </b>
                    <code>{e.message}</code>
                  </li>
                ))}
              </ul>
            </Fold>
            <div className="actions tight">
              <Button size="sm" onClick={() => void copy(s.errors.map((e) => `${e.at} ${e.where}：${e.message}`).join("\n")).then((ok) => say("エラーの記録", ok))}>
                エラーをコピー
              </Button>
            </div>
          </>
        ) : (
          <small className="set-help mt-fine">エラーはありません（アカウント 30日・定時処理と取得 7日）。</small>
        )}
        <small className="set-help">アプリが自分で残している記録です（Cloudflare のログより長く残ります）。管理者にだけ表示されます。</small>
      </section>

      {/* ⑤ 重なり */}
      <section className="set-group" aria-labelledby="mt-dup">
        <h3 id="mt-dup">重なり</h3>
        {s.lastDupCheck ? (
          <ul className="mt-list small">
            {s.lastDupCheck.result.map((d) => (
              <li key={d.name} className={d.n && !d.note ? "warn" : undefined}>
                {d.name}：{d.n ? `${d.n}（${d.examples.join("・")}）` : "0"}
                {d.n && d.note ? `（${d.note}）` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <small className="set-help">まだ確かめていません。</small>
        )}
        <small className="set-help">{s.lastDupCheck ? `${clock(s.lastDupCheck.at)} に確かめた結果。` : ""}読むだけで、何も消しません。</small>
        <div className="actions tight">
          <Button size="sm" busy={busy === "dup"} disabled={!!busy} onClick={dup}>
            {busy === "dup" ? "確かめています…" : "重なりを確かめる"}
          </Button>
        </div>
      </section>

      {/* ⑥ 表の点検（読むだけ） */}
      <section className="set-group" aria-labelledby="mt-audit">
        <h3 id="mt-audit">表の点検</h3>
        {s.lastAudit ? (
          <>
            <ul className="mt-list small">
              {s.lastAudit.result.links.map((l) => (
                <li key={l.name} className={l.n ? "warn" : undefined}>
                  {l.name}：{l.n}
                </li>
              ))}
            </ul>
            <Fold open={openTables} onToggle={() => setOpenTables(!openTables)} openLabel={`表ごとの行数（${s.lastAudit.result.tables.length}表）`} closeLabel="閉じる">
              <ul className="mt-list small mt-tables">
                {s.lastAudit.result.tables.map((t) => (
                  <li key={t.name}>
                    <code>{t.name}</code> {t.rows.toLocaleString()}
                  </li>
                ))}
              </ul>
            </Fold>
            <small className="set-help">{clock(s.lastAudit.at)} に点検した結果。</small>
          </>
        ) : (
          <small className="set-help">まだ点検していません。</small>
        )}
        <small className="set-help">表ごとの行数と、表どうしのつながり（値 → 発表 → 電文、記録 → 人）が切れていないかを数えます。読むだけで、何も消しません。</small>
        <div className="actions tight">
          <Button size="sm" busy={busy === "audit"} disabled={!!busy} onClick={audit}>
            {busy === "audit" ? "点検しています…" : "表を点検する"}
          </Button>
        </div>
      </section>

      {/* ⑦ 大きさ */}
      {s.room ? (
      <section className="set-group" aria-labelledby="mt-room">
        <h3 id="mt-room">大きさ</h3>
        <ul className="mt-list">
          <li>データベース：{s.room.d1Size ? `${mb(s.room.d1Size.bytes)}（${s.room.d1Size.percent}%）` : "—"}</li>
          <li>
            月の書き込みの見込み：{Math.round(s.room.d1WritesMonth.estimate / 1_000) / 10}万行（{s.room.d1WritesMonth.percent}%）・1日 {s.room.d1WritesMonth.rowsLastDay.toLocaleString()}行
          </li>
          <li>R2：{mb(s.room.r2.bytes)}（{s.room.r2.percentOfFree}%）</li>
          <li>
            定時処理：24時間で {s.room.cronRunsLastDay}/288 回{s.room.cronMissing ? `（記録の無い回 ${s.room.cronMissing}）` : ""}
          </li>
        </ul>
      </section>
      ) : null}
      {error ? <p className="warn">{error}</p> : null}
    </div>
  );
}

export function MaintenanceSheet({ onClose }: { onClose: () => void }) {
  return createPortal(
    <ModalSheet title="データの保守" onClose={onClose} className="maintenance-sheet">
      <MaintenanceBody />
    </ModalSheet>,
    document.body,
  );
}
