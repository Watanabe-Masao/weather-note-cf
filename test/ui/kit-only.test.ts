// 操作は kit の部品で作る (2026-11-18 渡辺さん「新しく作成したページはエンジンに則っていない」)：Button・IconButton・Chip・
// Segmented・Slider は押せる範囲・角・影・選んでいる見た目が決まりどおり。素の <button> は、カードそのものを押す所（行・マス・
// 値の札）のような部品にならないものだけで、ファイルごとの数を増やさない（減らしたら下の一覧も下げる）。新しいファイルは 0。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : f.endsWith(".tsx") ? [p] : [];
  });

/** Raw <button> elements allowed per file (2026-11-18). */
const ALLOWED: Record<string, number> = {
  "beta/ReportSheet.tsx": 1,
  "beta/AfterAnswer.tsx": 1,
  "ui/HourCompare.tsx": 4,
  "ui/ConditionSheet.tsx": 4,
  "ui/CompareBoard.tsx": 1,
  "ui/TyphoonSheet.tsx": 4,
  "ui/ShortHistoryBoard.tsx": 2,
  "ui/forecastHistory/DayRows.tsx": 1,
  // 週間天気予報の表：日の列を押す（列そのものを押す、カレンダーと同じ）。
  "ui/forecastHistory/IssueWeek.tsx": 1,
  "ui/SunTestBoard.tsx": 3,
  "ui/MonthReview.tsx": 6,
  "ui/ModalSheet.tsx": 1,
  "ui/Settings.tsx": 9,
  "ui/DateNav.tsx": 3,
  "ui/CalendarModal.tsx": 4,
  "ui/DayDetail.tsx": 5,
  // 月のこよみ：カレンダーの日のマス（マスそのものを押す、カレンダーと同じ）。
  "ui/MoonSheet.tsx": 1,
  // 満月の呼び名：一覧の行（行そのものを押して開く、予報の一覧の行と同じ）。
  "ui/FullMoonSheet.tsx": 1,
  // 見出しのロゴ：空のイベントの日の帯の絵（ロゴそのものを押す）。
  "ui/Brand.tsx": 2,
  "ui/MoonStory.tsx": 1,
  "ui/DaySummaryCard.tsx": 1,
  "ui/CompareSummary.tsx": 3,
  "ui/StatusBar.tsx": 1,
  "ui/BandMap.tsx": 2,
  "App.tsx": 4,
  "account/AdminSheet.tsx": 12,
  "account/NotifySection.tsx": 9,
  "account/ResearchSheet.tsx": 2,
  "account/ReauthForm.tsx": 1,
  "account/AccountSection.tsx": 10
};

describe("操作は kit の部品", () => {
  it("no file has more raw <button> than its allowance (kit.tsx itself is the parts)", () => {
    const over = files(SRC)
      .map((p) => ({ f: p.slice(SRC.length + 1), n: (readFileSync(p, "utf8").match(/<button\b/g) ?? []).length }))
      .filter(({ f, n }) => f !== "ui/kit.tsx" && n !== (ALLOWED[f] ?? 0))
      .map(({ f, n }) => `${f}: ${n}（一覧 ${ALLOWED[f] ?? 0}）`);
    expect(over).toEqual([]);
  });
});
