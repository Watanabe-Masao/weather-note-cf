// 値が無いときの理由と、観測の方法の区間（2026-11-25 渡辺さん「データが無い、存在しないと取得期間対象外を表示を分けるべき」
// 「いつからいつまでの以前のデータまでなら存在するはずかを計算した上で分けて表示の管理をすべき」）。
//
// 項目ごとに「いつから値が有るはずか」と「観測の方法がいつ変わったか」を1か所に持ち、画面はここから理由を決める。
// 調べた根拠は Project の資料「データの有効区間と「無い」の分け方_調査.md」と docs/data-map.md。
//   - 気象庁の過去の気象データ：気象台の日別・時別は観測開始から（アプリは FIRST_DAY から）。時別の日照・日射・降雪・積雪・
//     天気・視程は 1989年4月から（www.data.jma.go.jp/stats/mdrr/man/kikan.html）。
//   - 高知の天気・視程：2020-02-03 の昼（12〜15時のどこか）に目視から自動に（目視観測通報の自動化、2019-12-26 のお知らせ）。
//     それより前は3時間ごとの目視、後は毎時の視程計・自動の天気。値は出すが、またいで比べない（11/25 渡辺さん）。
//
// 理由（NoValueWhy）は6つ：対象外・取れません・欠測・まだ・取得失敗・一部だけ（値は出す）。比べられない差は別（comparable）。

import { FIRST_DAY } from "./dates";
import type { WeatherRow } from "./types";

export type NoValueWhy = "outside" | "gone" | "absent" | "pending" | "failed" | "partial";

/** 理由ごとの名前と、ⓘ の説明。アイコンは src/ui/NoValue.tsx。 */
export const NO_VALUE: Record<NoValueWhy, { label: string; note: string }> = {
  outside: { label: "対象外", note: "この日は元から値がありません（観測・提供が始まる前、または予報の範囲の外）" },
  gone: { label: "取れません", note: "提供元が消し、こちらも取れなかった値です" },
  absent: { label: "欠測", note: "提供元が値を出していません（観測の欠測・点検など）" },
  pending: { label: "まだ", note: "まだ出ていません（出る時刻の前、または速報の途中）" },
  failed: { label: "取得失敗", note: "有るはずの値を取れませんでした。取り直してください" },
  partial: { label: "一部だけ", note: "一部の時間だけから出した値です" },
};

/** 比べられない差の名前と説明（空気の内訳の斜線と同じ考え）。 */
export const INCOMPARABLE = { label: "比べられない", note: "観測の方法が違う日どうしは比べません" };

interface Method {
  /** この日から（日本時間の日付）。 */
  from: string;
  id: string;
  /** ⓘ に出す説明。 */
  note: string;
}

interface Availability {
  /** 実績（観測）の値が有るはずの最初の日。1日の値を時別から出す項目は、時別の始まり。 */
  from: string;
  /** 観測の方法の区間（古い順）。区間をまたぐ日どうしは比べない。境の日（切り替わった日）はどちらとも比べない。 */
  methods?: Method[];
}

const HOURLY_EXTRA_FROM = "1989-04-01";
const VISUAL: Method = { from: "1989-04-01", id: "visual", note: "目視（3時間ごと）" };
const AUTO_FROM = "2020-02-03";
const AUTO: Method = { from: AUTO_FROM, id: "auto", note: "視程計・自動の天気（毎時）" };

/** 行の項目（WeatherRow のキー）ごと。書いていない項目は FIRST_DAY から、方法の区間なし。 */
const ITEMS: Record<string, Availability> = {
  sun: { from: FIRST_DAY },
  radiation: { from: HOURLY_EXTRA_FROM },
  snow: { from: FIRST_DAY },
  snowDepth: { from: FIRST_DAY },
  weather: { from: HOURLY_EXTRA_FROM, methods: [VISUAL, AUTO] },
  visibility: { from: HOURLY_EXTRA_FROM, methods: [VISUAL, AUTO] },
};

export const availabilityOf = (field: string): Availability => ITEMS[field] ?? { from: FIRST_DAY };

/** その日の観測の方法（区間の id）。切り替わった日は "mixed"、区間が無い項目は null。 */
export function methodOf(field: string, date: string): string | null {
  const ms = availabilityOf(field).methods;
  if (!ms) return null;
  if (ms.some((m, i) => i > 0 && m.from === date)) return "mixed";
  let id: string | null = null;
  for (const m of ms) if (date >= m.from) id = m.id;
  return id;
}

export const methodNote = (field: string, date: string): string | null => {
  const id = methodOf(field, date);
  if (id === "mixed") return "観測の方法が切り替わった日";
  return availabilityOf(field).methods?.find((m) => m.id === id)?.note ?? null;
};

/** 2つの日の値を比べてよいか（観測の方法が同じ区間か）。片方が無ければ true（比べる値が無いだけ）。 */
export function comparable(field: string, a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || !availabilityOf(field).methods) return true;
  const ma = methodOf(field, a);
  const mb = methodOf(field, b);
  return ma !== "mixed" && mb !== "mixed" && ma === mb;
}

/** 時別の値から1日の最小・最大・中央値を出すのに要る時間の数。目視の区間は3時間ごと（1日8回）なので7回。 */
export function minHoursFor(field: string, date: string | undefined, usual: number): number {
  return date && methodOf(field, date) === "visual" ? 7 : usual;
}

export interface WhyInput {
  /** 行の項目（WeatherRow のキー）。 */
  field: string;
  date: string;
  /** 日の取得の状態（store の DayView・HourView の state）。 */
  state: "empty" | "ready" | "error" | "outside";
  /** 時別から出す項目のとき、時別の取得の状態。 */
  hoursState?: "empty" | "ready" | "error" | "outside";
  /** その日の行（日別）、または時別の行。 */
  rows?: (WeatherRow | null | undefined)[];
  /** 予報の行か。 */
  forecast?: boolean;
}

/**
 * 値が無いときの理由。読み込み中は null（骨組みを出す）。
 * 順番：取得失敗 → 対象外 → まだ（速報で列がまだ空） → 取得失敗（保存が古い形で項目そのものが無い） → 欠測。
 */
export function whyMissing(x: WhyInput): NoValueWhy | null {
  if (x.state === "outside" || x.hoursState === "outside") return "outside";
  if (x.state === "error" || x.hoursState === "error") return "failed";
  if (x.state === "empty" || x.hoursState === "empty") return null;
  if (!x.forecast && x.date < availabilityOf(x.field).from) return "outside";
  const rows = (x.rows ?? []).filter((r): r is WeatherRow => !!r);
  if (!rows.length) return x.forecast ? "outside" : "absent";
  if (rows.some((r) => r.unpublished?.includes(x.field))) return "pending";
  // 行はあるのに項目そのものが無い：保存が古い形（#509 の視程）か、出どころがその項目を持たない
  if (!rows.some((r) => x.field in r)) return x.forecast ? "outside" : "failed";
  return "absent";
}
