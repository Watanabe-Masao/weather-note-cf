// The research analysis, inside the app (iPhone only, no computer). Each opening reads the
// consenting people's reports from the server into memory and computes the aggregates here;
// nothing is stored on the device, so a withdrawal or a deletion reaches the next opening by
// itself. Only aggregates are shown — never one person's values — and only aggregates of
// MIN_PEOPLE or more people can be shared out of the iPhone.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Learning } from "../beta/comfort";
import { analyse, byPerson, type Cell, learningStateOf, MIN_PEOPLE, type Row, shareable, sharedCsv } from "../research/analysis";
import { ModalSheet } from "../ui/ModalSheet";
import { api } from "./account";

type Load = { phase: "reading"; got: number } | { phase: "ready"; rows: Row[]; at: number } | { phase: "error"; message: string };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }) : "—");

function show(v: Cell["value"]) {
  if (v == null) return "—";
  return typeof v === "number" ? String(v) : v;
}

function Body() {
  const [load, setLoad] = useState<Load>({ phase: "reading", got: 0 });
  const [fitted, setFitted] = useState<Map<string, Learning>>(new Map());
  const [note, setNote] = useState<string | null>(null);

  // Read every page into memory (never into storage).
  useEffect(() => {
    let stop = false;
    (async () => {
      const rows: Row[] = [];
      let after: string | null = null;
      do {
        const page: { rows: Row[]; next: string | null } = await api(`/api/admin/analysis${after ? `?after=${after}` : ""}`);
        rows.push(...page.rows);
        after = page.next;
        if (!stop) setLoad({ phase: "reading", got: rows.length });
      } while (after && !stop);
      if (!stop) setLoad({ phase: "ready", rows, at: Date.now() });
    })().catch((e) => !stop && setLoad({ phase: "error", message: (e as Error).message }));
    return () => {
      stop = true;
    };
  }, []);

  // Learning states: one fit per person, a person at a time so the screen stays responsive.
  useEffect(() => {
    if (load.phase !== "ready") return;
    let stop = false;
    const people = [...byPerson(load.rows).entries()];
    (async () => {
      const done = new Map<string, Learning>();
      for (const [who, reports] of people) {
        await new Promise((r) => setTimeout(r, 0));
        if (stop) return;
        done.set(who, learningStateOf(reports));
        setFitted(new Map(done));
      }
    })();
    return () => {
      stop = true;
    };
  }, [load]);

  const a = useMemo(() => (load.phase === "ready" ? analyse(load.rows, fitted) : null), [load, fitted]);
  const people = load.phase === "ready" ? byPerson(load.rows).size : 0;

  if (load.phase === "reading") return <p className="set-help">記録を読み込んでいます…（{load.got}件）</p>;
  if (load.phase === "error") return <p className="warn">{load.message}</p>;
  if (!a) return null;
  if (!a.people) return <p className="set-lead">研究への協力に同意している人の記録は、まだありません。</p>;

  const sections = [...new Set(a.cells.map((c) => c.section))];
  const canShare = a.people >= MIN_PEOPLE;
  const share = async () => {
    const csv = sharedCsv(a, new Date());
    if (!csv) return;
    const name = `weather-note-集計-${new Date().toISOString().slice(0, 10)}.csv`;
    const file = new File([csv], name, { type: "text/csv" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Weather Note 研究用の集計" });
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote("ファイルとして保存しました。");
  };

  return (
    <div className="research">
      <p className="set-lead">
        {a.people}人・{a.reports}件（{day(a.from)}〜{day(a.to)}）。開くたびにサーバーの最新の記録から計算し、この端末には保存しません。集計だけを示し、一人ひとりの値は出しません。
      </p>
      {fitted.size < people ? <p className="set-help">学習の段階を計算しています…（{fitted.size}/{people}人）</p> : null}
      {sections.map((s) => (
        <section key={s} className="set-group research-table">
          <h3>{s}</h3>
          <table>
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col">値</th>
                <th scope="col">人</th>
                <th scope="col">件</th>
              </tr>
            </thead>
            <tbody>
              {a.cells
                .filter((c) => c.section === s)
                .map((c) => (
                  <tr key={c.item} className={canShare && !shareable(c) ? "small" : undefined}>
                    <th scope="row">{c.item}</th>
                    <td>{show(c.value)}</td>
                    <td>{c.people}</td>
                    <td>{c.reports}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
      <section className="set-group">
        <h3>集計を共有</h3>
        {canShare ? (
          <>
            <p className="set-help">
              {MIN_PEOPLE}人以上の集計だけを CSV にして、共有シート（メール・ファイル・メモなど）で送れます。薄く表示している行（{MIN_PEOPLE}人未満）は入りません。
            </p>
            <div className="actions tight">
              <button onClick={() => void share()}>集計を共有する</button>
            </div>
            {note ? <small className="set-help">{note}</small> : null}
          </>
        ) : (
          <p className="set-help">
            協力している人が{MIN_PEOPLE}人になるまでは、本人が分かるおそれがあるため、集計も外に出せません（この画面で見るだけです）。
          </p>
        )}
      </section>
    </div>
  );
}

/** Opened from the administrator's screen, drawn at the page's top level like it. */
export function ResearchSheet({ onClose }: { onClose: () => void }) {
  return createPortal(
    <ModalSheet title="研究用の分析" onClose={onClose} className="research-sheet">
      <Body />
    </ModalSheet>,
    document.body,
  );
}
