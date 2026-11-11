// β③: the 同期キー in settings — make one, enter one from another device, see when it last synced,
// stop, or delete the server copy. No accounts: the key is the only way in, so it is shown in a
// form that is easy to copy and to compare between two screens.

import { useState } from "react";
import { formatKey, newSyncKey, normaliseKey } from "./sync";
import { sync, syncNow, useSync } from "./useSync";

const when = (ms: number) =>
  new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function SyncPanel() {
  const { state, running } = useSync();
  const [entering, setEntering] = useState(false);
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<null | "leave" | "erase">(null);
  const [problem, setProblem] = useState<string | null>(null);
  const typedKey = normaliseKey(typed);

  const copy = async (k: string) => {
    try {
      await navigator.clipboard.writeText(formatKey(k));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setShown(true); // the person can select it by hand
    }
  };

  if (!state) {
    return (
      <div className="set-row sync">
        <span className="set-label">
          記録の同期
          <small className="set-help">
            感じ方の記録をサーバーにも保存し、同じ同期キーを入れた端末どうしで共有します。アカウントは要りません。キーを知っている端末だけが読み書きでき、人ごとに別の保存場所に分かれます。
          </small>
        </span>
        {entering ? (
          <div className="sync-enter">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="ABCD-EFGH-…"
              aria-label="同期キー"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="actions tight">
              <button onClick={() => setEntering(false)}>やめる</button>
              <button className="primary" disabled={!typedKey} onClick={() => typedKey && sync.use(typedKey)}>
                このキーで同期
              </button>
            </div>
            {typed && !typedKey ? <small className="set-help">26文字の英字と数字（2〜7）です。ハイフンや空白はあってもなくても構いません。</small> : null}
          </div>
        ) : (
          <div className="actions tight">
            <button onClick={() => sync.use(newSyncKey())}>同期キーを作る</button>
            <button onClick={() => setEntering(true)}>キーを入力（別の端末から）</button>
          </div>
        )}
      </div>
    );
  }

  const key = formatKey(state.key);
  return (
    <div className="set-row sync">
      <span className="set-label">
        記録の同期
        <small className="set-help">
          別の端末でも［キーを入力］にこのキーを入れると、記録がそろいます。キーをなくすとサーバーの記録には戻れません（端末の記録は残ります）。人に教えないでください。
        </small>
      </span>
      <div className="sync-key">
        <code aria-label="同期キー">{shown ? key : key.replace(/[A-Z2-7]/g, (c, i) => (i < 4 ? c : "•"))}</code>
        <button onClick={() => setShown((v) => !v)}>{shown ? "隠す" : "表示"}</button>
        <button onClick={() => void copy(state.key)}>{copied ? "コピーしました" : "コピー"}</button>
      </div>
      <p className={state.error ? "sync-status warn" : "sync-status"} role="status">
        {running
          ? "同期しています…"
          : state.error
            ? state.error
            : state.lastSync
              ? `最後の同期 ${when(state.lastSync)}・サーバーに ${state.total ?? 0}件`
              : "まだ同期していません"}
      </p>
      {problem ? <p className="sync-status warn">{problem}</p> : null}
      <div className="actions tight sync-actions">
        <button className="sync-now" onClick={() => void syncNow()} disabled={running}>
          今すぐ同期
        </button>
        {confirm === "leave" ? (
          <button onClick={() => (sync.leave(), setConfirm(null))}>同期をやめる（記録は残ります）</button>
        ) : (
          <button onClick={() => setConfirm("leave")}>同期をやめる</button>
        )}
        {confirm === "erase" ? (
          <button
            className="danger"
            onClick={() =>
              void sync.erase().then((err) => {
                setProblem(err);
                setConfirm(null);
              })
            }
          >
            本当に消す（元に戻せません）
          </button>
        ) : (
          <button className="danger" onClick={() => setConfirm("erase")}>
            サーバーから消す
          </button>
        )}
      </div>
      {confirm === "erase" ? (
        <small className="set-help">サーバーにあるこのキーの記録をすべて消し、この端末の同期をやめます。この端末と他の端末の記録は残ります。</small>
      ) : null}
    </div>
  );
}
