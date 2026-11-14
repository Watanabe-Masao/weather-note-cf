// 取得できなかったもの: what the status bar's "N日分を取得できませんでした" is about — for each day,
// which values (the day's or the hours'), from where, why, when, when it is tried again on its own,
// and which part of the screen wanted it. Each can be tried again on its own, or all at once.

import type { Failure, WeatherStore } from "../data/store";
import { Button, DayLabel } from "./kit";
import { ModalSheet } from "./ModalSheet";

/** Where the values come from, by the request that failed. */
const SOURCE: [string, string][] = [
  ["daily:", "気象庁の日別の表（1か月分）"],
  ["recent:", "アメダスの速報（直近2日）"],
  ["hourly:", "気象庁の時間別の表"],
  ["forecast:", "予報（Open-Meteo）"],
  ["current:", "今日の観測（気象庁の10分値）"],
];
const sourceOf = (task: string) => SOURCE.find(([p]) => task.startsWith(p))?.[1] ?? task;

/** What the screen wanted it for, by the requester. */
const PURPOSE: Record<string, string> = {
  view: "表に出ている7日",
  "view-ahead": "表の先読み（前後の日）",
  presets: "比較のしかたの候補（先読み）",
  calendar: "カレンダー",
  conditions: "条件から選ぶ",
  sheet: "時間帯グラフ",
  table: "表の肌感（時間ごとの値から）",
  "hour-average": "時間帯グラフの手前の平均",
  feelmap: "肌感マップ",
  "light-trend": "日照の移り変わり",
  report: "記録",
  "report-baseline": "記録（最近の基準）",
  "summary-baseline": "要約の β（最近の基準）",
  "chart-baseline": "日別グラフの β（最近の基準）",
  season: "肌感の季節の補正",
  "sun-test": "確認用の画面",
};
const purposeOf = (owner: string) => PURPOSE[owner] ?? (owner.includes("baseline") ? "β の最近の基準" : "そのほかの計算");

const clock = (ms: number) => new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Tokyo" });
function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  return `${Math.floor(s / 3600)}時間前`;
}

export function FailureSheet({ store, onClose }: { store: WeatherStore | null; onClose: () => void }) {
  const list = store?.failures() ?? [];
  const now = Date.now();
  return (
    <ModalSheet title="取得できなかったもの" onClose={onClose} className="failure-sheet">
      <div className="failure-face">
        {list.length === 0 ? (
          <p className="hint">いまは取得できていないものはありません。</p>
        ) : (
          <>
            <ul className="failure-list">
              {list.map((f) => (
                <FailureItem key={`${f.hourly ? "h" : "d"}:${f.station}/${f.date}`} f={f} now={now} onRetry={() => store?.retryDay(f.station, f.date)} />
              ))}
            </ul>
            {/* The next step here: try them all. Each row's own 再試行 is secondary. */}
            <Button kind="primary" block className="failure-all" onClick={() => store?.retryAll()}>
              すべて再試行
            </Button>
          </>
        )}
        <p className="failure-note">再試行しなくても、少し時間をおいて自動でもう一度取りに行きます。日付が変わると、前の日の失敗は消えて取り直します。</p>
      </div>
    </ModalSheet>
  );
}

function FailureItem({ f, now, onRetry }: { f: Failure; now: number; onRetry: () => void }) {
  return (
    <li className="failure-item">
      <div className="failure-head">
        <b>
          <DayLabel date={f.date} year />
        </b>
        <span className="failure-kind">{f.hourly ? "時間ごとの値" : "その日の値"}</span>
        <Button size="sm" onClick={onRetry}>
          再試行
        </Button>
      </div>
      <dl className="failure-facts">
        <dt>理由</dt>
        <dd>{f.message}</dd>
        <dt>取り先</dt>
        <dd>{sourceOf(f.task)}</dd>
        <dt>使う所</dt>
        <dd>{f.wantedBy.length ? [...new Set(f.wantedBy.map(purposeOf))].join("・") : "いまは使っていない（前に開いた画面）"}</dd>
        <dt>失敗</dt>
        <dd className="num">
          {clock(f.at)}（{ago(f.at, now)}）
        </dd>
        <dt>次の自動</dt>
        <dd className="num">{f.retryAt && f.retryAt > now ? `${clock(f.retryAt)}ごろ` : "まもなく"}</dd>
      </dl>
    </li>
  );
}
