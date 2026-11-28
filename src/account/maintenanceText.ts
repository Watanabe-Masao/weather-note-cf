// データの保守の画面を文字にする（「まとめてコピー」「全部コピー」）と、その型・書き方。画面は MaintenanceSheet.tsx。
// 文字だけの部分を分けたのは、単体テスト（test/maintenance-copy.test.ts）が JSX なしで読めるように。

export type Stage = { id: string; name: string; reach: string; lastOk: string | null; waiting: number | null; left: number; available: boolean; needed: boolean; why: string[]; last: { at: string; ok: boolean; detail: string } | null };
export type Series = { expected: number; kept: number; pendingCount: number; lostCount: number; absentCount?: number; pending: string[]; lost: string[]; absent?: string[] };
/** 空気のデータ（worker/src/airAudit.ts、11/25）。pending・absent は新しい順に6つまで。 */
export type AirC = {
  cams: { expected: number; kept: number; pending: string[]; pendingCount: number; watermark: string | null };
  soramame: { expected: number; kept: number; pending: string[]; pendingCount: number; absent: string[]; absentCount: number; watermark: string | null; newest: string | null };
  forecast: { expected: number; kept: number; pendingCount: number };
};
export type Dup = { name: string; n: number; examples: string[]; note?: string };
export type Summary = {
  at: string;
  failed?: { part: string; message: string }[];
  judged: { problems: { key: string; text: string }[]; notes: { key: string; text: string }[] };
  refetch: { perHour: number; stages: Stage[] };
  completeness?: { forecast: Record<string, Series>; radar: Record<string, Series>; air?: AirC | null; lostAll: { source: string; n: number }[]; absentAll?: { source: string; n: number }[] };
  errors: { at: string; where: string; message: string }[];
  room: null | { d1Size: { bytes: number; percent: number } | null; d1WritesMonth: { estimate: number; percent: number; rowsLastDay: number }; r2: { bytes: number; percentOfFree: number }; cronRunsLastDay: number; cronMissing: number };
  lastDupCheck: { at: string; result: Dup[] } | null;
  lastAudit?: { at: string; result: { tables: { name: string; rows: number }[]; links: { name: string; n: number }[] } } | null;
  weeklyAudit?: { at: string; result: Weekly } | null;
  offsite?: { configured: boolean; lastDay: string | null; lastAt: string | null; days: number; bytes: number; pending: number; oldestPending: string | null; lastError: { at: string; day: string | null; error: string } | null } | null;
};
export type Weekly = {
  series: { id: string; name: string; part: string; first: string | null; last: string | null; have: number; missing: number | null; gapCount: number; gaps: { from: string; to: string; n: number | null }[]; ageH: number | null; freshH: number; fresh: boolean; note: string }[];
  holes: { source: string; lost: number; recovered: number; absent: number }[];
  r2: { checked: number; missing: string[]; wrongSize: string[] } | null;
  latestOk: boolean;
  historyOk: boolean;
  failed: { part: string; message: string }[];
};

export const NAME: Record<string, string> = { VPFD51: "府県天気予報", VPFW50: "府県週間天気予報", hrpns: "雨雲レーダー", rasrf: "解析雨量" };
export const clock = (iso: string) => {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
export const ymd = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
export const age = (h: number | null) => (h == null ? "—" : h < 48 ? `${Math.round(h)}時間前` : `${Math.round(h / 24)}日前`);
export const mb = (b: number) => `${(b / 1_048_576).toFixed(1)}MB`;

/** メインのスレッドに貼るまとめ（文字だけ）。 */
export function digest(s: Summary): string {
  const out = [`【データの保守】${clock(s.at)}`];
  const { problems, notes } = s.judged;
  out.push(problems.length ? `異常 ${problems.length}：` : "異常なし", ...problems.map((p) => `・${p.text}`));
  if (notes.length) out.push(`注意 ${notes.length}：`, ...notes.map((p) => `・${p.text}`));
  out.push("取得：", ...s.refetch.stages.map((x) => `・${x.name}：最後に取れた ${x.lastOk ? clock(x.lastOk) : "—"}${x.waiting ? `・取り残し ${x.waiting}` : ""}${x.needed ? `（${x.why.join("・")}）` : ""}`));
  if (s.errors.length) out.push(`エラー（新しい順、${Math.min(10, s.errors.length)}件）：`, ...s.errors.slice(0, 10).map((e) => `・${clock(e.at)} ${e.where}：${e.message}`));
  if (s.failed?.length) out.push("読めなかった部分：", ...s.failed.map((f) => `・${f.part}：${f.message}`));
  if (s.room) out.push(`大きさ：DB ${s.room.d1Size ? `${mb(s.room.d1Size.bytes)}（${s.room.d1Size.percent}%）` : "—"}・月の書き込み見込み ${s.room.d1WritesMonth.percent}%・R2 ${mb(s.room.r2.bytes)}・定時処理 ${s.room.cronRunsLastDay}/288`);
  return out.join("\n");
}

/**
 * 画面の全部を文字に（11/28 渡辺さん「一発で全部コピーできるようにできませんか？」）。まとめ（digest）に、欠けの時刻・空気のデータ・
 * 週の点検（抜けた区間まで）・原本の控え・エラーの全部・重なり・表の点検（表ごとの行数まで）・大きさの細かい値を足す。
 * 畳んで見えていない所も入れる。提供スケジュールの説明文（変わらない文）は入れない。
 */
export function fullText(s: Summary): string {
  const out = [digest(s)];
  const series = s.completeness ? [...Object.entries(s.completeness.forecast), ...Object.entries(s.completeness.radar)].filter(([, a]) => a.expected) : [];
  if (series.length) {
    out.push("", "欠け（最大14日）：");
    for (const [k, a] of series) {
      out.push(`・${NAME[k] ?? k}：${a.expected}回中${a.kept}回${a.pendingCount ? `・まだ取り戻せる ${a.pendingCount}` : ""}${a.lostCount ? `・取り戻せない ${a.lostCount}` : ""}${a.absentCount ? `・気象庁が出していない ${a.absentCount}` : ""}`);
      for (const t of a.pending) out.push(`  ${clock(t)}（まだ取り戻せる）`);
      for (const t of a.lost) out.push(`  ${clock(t)}（取り戻せない）`);
    }
  }
  const a = s.completeness?.air;
  if (a) {
    out.push("", "空気のデータ：");
    out.push(`・空気質の予測（CAMS）：今日から4日先まで ${a.forecast.expected}時間中 ${a.forecast.kept}時間`);
    out.push(`・空気質（CAMS、終わった日）：手前14日 ${a.cams.expected}時間中 ${a.cams.kept}時間${a.cams.watermark ? `（続けて確かめられた位置 ${clock(a.cams.watermark)}）` : ""}${a.cams.pendingCount ? `・欠け ${a.cams.pendingCount}時間（${a.cams.pending.map(clock).join("・")}）` : ""}`);
    out.push(`・大気汚染の実測：最新 ${a.soramame.newest ? clock(a.soramame.newest) : "なし"}・手前14日 ${a.soramame.expected}時間中 ${a.soramame.kept}時間${a.soramame.absentCount ? `・提供元が出していない ${a.soramame.absentCount}時間` : ""}${a.soramame.pendingCount ? `・欠け ${a.soramame.pendingCount}時間（${a.soramame.pending.map(clock).join("・")}）` : ""}`);
  }
  const w = s.weeklyAudit?.result;
  if (w) {
    out.push("", `週の点検（${clock(s.weeklyAudit!.at)}）：最新 ${w.latestOk ? "すべて新しい" : `遅れ ${w.series.filter((x) => !x.fresh).length}`}・履歴 ${w.historyOk ? "抜けなし" : `抜けのある系列 ${w.series.filter((x) => x.gapCount).length}`}`);
    for (const x of w.series) {
      out.push(
        `・${x.name} ${x.part}：${ymd(x.first)}〜${ymd(x.last)}・${x.have.toLocaleString()}${x.missing == null ? "通" : "回分"}・最新 ${age(x.ageH)}${x.fresh ? "" : `（${x.freshH}時間より古い）`}・${x.gapCount ? (x.missing == null ? `長く空いたところ ${x.gapCount}` : `抜け ${x.missing.toLocaleString()}回（${x.gapCount}か所）`) : "抜けなし"}`,
      );
      for (const g of x.gaps) out.push(`  ${clock(g.from)} 〜 ${clock(g.to)} の間${g.n == null ? "" : `（${g.n}回）`}`);
      if (x.gapCount > x.gaps.length) out.push(`  ほか ${x.gapCount - x.gaps.length}か所`);
      if (x.gapCount && x.note) out.push(`  ${x.note}`);
    }
    if (w.r2) out.push(`・R2 の実物：${w.r2.checked}件中 ${w.r2.checked - w.r2.missing.length - w.r2.wrongSize.length}件そのまま${w.r2.missing.length ? `・無い ${w.r2.missing.join("・")}` : ""}${w.r2.wrongSize.length ? `・大きさが違う ${w.r2.wrongSize.join("・")}` : ""}`);
    if (w.holes.length) out.push(`・毎時の欠けの発見（これまで）：${w.holes.map((h) => `${h.source} 取り戻せない ${h.lost}・後で取り戻した ${h.recovered}・出ていない ${h.absent}`).join("／")}`);
    if (w.failed.length) out.push(`・読めなかった部分：${w.failed.map((f) => `${f.part}（${f.message}）`).join("・")}`);
  }
  if (s.offsite)
    out.push(
      "",
      s.offsite.configured
        ? `原本の控え（GitHub）：${s.offsite.days}日分（${mb(s.offsite.bytes)}）・最後に置いた日 ${s.offsite.lastDay ?? "—"}${s.offsite.pending ? `・まだ ${s.offsite.pending}日（${s.offsite.oldestPending} から）` : "・遅れなし"}${s.offsite.lastError ? `・${clock(s.offsite.lastError.at)} の失敗：${s.offsite.lastError.error}` : ""}`
        : "原本の控え（GitHub）：まだ設定されていません",
    );
  if (s.errors.length > 10) out.push("", `エラーの記録（全部 ${s.errors.length}件）：`, ...s.errors.map((e) => `・${clock(e.at)} ${e.where}：${e.message}`));
  if (s.lastDupCheck) out.push("", `重なり（${clock(s.lastDupCheck.at)}）：`, ...s.lastDupCheck.result.map((d) => `・${d.name}：${d.n ? `${d.n}（${d.examples.join("・")}）${d.note ? `（${d.note}）` : ""}` : "0"}`));
  if (s.lastAudit) {
    out.push("", `表の点検（${clock(s.lastAudit.at)}）：`, ...s.lastAudit.result.links.map((l) => `・${l.name}：${l.n}`));
    out.push("表ごとの行数：", ...s.lastAudit.result.tables.map((t) => `・${t.name} ${t.rows.toLocaleString()}`));
  }
  if (s.room)
    out.push(
      "",
      `大きさ：データベース ${s.room.d1Size ? `${mb(s.room.d1Size.bytes)}（${s.room.d1Size.percent}%）` : "—"}・月の書き込みの見込み ${Math.round(s.room.d1WritesMonth.estimate / 1_000) / 10}万行（${s.room.d1WritesMonth.percent}%）・1日 ${s.room.d1WritesMonth.rowsLastDay.toLocaleString()}行・R2 ${mb(s.room.r2.bytes)}（${s.room.r2.percentOfFree}%）・定時処理 ${s.room.cronRunsLastDay}/288${s.room.cronMissing ? `（記録の無い回 ${s.room.cronMissing}）` : ""}`,
    );
  return out.join("\n");
}

