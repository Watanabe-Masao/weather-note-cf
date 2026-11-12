// The research analysis, inside the app (iPhone only, no computer). Each opening reads the
// consenting people's reports from the server into memory and computes the aggregates here;
// nothing is stored on the device, so a withdrawal or a deletion reaches the next opening by
// itself. Only aggregates are shown — never one person's values — and only aggregates of
// MIN_PEOPLE or more people can be shared out of the iPhone.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { analyse, byPerson, type Cell, compareSettings, MIN_PEOPLE, type Row, shareable, sharedCsv } from "../research/analysis";
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

  const base = useMemo(() => (load.phase === "ready" ? analyse(load.rows) : null), [load]);
  // comfort-3 against comfort-4 on the same reports (#54): slow, so only on request, a person at a time.
  const [cmp, setCmp] = useState<{ done: number; of: number; per: { n: number; rps3: number; rps4: number; ref: number }[] } | null>(null);
  const runCompare = async () => {
    if (load.phase !== "ready") return;
    const people = [...byPerson(load.rows).values()];
    const per: { n: number; rps3: number; rps4: number; ref: number }[] = [];
    setCmp({ done: 0, of: people.length, per });
    for (const [i, list] of people.entries()) {
      await new Promise((r) => setTimeout(r, 0));
      const c = compareSettings(list);
      if (c.n) per.push(c);
      setCmp({ done: i + 1, of: people.length, per: [...per] });
    }
  };
  const a = useMemo(() => {
    if (!base || !cmp || cmp.done < cmp.of || !cmp.per.length) return base;
    const n = cmp.per.reduce((s, c) => s + c.n, 0);
    const pooled = (k: "rps3" | "rps4" | "ref") => Math.round((cmp.per.reduce((s, c) => s + c[k] * c.n, 0) / n) * 1000) / 1000;
    const perPerson = (k: "rps3" | "rps4" | "ref") => Math.round((cmp.per.reduce((s, c) => s + c[k], 0) / cmp.per.length) * 1000) / 1000;
    const section = "comfort-3 と comfort-4（同じ記録を、それより前の記録だけで予測。RPS）";
    const extra: Cell[] = (
      [
        ["comfort-3（重みなし）", "rps3"],
        ["comfort-4（続けて記録したものを少なめに）", "rps4"],
        ["基準（それまでの答えの割合）", "ref"],
      ] as const
    ).flatMap(([item, k]) => [
      { section, item: `${item}・件数で平均`, value: pooled(k), people: cmp.per.length, reports: n },
      { section, item: `${item}・人ごとに平均`, value: perPerson(k), people: cmp.per.length, reports: n },
    ]);
    return { ...base, cells: [...base.cells, ...extra] };
  }, [base, cmp]);

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
        <h3>comfort-3 と comfort-4 を同じ記録で比べる</h3>
        <p className="set-help">一人ずつ、最近の10件を、それより前の記録だけで2通りに学び直して予測します（実データでの採用の確認、#54）。1人あたり十数秒かかります。</p>
        {cmp && cmp.done < cmp.of ? (
          <p className="set-help">
            計算しています…（{cmp.done}/{cmp.of}人）
          </p>
        ) : (
          <div className="actions tight">
            <button onClick={() => void runCompare()}>{cmp ? "もう一度計算する" : "計算する"}</button>
          </div>
        )}
      </section>
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
