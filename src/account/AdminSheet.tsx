// The administrator's screen: issue an account (the password is shown once), reissue a password,
// stop or restart an account, and export the research data (consenting people only, under research
// IDs) as CSV.

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { type Report, toCsv } from "../beta/reports";
import { ModalSheet } from "../ui/ModalSheet";
import { OnceSecret } from "./AccountSection";
import { api } from "./account";

interface Row {
  id: string;
  login_id: string;
  name: string | null;
  role: string;
  created_at: number;
  last_login: number | null;
  disabled_at: number | null;
  reports: number;
  research: number | null;
}

const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }) : "—");

/** The research rows as the usual report CSV, with the research ID as the first column. */
export function researchCsv(rows: { researchId: string; report: Report }[]): string {
  const linesOf = (list: Report[]) => toCsv(list).replace(/^\uFEFF/, "").split("\r\n");
  const head = linesOf([])[0];
  const live = rows.filter((r) => !r.report.deleted).sort((a, b) => (a.report.at < b.report.at ? -1 : a.report.at > b.report.at ? 1 : 0));
  return "\uFEFF" + [`research_id,${head}`, ...live.map((r) => `${r.researchId},${linesOf([r.report])[1]}`)].join("\r\n") + "\r\n";
}

/** Who exported research data, and when (#45). */
function ExportLog() {
  const [log, setLog] = useState<{ at: number; first: number; rows: number; dataset: string | null; admin: string | null }[] | null>(null);
  useEffect(() => {
    api<{ log: NonNullable<typeof log> }>("/api/admin/exports")
      .then((r) => setLog(r.log))
      .catch(() => setLog([]));
  }, []);
  if (!log?.length) return <small className="set-help">書き出しの記録はまだありません。</small>;
  return (
    <details className="admin-exports">
      <summary>書き出しの記録（直近 {log.length}回）</summary>
      <ul>
        {log.map((e, i) => (
          <li key={i}>
            {new Date(e.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}・{e.admin ?? "（削除された人）"}・{e.rows}件
            {e.first ? `（${e.first}件目から）` : ""}
            {e.dataset ? `・${e.dataset}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Body() {
  const [users, setUsers] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginId, setLoginId] = useState("");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");

  const load = useCallback(() => {
    api<{ users: Row[] }>("/api/admin/users")
      .then((r) => setUsers(r.users))
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api<{ loginId: string; password: string }>("/api/admin/users", { loginId, name });
      setSecret({ who: r.loginId, password: r.password });
      setLoginId("");
      setName("");
    });
  };

  const download = () =>
    void run(async () => {
      const all: { researchId: string; report: Report }[] = [];
      let offset: number | null = 0;
      while (offset != null) {
        const page: { rows: typeof all; next: number | null } = await api(`/api/admin/research?offset=${offset}`);
        all.push(...page.rows);
        offset = page.next;
      }
      const url = URL.createObjectURL(new Blob([researchCsv(all)], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `weather-note-research-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

  return (
    <div className="admin">
      <section className="set-group" aria-labelledby="admin-add">
        <h3 id="admin-add">ユーザーを追加</h3>
        <p className="set-lead">ログインIDを決めると、パスワードを作ります。パスワードは一度しか表示されないので、本人に渡してください。</p>
        <form className="login-form" onSubmit={add}>
          <label>
            <span>ログインID（英数字と . _ -、3〜32文字）</span>
            <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoCapitalize="none" spellCheck={false} required />
          </label>
          <label>
            <span>名前（管理用のメモ・任意）</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="actions tight">
            <button type="submit" className="primary" disabled={busy}>
              追加してパスワードを作る
            </button>
          </div>
        </form>
        {secret ? <OnceSecret label={`${secret.who} のパスワード（この画面でしか見られません）`} value={secret.password} note="閉じると二度と表示されません。忘れたときは「再発行」で作り直せます。" /> : null}
        {error ? <p className="warn">{error}</p> : null}
      </section>

      <section className="set-group" aria-labelledby="admin-users">
        <h3 id="admin-users">ユーザー</h3>
        {users == null ? (
          <p className="set-help">読み込んでいます…</p>
        ) : (
          <ul className="admin-users">
            {users.map((u) => (
              <li key={u.id} className={u.disabled_at ? "off" : ""}>
                <div>
                  <b>{u.login_id}</b>
                  {u.name ? <span>{u.name}</span> : null}
                  {u.role === "admin" ? <span className="admin-tag">管理者</span> : null}
                  {u.disabled_at ? <span className="admin-tag off">停止中</span> : null}
                </div>
                <small>
                  記録 {u.reports}件・研究 {u.research === 1 ? "協力" : "—"}・作成 {day(u.created_at)}・最後のログイン {day(u.last_login)}
                </small>
                <div className="actions tight">
                  {confirm === `reset:${u.id}` ? (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const r = await api<{ password: string }>("/api/admin/users/reset", { id: u.id });
                          setSecret({ who: u.login_id, password: r.password });
                        })
                      }
                    >
                      作り直す（今のパスワードは使えなくなります）
                    </button>
                  ) : (
                    <button onClick={() => setConfirm(`reset:${u.id}`)}>パスワードを再発行</button>
                  )}
                  {u.role !== "admin" ? (
                    confirm === `stop:${u.id}` ? (
                      <button className="danger" disabled={busy} onClick={() => void run(() => api("/api/admin/users/disable", { id: u.id, disabled: !u.disabled_at }).then(() => {}))}>
                        {u.disabled_at ? "再開する" : "停止する（すぐにログアウトされます）"}
                      </button>
                    ) : (
                      <button onClick={() => setConfirm(`stop:${u.id}`)}>{u.disabled_at ? "再開" : "停止"}</button>
                    )
                  ) : null}
                  {u.role !== "admin" && confirm !== `delete:${u.id}` && (
                    <button className="danger" onClick={() => (setConfirm(`delete:${u.id}`), setTyped(""))}>
                      削除
                    </button>
                  )}
                </div>
                {confirm === `delete:${u.id}` && (
                  <div className="admin-delete">
                    <small className="set-help">
                      {u.login_id} のアカウントと、その人の記録・通知の設定・同意の履歴をすべて消します。元に戻せません。研究用に書き出したデータからも外すよう、次の書き出しで知らせます。確認のため、ログインIDを入れてください。
                    </small>
                    <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={u.login_id} autoCapitalize="none" aria-label="削除するログインID" />
                    <div className="actions tight">
                      <button onClick={() => setConfirm(null)}>やめる</button>
                      <button
                        className="danger"
                        disabled={busy || typed.trim().toLowerCase() !== u.login_id.toLowerCase()}
                        onClick={() => void run(() => api("/api/admin/users/delete", { id: u.id, confirm: typed }).then(() => {}))}
                      >
                        削除する
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="set-group" aria-labelledby="admin-research">
        <h3 id="admin-research">研究用データ</h3>
        <p className="set-lead">研究への協力に同意している人の記録だけを、研究用の番号（名前・ログインIDとは別）で書き出します。列は感じ方の記録のCSVと同じで、先頭に research_id が付きます。</p>
        <div className="actions tight">
          <button onClick={download} disabled={busy}>
            研究用CSVを書き出す
          </button>
        </div>
        <ExportLog />
      </section>
    </div>
  );
}

/** Opened from inside the settings sheet, so it is drawn at the page's top level (a sheet inside
 *  a sheet would be clipped and moved by its parent). */
export function AdminSheet({ onClose }: { onClose: () => void }) {
  return createPortal(
    <ModalSheet title="ユーザー管理" onClose={onClose} className="admin-sheet">
      <Body />
    </ModalSheet>,
    document.body,
  );
}
