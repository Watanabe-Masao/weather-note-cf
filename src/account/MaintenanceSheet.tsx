// データの保守（管理者だけ、2026-11-19 渡辺さん「日々の運用で使いやすいように」）。
//
// 毎日の運用の順に並べる：①今の状態（見張りと同じ判定。異常・注意の行と手順の番号）と「まとめてコピー」（このまま
// メインのスレッドに貼れる）、②取得の様子（取り直しのボタンは要る段だけ）、③欠け、④エラーの記録（文言つき、コピーできる）、
// ⑤重なりを確かめる（読むだけ）、⑥表の点検（行数とつながり、読むだけ）、⑦大きさ。何も消さない。サーバーは worker/src/maintenance.ts・refetch.ts。

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ModalSheet } from "../ui/ModalSheet";
import { Button, Fold } from "../ui/kit";
import { api } from "./account";

type Stage = { id: string; name: string; reach: string; lastOk: string | null; waiting: number | null; left: number; available: boolean; needed: boolean; why: string[]; last: { at: string; ok: boolean; detail: string } | null };
type Series = { expected: number; kept: number; pendingCount: number; lostCount: number; absentCount?: number; pending: string[]; lost: string[]; absent?: string[] };
type Dup = { name: string; n: number; examples: string[]; note?: string };
type Summary = {
  at: string;
  failed?: { part: string; message: string }[];
  judged: { problems: { key: string; text: string }[]; notes: { key: string; text: string }[] };
  refetch: { perHour: number; stages: Stage[] };
  completeness?: { forecast: Record<string, Series>; radar: Record<string, Series>; lostAll: { source: string; n: number }[]; absentAll?: { source: string; n: number }[] };
  errors: { at: string; where: string; message: string }[];
  room: null | { d1Size: { bytes: number; percent: number } | null; d1WritesMonth: { estimate: number; percent: number; rowsLastDay: number }; r2: { bytes: number; percentOfFree: number }; cronRunsLastDay: number; cronMissing: number };
  lastDupCheck: { at: string; result: Dup[] } | null;
  lastAudit?: { at: string; result: { tables: { name: string; rows: number }[]; links: { name: string; n: number }[] } } | null;
};

const NAME: Record<string, string> = { VPFD51: "府県天気予報", VPFW50: "府県週間天気予報", hrpns: "雨雲レーダー", rasrf: "解析雨量" };
const clock = (iso: string) => {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
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

function Body() {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [openErrors, setOpenErrors] = useState(false);
  const [openGaps, setOpenGaps] = useState(false);
  const [openTables, setOpenTables] = useState(false);
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
  const { problems, notes } = s.judged;
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
        <small className="set-help">{clock(s.at)} の時点。毎時の見張りと同じ判定です。手順の番号は障害の手引き（docs/runbook.md）。</small>
        <div className="actions tight">
          <Button size="sm" onClick={() => void copy(digest(s)).then((ok) => say("まとめ", ok))}>
            まとめてコピー
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
      <Body />
    </ModalSheet>,
    document.body,
  );
}
