// Settings › アカウント: logging in with an issued ID and password, the first setup, the research
// consent, the sync status, the administrator's screen and logging out.

import { type FormEvent, useState } from "react";
import { syncNow, logOutAndLeave, useSync } from "../beta/useSync";
import { AdminSheet } from "./AdminSheet";
import { NotifySection } from "./NotifySection";
import { Segmented } from "../ui/kit";
import { answerResearch, logIn, setUp, useAccount } from "./account";

const when = (ms: number) =>
  new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** A password shown once, with copy. */
export function OnceSecret({ label, value, note }: { label: string; value: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="once-secret" role="status">
      <small>{label}</small>
      <code>{value}</code>
      <div className="actions tight">
        <button
          onClick={() =>
            void navigator.clipboard
              .writeText(value)
              .then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))
              .catch(() => {})
          }
        >
          {copied ? "コピーしました" : "コピー"}
        </button>
      </div>
      <small className="set-help">{note}</small>
    </div>
  );
}

function LoginForm() {
  const { setup } = useAccount();
  const [mode, setMode] = useState<"login" | "setup">("login");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "setup") setMade(await setUp(code, loginId, name));
      else await logIn(loginId, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (made) return <OnceSecret label="あなたのパスワード（この画面でしか見られません）" value={made} note="控えておいてください。忘れたときは管理画面から再発行できます。" />;

  return (
    <form className="login-form" onSubmit={(e) => void submit(e)}>
      {mode === "setup" ? (
        <>
          <label>
            <span>初期設定コード</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required />
          </label>
          <label>
            <span>管理者のログインID</span>
            <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" autoCapitalize="none" required />
          </label>
          <label>
            <span>名前（任意）</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </label>
        </>
      ) : (
        <>
          <label>
            <span>ログインID</span>
            <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
          </label>
          <label>
            <span>パスワード</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
        </>
      )}
      {error ? <p className="warn">{error}</p> : null}
      <div className="actions tight">
        {setup ? (
          <button type="button" onClick={() => setMode(mode === "setup" ? "login" : "setup")}>
            {mode === "setup" ? "ログインに戻る" : "初期設定（最初の1回）"}
          </button>
        ) : null}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "確認しています…" : mode === "setup" ? "管理者を作る" : "ログイン"}
        </button>
      </div>
    </form>
  );
}

function Research() {
  const { me } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const granted = me.research.granted;
  const answer = (v: boolean) => {
    setBusy(true);
    setError(null);
    answerResearch(v)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="set-row">
      <span className="set-label">
        研究への協力
        <small className="set-help">
          同意すると、あなたの感じ方の記録を、名前やログインIDと切り離した研究用の番号で、他の人の記録と合わせて分析します（ちょうどよい温度と範囲の研究のため）。いつでも取り消せます。取り消すと、以後の分析から外れ、すでに研究用に書き出した写しからも消します。
          {me.research.at ? `（${granted ? "同意" : "取り消し"} ${when(me.research.at)}）` : ""}
        </small>
      </span>
      <Segmented
        label="研究への協力"
        value={granted ? "yes" : "no"}
        options={[
          { id: "yes", label: "協力する" },
          { id: "no", label: "協力しない" },
        ]}
        onChange={(v) => !busy && answer(v === "yes")}
      />
      {error ? <p className="warn">{error}</p> : null}
    </div>
  );
}

function SyncStatus() {
  const { state, running } = useSync();
  if (!state) return null;
  return (
    <div className="set-row inline">
      <span className="set-label">
        記録の保存
        <small className={state.error ? "set-help warn" : "set-help"} role="status">
          {running
            ? "サーバーと同期しています…"
            : state.error
              ? state.error
              : state.lastSync
                ? `サーバーに ${state.total ?? 0}件（最後の同期 ${when(state.lastSync)}）。同じIDでログインした端末どうしでそろいます。`
                : "まだ同期していません"}
        </small>
      </span>
      <button className="set-small" onClick={() => void syncNow()} disabled={running}>
        今すぐ同期
      </button>
    </div>
  );
}

export function AccountSection() {
  const { me, status } = useAccount();
  const [admin, setAdmin] = useState(false);
  const [leaving, setLeaving] = useState<null | "ask" | "busy">(null);
  const [kept, setKept] = useState<number | null>(null);
  return (
    <section className="set-group" aria-labelledby="set-account">
      <h3 id="set-account">アカウント</h3>
      {!me ? (
        <>
          <p className="set-lead">
            感じ方の記録と「ちょうどよい温度と範囲 β」は、発行されたIDとパスワードでログインした人だけが使えます。天気の表示はログインなしで使えます。
            {kept ? ` 送れなかった記録 ${kept}件はこの端末に残しています（次のログインで送ります）。` : ""}
          </p>
          {status === "unknown" ? <p className="set-help">確認しています…</p> : <LoginForm />}
        </>
      ) : (
        <>
          <div className="set-row inline">
            <span className="set-label">
              ログイン中
              <small className="set-help">
                {me.name ? `${me.name}（${me.loginId}）` : me.loginId}
                {me.role === "admin" ? "・管理者" : ""}
              </small>
            </span>
            {leaving === "ask" ? (
              <button
                className="set-small"
                onClick={() => {
                  setLeaving("busy");
                  void logOutAndLeave().then((r) => (setKept(r.kept), setLeaving(null)));
                }}
              >
                ログアウトする
              </button>
            ) : (
              <button className="set-small" disabled={leaving === "busy"} onClick={() => setLeaving("ask")}>
                ログアウト
              </button>
            )}
          </div>
          {leaving === "ask" ? <small className="set-help">ログアウトすると、サーバーに保存済みの記録はこの端末から消えます（サーバーには残り、再ログインで戻ります）。</small> : null}
          <SyncStatus />
          <NotifySection />
          <Research />
          {me.role === "admin" ? (
            <div className="actions tight">
              <button onClick={() => setAdmin(true)}>ユーザー管理</button>
            </div>
          ) : null}
          {admin ? <AdminSheet onClose={() => setAdmin(false)} /> : null}
        </>
      )}
    </section>
  );
}
