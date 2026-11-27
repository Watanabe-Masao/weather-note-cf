// Settings › アカウント: logging in with an issued ID and password, the first setup, the research
// consent, the sync status, the administrator's screen and logging out.

import { MyPhotosSection } from "./MyPhotos";
import { type FormEvent, useState } from "react";
import { DELETION_NOTE_KEY, deleteAccountAndLeave, syncNow, logOutAndLeave, useSync } from "../beta/useSync";
import { NotifySection } from "./NotifySection";
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

/**
 * 研究への協力（11/27 渡辺さん「どの研究に協力するかチェックボックスを入れ、入れたものだけ表示」）：研究ごとに選ぶ。
 * 入れた研究だけ、記録のシートに出る（肌感・空の写真）。肌感の研究の答えは前からのもの（kind 'research'）。
 */
const STUDIES = [
  {
    kind: "feel" as const,
    label: "肌感（感じ方の記録）",
    text: "あなたの感じ方の記録を、名前やログインIDと切り離した研究用の番号で、他の人の記録と合わせて分析します（肌感の中心とちょうどよい範囲の研究のため）。取り消すと、以後の分析から外れ、すでに研究用に書き出した写しからも消します。",
  },
  {
    kind: "sky" as const,
    label: "空の写真",
    text: "あなたが送る空の写真と、撮影時刻・写した方角・場所（約 1 km に丸めたもの）を、名前と切り離して、空の絵の答え合わせの研究に使います。",
  },
  {
    kind: "weather" as const,
    label: "今の天気",
    text: "あなたが選んだ今の天気（晴れ・曇り・雨なら強さ）と時刻・観測所を、名前と切り離して、予報や観測との答え合わせの研究に使います。肌感の記録や空の写真で選んだ天気も、ここに入ります。",
  },
];

function Research() {
  const { me } = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const none = { granted: false, version: null, at: null };
  const state = { feel: me.research, sky: me.researchSky ?? none, weather: me.researchWeather ?? none };
  const answer = (kind: "feel" | "sky" | "weather", v: boolean) => {
    setBusy(kind);
    setError(null);
    answerResearch(v, kind)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(null));
  };
  return (
    <div className="set-row">
      <span className="set-label">
        研究への協力
        <small className="set-help">協力する研究を選んでください。選んだものだけ、記録のシートに出ます。いつでも取り消せます。</small>
      </span>
      {STUDIES.map((st) => {
        const s = state[st.kind];
        return (
          <label key={st.kind} className="consent-check">
            <input type="checkbox" checked={s.granted} disabled={busy != null} onChange={(ev) => answer(st.kind, ev.target.checked)} />
            <span>
              <b>{st.label}</b>
              <small className="set-help">
                {st.text}
                {s.at ? `（${s.granted ? "同意" : "取り消し"} ${when(s.at)}）` : ""}
              </small>
            </span>
          </label>
        );
      })}
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

/** The person deletes their own account (#55). Confirmed with the password. */
function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <div className="actions tight">
        <button className="danger" onClick={() => setOpen(true)}>
          アカウントを削除
        </button>
      </div>
    );
  const go = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    deleteAccountAndLeave(password).catch((err) => (setError((err as Error).message), setBusy(false)));
  };
  return (
    <form className="admin-delete" onSubmit={go}>
      <small className="set-help">
        アカウントと、あなたの感じ方の記録・通知の設定・同意の履歴を、サーバーとこの端末からすべて消します（まだ送れていない記録も消えます。ログインする前にこの端末だけで作った記録は残ります）。元に戻せません。研究に協力していた場合は、書き出した研究用の写しからも消します。確認のため、パスワードを入れてください。
      </small>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label="パスワード" required />
      {error ? <p className="warn">{error}</p> : null}
      <div className="actions tight">
        <button type="button" onClick={() => (setOpen(false), setPassword(""), setError(null))}>
          やめる
        </button>
        <button type="submit" className="danger" disabled={busy || !password}>
          削除する
        </button>
      </div>
    </form>
  );
}

/** After an account deletion whose local clean-up did not finish: told once (review 2026-11-12). */
function DeletionNote() {
  const [note] = useState(() => {
    try {
      const n = localStorage.getItem(DELETION_NOTE_KEY);
      if (n) localStorage.removeItem(DELETION_NOTE_KEY);
      return n;
    } catch {
      return null;
    }
  });
  return note ? <p className="warn">{note}</p> : null;
}

/** `station`: the one chosen in the settings (its sun names the notification times). */
export function AccountSection({ station }: { station: string }) {
  const { me, status } = useAccount();
  const [leaving, setLeaving] = useState<null | "ask" | "busy">(null);
  const [kept, setKept] = useState<number | null>(null);
  return (
    <section className="set-group" aria-labelledby="set-account">
      <h3 id="set-account">アカウント</h3>
      {!me ? (
        <>
          <p className="set-lead">
            感じ方の記録と「肌感の中心とちょうどよい範囲 β」は、発行されたIDとパスワードでログインした人だけが使えます。天気の表示はログインなしで使えます。
            {kept ? ` 送れなかった記録 ${kept}件はこの端末に残しています（次のログインで送ります）。` : ""}
          </p>
          <DeletionNote />
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
          <NotifySection station={station} />
          <Research />
          {me.role === "admin" ? <MyPhotosSection /> : null}
          {me.role !== "admin" ? <DeleteAccount /> : null}
        </>
      )}
    </section>
  );
}
