// #45: quality checks of the analysis tables (SQL). Prints what to look at before analysing.
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_FILE } from "./common";

const c = await (await DuckDBInstance.create(DB_FILE)).connect();
const show = async (title: string, sql: string) => {
  console.log(`\n## ${title}`);
  console.table((await c.runAndReadAll(sql)).getRowObjectsJson());
};
await show("データセット", "SELECT dataset_id, strftime(exported_at, '%Y-%m-%d %H:%M') AS exported_at, n_reports, n_people, n_purged, n_trimmed, left(hash, 12) AS hash FROM datasets ORDER BY exported_at");
await show("尺度の版", "SELECT dataset_id, scale_version, count(*) AS n FROM sensation_reports GROUP BY ALL ORDER BY ALL");
await show("学習に使わない記録（理由ごと）", "SELECT dataset_id, coalesce(excluded_reason, '（使う）') AS reason, count(*) AS n FROM sensation_reports GROUP BY ALL ORDER BY ALL");
await show("気温の状態", "SELECT status, count(*) AS n, round(avg(lag_min)) AS mean_lag_min FROM weather_snapshots GROUP BY ALL ORDER BY ALL");
await show("確率の合計が1から外れる予測", "SELECT dataset_id, report_id, p0+p1+p2+p3+p4+p5+p6 AS total FROM prediction_snapshots WHERE abs(p0+p1+p2+p3+p4+p5+p6 - 1) > 0.05");
await show("予測の版", "SELECT model_version, count(*) AS n FROM prediction_snapshots GROUP BY ALL ORDER BY ALL");
await show("同じ記録の重複", "SELECT dataset_id, report_id, count(*) AS n FROM sensation_reports GROUP BY ALL HAVING n > 1");
await show("範囲外の答え（-3〜3 以外）", "SELECT dataset_id, report_id, sensation FROM sensation_reports WHERE sensation NOT BETWEEN -3 AND 3");
await show("天気の記録がない答え", "SELECT r.dataset_id, r.report_id FROM sensation_reports r LEFT JOIN weather_snapshots w USING (dataset_id, report_id) WHERE w.temp IS NULL");
await show("答えより後に作られた予測", "SELECT r.dataset_id, r.report_id FROM sensation_reports r JOIN prediction_snapshots p USING (dataset_id, report_id) WHERE p.predicted_at > r.reported_at + INTERVAL 5 MINUTE");
await show("モデルの計算（直近5回）", "SELECT run_id, dataset_id, model_version, code_commit, strftime(started_at, '%Y-%m-%d %H:%M') AS started FROM model_runs ORDER BY started_at DESC LIMIT 5");
await show("評価（直近の計算・人ごと）", "SELECT research_id, metric, round(value, 3) AS value, sample_count FROM evaluation_results WHERE run_id = (SELECT run_id FROM model_runs ORDER BY started_at DESC LIMIT 1) AND metric IN ('rps', 'skill', 'hit', 'bias') ORDER BY ALL");
await show(
  "外に出す前の確認（集計は5人以上のときだけ。#55）",
  "SELECT dataset_id, n_people, CASE WHEN n_people >= 5 THEN '集計なら外に出せる' ELSE '外に出せない（5人未満）' END AS rule FROM datasets ORDER BY exported_at",
);
await show(
  "任意の2問（#63）：答えと未回答（問いが出た記録だけ）",
  "SELECT coalesce(thermal_preference, '（未回答）') AS thermal, coalesce(drink_preference, '（未回答）') AS drink, count(*) AS n, count(DISTINCT research_id) AS people FROM sensation_reports WHERE preference_version IS NOT NULL GROUP BY ALL ORDER BY ALL",
);
