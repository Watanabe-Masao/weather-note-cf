// 管理者ページ（2026-11-24、渡辺さん「管理者ページの整理」）：管理者の機能を1つの入口にまとめ、4つに分ける。
//   運用：データの保守（今の状態・取得の様子・欠け・週の点検・原本の控え・エラー・重なり・表の点検・大きさ）
//   予報：予報が外れやすい型の確かめ（影の運用の記録・型ごとのこれまで・型にならなかったもの）、予報の履歴の取り込み
//   確認用：イベントの見出しの確かめ、研究用（テスト）の比べ板
//   ユーザー：ユーザーの追加・一覧、研究用データ、読み出しの記録
// 中身は前からのものを移しただけ（見張りの手順・「まとめてコピー」はそのまま）。

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { WeatherStore } from "../data/store";
import { ModalSheet } from "../ui/ModalSheet";
import { Segmented } from "../ui/kit";
import { EventPreviewSection, ResearchSection } from "../ui/Settings";
import { api } from "./account";
import { ForecastImportSection, UsersBody } from "./AdminSheet";
import { MaintenanceBody } from "./MaintenanceSheet";
import type { ForecastTypesResponse, TypeSummary } from "../../shared/forecastTypes";

type Tab = "ops" | "forecast" | "check" | "users";
const TABS: { id: Tab; label: string }[] = [
  { id: "ops", label: "運用" },
  { id: "forecast", label: "予報" },
  { id: "check", label: "確認用" },
  { id: "users", label: "ユーザー" },
];
const KEY = "weather-note:admin-tab";

function savedTab(): Tab {
  try {
    const t = localStorage.getItem(KEY);
    return TABS.some((x) => x.id === t) ? (t as Tab) : "ops";
  } catch {
    return "ops";
  }
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const STATUS: Record<TypeSummary["status"], string> = { pass: "合格", checking: "確かめ中", notYet: "まだ届かない" };
const WHEN = (t: TypeSummary) => {
  if (t.stage === "watch") return "様子を見る";
  if (t.id.startsWith("G-")) return t.status === "checking" ? "季節待ち（6〜8月）" : STATUS[t.status];
  if (t.id.startsWith("E-")) return t.status === "checking" ? "季節待ち（3・4・10・11月）" : STATUS[t.status];
  return STATUS[t.status];
};

/** 型にならなかったもの（FS-05・FS-06、PR #459）：確かめ方が正直であることの記録。 */
const REJECTED = [
  "前日の最高、降水確率70%以上：作る期間 31% → 確かめる期間 13%（続かなかった）",
  "4〜7日前、春に前の日より最低が2〜3℃下がる：45% → 26%",
  "最近の外れ方（FS-04 の指標）、臨時の発表：型として残らなかった",
  "降水確率50〜60%の空振り：型ではなく、降水確率の読み方として扱う",
  "予報の動き方の形（クラスター分析、FS-06）：新しい型は見つからず、外れやすい形は A・C・G と同じ所に出た",
];

function ForecastTypesSection() {
  const [s, setS] = useState<ForecastTypesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ForecastTypesResponse>("/api/admin/forecast-types").then(setS, (e) => setError((e as Error).message));
  }, []);
  if (!s) return error ? <p className="warn">{error}</p> : <p className="set-help">読み込んでいます…</p>;
  const last = s.runs[0];
  return (
    <>
      <section className="set-group" aria-labelledby="ad-shadow">
        <h3 id="ad-shadow">影の運用の記録</h3>
        <p className="set-lead">固定した型（{s.frozenAt}）に予報が当てはまるかを毎日（2時台）判定し、2日後に気象庁の観測で答え合わせします。画面には出しません。</p>
        <dl className="report">
          <dt>いちばん新しい回</dt>
          <dd>{last ? `${last.day} の発表：判定 ${last.judged}件・答え合わせ ${last.checked}件` : "まだありません（初回は 2時台）"}</dd>
          <dt>失敗</dt>
          <dd>{s.runs.some((r) => r.error) ? s.runs.filter((r) => r.error).map((r) => `${r.day}：${r.error}`).join("／") : "なし（直近14回）"}</dd>
          <dt>記録の始まり</dt>
          <dd>{s.firstJudged ? s.firstJudged.slice(0, 10) : "—"}</dd>
        </dl>
      </section>
      <section className="set-group" aria-labelledby="ad-types">
        <h3 id="ad-types">予報の型の確かめ</h3>
        <p className="set-lead">
          合格：当てはまった日の大外れが、ふだんの {s.pass.minRatio}倍以上・95%の幅の下の端が {s.pass.ciLowAbove} 超・{s.pass.minDays}日以上・向きが同じ側に半分より多い。合格した型だけを予報のそばに出します。説明と根拠は Project の「予報が外れやすい型」。
        </p>
        <ul className="ad-types">
          {s.types.map((t) => (
            <li key={t.id} className={t.status === "pass" ? "pass" : undefined}>
              <div className="ad-type-head">
                <b>{t.text}</b>
                <span className="badge">{WHEN(t)}</span>
              </div>
              <small>
                {t.leads.length > 1 ? `${t.leads[0]}〜${t.leads.at(-1)}日前` : `${t.leads[0]}日前`}・{t.item === "max" ? "最高" : t.item === "min" ? "最低" : "雨の見逃し"}・{t.fs05}・{t.id}
              </small>
              <small>
                期待：大外れ {t.expected.hitRate ? `${Math.round(t.expected.hitRate * 100)}%（ふだん ${Math.round(t.expected.baseRate * 100)}%）、` : ""}
                {t.expected.ratio.toFixed(2)}倍（{t.expected.ci[0].toFixed(2)}〜{t.expected.ci[1].toFixed(2)}）
                {t.expected.directionShare ? `、向き ${Math.round(t.expected.directionShare * 100)}%` : ""}
              </small>
              <small>
                これまで：当てはまり {t.matchedDays}日（{t.matched}件）・大外れ {pct(t.inRule.miss, t.inRule.n)}（ふだん {pct(t.outRule.miss, t.outRule.n)}）
                {t.ratio != null ? `・${t.ratio.toFixed(2)}倍` : ""}
                {t.ci ? `（${t.ci[0].toFixed(2)}〜${t.ci[1].toFixed(2)}）` : ""}
                {t.directionShare != null ? `・向き ${Math.round(t.directionShare * 100)}%` : ""}
              </small>
              <div className="ad-progress" role="img" aria-label={`合格まで ${Math.min(t.matchedDays, s.pass.minDays)} / ${s.pass.minDays}日`}>
                <i style={{ width: `${Math.min(100, (t.matchedDays / s.pass.minDays) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="set-group" aria-labelledby="ad-rejected">
        <h3 id="ad-rejected">型にならなかったもの</h3>
        <ul className="ad-rejected">
          {REJECTED.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Body({ store, station }: { store: WeatherStore | null; station: string }) {
  const [tab, setTab] = useState<Tab>(savedTab);
  const pick = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // 覚えられなくても、開くたびに「運用」から
    }
  };
  return (
    <div className="admin-page">
      <Segmented label="管理者ページの中身" options={TABS} value={tab} onChange={pick} />
      {tab === "ops" && <MaintenanceBody />}
      {tab === "forecast" && (
        <>
          <ForecastTypesSection />
          <ForecastImportSection />
        </>
      )}
      {tab === "check" && (
        <>
          <EventPreviewSection store={store} />
          <ResearchSection store={store} station={station} />
        </>
      )}
      {tab === "users" && <UsersBody />}
    </div>
  );
}

/** 設定の中から開くので、ページのいちばん上に描く（シートの中のシートは親に切られる）。 */
export function AdminPage({ store, station, onClose }: { store: WeatherStore | null; station: string; onClose: () => void }) {
  return createPortal(
    <ModalSheet title="管理者ページ" onClose={onClose} className="admin-page-sheet">
      <Body store={store} station={station} />
    </ModalSheet>,
    document.body,
  );
}
