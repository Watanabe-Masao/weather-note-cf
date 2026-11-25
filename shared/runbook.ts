// 障害とイレギュラーの手引き（docs/runbook.md）の番号 (2026-11-18 渡辺さん「障害時対応とイレギュラーの対応を
// 仕組みで回す」)：知らせ（毎時の見張り・予報と台風の見張り・毎朝の点検・GitHub の監視の issue）の1つ1つに、
// 手引きのどの手順で対応するかを添える。知らせの key（shared/healthJudge.ts・forecastWatch.ts・typhoonWatch.ts）
// から引く。新しい key を足したら、ここと手引きに手順を足す（test/runbook.test.ts が見張る）。

/** 重さ：S1 取り戻せなくなる（期限がある）、S2 止まっているが取り戻せる、S3 注意（余裕・無駄）。 */
export type Severity = "S1" | "S2" | "S3";

export interface RunbookEntry {
  code: string;
  title: string;
  severity: Severity;
  /** この手順で受ける知らせの key（`:` の前まで。`alert:missing:VPFD51` は `alert:missing`）。 */
  keys: string[];
}

export const RUNBOOK: RunbookEntry[] = [
  { code: "R-01", title: "予報の電文が取れない・届かない", severity: "S1", keys: ["forecastStale", "forecastGap", "alert:fetch", "alert:missing", "fetchFailures"] },
  { code: "R-02", title: "台風の電文が取れない・読めない", severity: "S1", keys: ["typhoonStale", "alert:collector", "alert:json", "alert:mismatch", "alert:problems"] },
  { code: "R-03", title: "雨雲レーダー・解析雨量が保存できない", severity: "S1", keys: ["radarStale"] },
  { code: "R-04", title: "警報・注意報の電文が保存できない", severity: "S1", keys: ["warningStale"] },
  { code: "R-05", title: "天気図・長い先の予報・アメダスの観測・空気質が保存できない", severity: "S2", keys: ["chartsStale", "longRangeStale", "amedasStale", "airStale", "airForecastStale", "soramameStale"] },
  { code: "R-06", title: "定時処理が抜ける・失敗する・遅い", severity: "S2", keys: ["cronRuns", "cronFailed", "cronSlow"] },
  { code: "R-07", title: "アカウントの処理（同期・通知・管理）の失敗", severity: "S2", keys: ["accountErrors"] },
  { code: "R-08", title: "電文が読めない・たまる", severity: "S2", keys: ["unparsed", "parseFailed"] },
  { code: "R-09", title: "余裕", severity: "S3", keys: ["d1Size", "d1Writes", "r2", "cpuP99", "month", "usage"] },
  { code: "R-10", title: "過去の記録の取り込み", severity: "S3", keys: ["importUnknown", "import"] },
  { code: "R-11", title: "取り戻せない欠けが出た", severity: "S2", keys: ["dataLost"] },
  { code: "R-12", title: "週の点検が止まった・抜けが見つかった", severity: "S3", keys: ["weeklyAuditStale"] },
  { code: "R-13", title: "原本の控え（GitHub）がたまる", severity: "S3", keys: ["offsiteBehind"] },
];

/** 知らせの key から手順を引く（`alert:missing:VPFD51` → `alert:missing`、`cronFailed:notify` → `cronFailed`）。 */
export function runbookOf(key: string): RunbookEntry | null {
  const parts = key.split(":");
  const candidates = parts[0] === "alert" ? [`alert:${parts[1]}`] : [parts[0]];
  return RUNBOOK.find((e) => e.keys.some((k) => candidates.includes(k))) ?? null;
}

/** 知らせの1行に添える「（手順 R-03・S1）」。手順が無い key は「（手順 なし：手引きに足す）」。 */
export function runbookTag(key: string): string {
  const e = runbookOf(key);
  return e ? `（手順 ${e.code}・${e.severity}）` : "（手順 なし：手引きに足す）";
}
