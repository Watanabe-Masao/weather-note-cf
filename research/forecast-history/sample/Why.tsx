// 空きの理由（値なし・項目なし・記録なし など）や補足を、押すと出す形（docs/design-system.md 4.2）。
// スマホでは title 属性が読めないので、押したら画面の下に1行の説明を出す。閉じるのは ×（44px）。

import { createContext, type ReactNode, useContext, useState } from "react";

export interface Note {
  /** 何の空きか（値なし・項目なし・記録なし …）。 */
  title: string;
  text: string;
}

const Ctx = createContext<{ show: (n: Note | null) => void; current: Note | null }>({ show: () => {}, current: null });

export function WhyProvider({ children }: { children: ReactNode }) {
  const [note, setNote] = useState<Note | null>(null);
  return (
    <Ctx.Provider value={{ show: setNote, current: note }}>
      {children}
      {note && (
        <div className="fh-why" role="status" aria-live="polite">
          <p>
            <b>{note.title}</b>
            {note.text}
          </p>
          <button type="button" className="fh-why-close" aria-label="説明を閉じる" onClick={() => setNote(null)}>
            ×
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** 押すと理由が出るもの。見た目は中身のまま、押せる範囲は 44px（CSS の ::after）。 */
export function Why({ note, className = "", children, fill = false }: { note: Note; className?: string; children: ReactNode; fill?: boolean }) {
  const { show, current } = useContext(Ctx);
  const on = current === note || (current?.title === note.title && current?.text === note.text);
  return (
    <button
      type="button"
      className={`fh-why-btn${fill ? " fill" : ""}${on ? " on" : ""} ${className}`}
      aria-label={`${note.title}：${note.text}`}
      aria-expanded={on}
      onClick={(e) => {
        e.stopPropagation();
        show(on ? null : note);
      }}
    >
      {children}
    </button>
  );
}

export const NOTE = {
  none: { title: "値なし", text: "この発表にこの項目はあるが、気象庁が値を出していない。" },
  absent: { title: "項目なし", text: "この発表には、この項目がない。" },
  out: { title: "対象期間外", text: "この発表は、この日・この時間帯を予報していない（発表の時点で過ぎていた、または先すぎる）。" },
  reliability: { title: "信頼度", text: "気象庁の週間天気予報の信頼度（A・B・C）。アプリの信頼度とは別。" },
} satisfies Record<string, Note>;
