// The administrator's screen: issue an account (the password is shown once), reissue a password,
// stop, restart or delete an account, open the research analysis (in the app, nothing stored), and
// issue the token a computer needs to take the research data out (research/data, optional). The
// row-level data is never downloaded here, so a withdrawal reaches every copy (#55).

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ModalSheet } from "../ui/ModalSheet";
import { OnceSecret } from "./AccountSection";
import { ResearchSheet } from "./ResearchSheet";
import { MIN_PEOPLE } from "../research/analysis";
import { api, needsReauth } from "./account";
import { ReauthForm } from "./ReauthForm";

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

/** The export token for research/data (#55): read-only, 24 hours, shown once, revocable. */
function ExportToken() {
  const [active, setActive] = useState<{ expiresAt: number } | null | undefined>(undefined);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ active: { expiresAt: number } | null }>("/api/admin/export-token")
      .then((r) => setActive(r.active))
      .catch(() => setActive(null));
  }, []);
  const [reauth, setReauth] = useState<boolean | null>(null);
  const ask = (revoke: boolean) => {
    setBusy(true);
    setError(null);
    api<{ token?: string; active: { expiresAt: number } | null }>("/api/admin/export-token", revoke ? { revoke: true } : {})
      .then((r) => (setActive(r.active), setToken(r.token ?? null)))
      .catch((e) => (needsReauth(e) ? setReauth(revoke) : setError((e as Error).message)))
      .finally(() => setBusy(false));
  };
  if (reauth != null) return <ReauthForm lead="取り出し用のトークンを作るには、パスワードをもう一度入れてください（15分有効）。" onDone={() => (setReauth(null), ask(reauth))} />;
  const until = (ms: number) => new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <small className="set-help">{active ? `有効なトークンがあります（${until(active.expiresAt)} まで）。作り直すと、今のトークンは使えなくなります。` : active === null ? "有効なトークンはありません。" : ""}</small>
      <div className="actions tight">
        <button onClick={() => ask(false)} disabled={busy}>
          {active ? "作り直す" : "取り出し用のトークンを作る"}
        </button>
        {active ? (
          <button className="danger" onClick={() => ask(true)} disabled={busy}>
            無効にする
          </button>
        ) : null}
      </div>
      {token ? <OnceSecret label="取り出し用のトークン（この画面でしか見られません）" value={token} note="research/data で WN_TOKEN に入れて npm run export を実行します。24時間で使えなくなります。使い終わったら「無効にする」を押してください。" /> : null}
      {error ? <p className="warn">{error}</p> : null}
    </>
  );
}

/** Who exported research data, and when (#45). */
function ExportLog() {
  const [log, setLog] = useState<{ at: number; path: string; first: number; rows: number; dataset: string | null; admin: string | null }[] | null>(null);
  useEffect(() => {
    api<{ log: NonNullable<typeof log> }>("/api/admin/exports")
      .then((r) => setLog(r.log))
      .catch(() => setLog([]));
  }, []);
  if (!log?.length) return <small className="set-help">読み出しの記録はまだありません。</small>;
  return (
    <details className="admin-exports">
      <summary>読み出しの記録（直近 {log.length}回）</summary>
      <ul>
        {log.map((e, i) => (
          <li key={i}>
            {new Date(e.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}・{e.admin ?? "（削除された人）"}・{e.path === "/api/admin/analysis" ? "アプリで分析" : "パソコンへ取り出し"}・{e.rows}件
            {e.first ? "（続きのページ）" : ""}
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
  const [analysis, setAnalysis] = useState(false);

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
        <p className="set-lead">
          研究への協力に同意している人の記録だけを、研究用の番号（名前・ログインIDとは別）で、このアプリの中で集計します。開くたびにサーバーの最新の記録から計算し、端末には保存しません（撤回した人は次に開いたとき自動で外れます）。一人ひとりの値は出さず、外に共有できるのは{MIN_PEOPLE}人以上の集計だけです。
        </p>
        <div className="actions tight">
          <button className="primary" onClick={() => setAnalysis(true)}>
            研究用の分析を開く
          </button>
        </div>
        {analysis ? <ResearchSheet onClose={() => setAnalysis(false)} /> : null}
        <details className="admin-exports">
          <summary>パソコンで詳しく分析するとき（任意）</summary>
          <p className="set-help">パソコンの research/data の手順（DuckDB）で取り出すときだけ、取り出し用のトークンを使います。普段は要りません。行ごとのデータはそのパソコンの外に出さないでください。</p>
          <ExportToken />
        </details>
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
