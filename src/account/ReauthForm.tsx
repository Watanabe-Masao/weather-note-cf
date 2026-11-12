// The password typed again before the research data (#86): valid for 15 minutes on this session.

import { type FormEvent, useState } from "react";
import { api } from "./account";

export function ReauthForm({ onDone, lead }: { onDone: () => void; lead?: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    api("/api/admin/reauth", { password })
      .then(() => onDone())
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusy(false));
  };
  return (
    <form className="login-form" onSubmit={submit}>
      <p className="set-help">{lead ?? "研究用のデータ（協力している全員の記録）を開くには、パスワードをもう一度入れてください。15分のあいだは聞きません。"}</p>
      <label>
        <span>パスワード</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error ? <p className="warn">{error}</p> : null}
      <div className="actions tight">
        <button type="submit" className="primary" disabled={busy || !password}>
          確かめる
        </button>
      </div>
    </form>
  );
}
