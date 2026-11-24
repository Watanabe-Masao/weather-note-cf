// 予報の変化の要約（2026-11-24 渡辺さん、設計改善書「変化の要約」、見本の OK）：
// その日の予報が、どの発表で、どう変わったかを先に言う（「前日17時の発表で、雨の予報に変わった」）。
//
// 決まり：
//   - 比べるのは気象庁の同じ種類（府県どうし・週間どうし）で、同じ区切りの値どうしだけ（当日の途中からの値は比べない）。
//   - 拾う変化：雨の有無（天気に「雨」が入った・消えた）／降水確率が 20 ポイント以上（天気の雨の有無が変わらないとき、
//     「降水確率が上がった」と言い「雨に変わった」とは言わない）／最高・最低が 2℃ 以上。
//   - 間の同じ種類の発表が欠けていたら（記録なし・取れなかった・届いていない・取り消し）、変わった時刻を断定せず
//     「前の発表〜この発表のあいだ」と言う。
//   - 新しい順。いちばん大事な1つ（まとめの1行）は、雨の有無 → 降水確率 → 気温 の順で、その中の新しいもの。
import { hourOf, leadLabel, oneSource, type Kind, type Slot, type V } from "./forecastHistoryModel";

export const POP_STEP = 20;
export const TEMP_STEP = 2;

export type ChangeKind = "rainOn" | "rainOff" | "popUp" | "popDown" | "maxUp" | "maxDown" | "minUp" | "minDown";

export interface DayChange {
  kind: ChangeKind;
  /** 変わった後の発表（一覧で印を付ける回）。 */
  key: string;
  at: string;
  issueKind: Kind;
  /** 比べた前の発表。 */
  prevAt: string;
  /** 間の同じ種類の発表が欠けていた（変わった時刻を断定しない）。 */
  gap: boolean;
  /** 「前日17時の発表で」「前日11時〜17時のあいだに」。 */
  when: string;
  /** 「雨の予報に変わった」など。 */
  what: string;
  /** 「くもり → くもり 昼すぎ一時雨」「12〜18時 20 → 60%」「18 → 16℃（2℃）」。 */
  detail: string;
}

const RANK: Record<ChangeKind, number> = { rainOn: 0, rainOff: 0, popUp: 1, popDown: 1, maxUp: 2, maxDown: 2, minUp: 2, minDown: 2 };

const num = (v: V | null | undefined) => (v && v.s === "value" && Number.isFinite(Number(v.v)) ? Number(v.v) : null);

/**
 * 天気の言葉：天気予報用テロップ番号の名前（「くもり時々雨」、府県も週間も同じ表から）。名前の無い記録は文・値。
 * 比べられない（値が無い）ときは null。
 */
function weatherWords(s: Slot): string | null {
  const w = s.values?.weather;
  if (!w || w.s !== "value") return null;
  const x = w as { v: number | string; name?: string | null; sentence?: string | null };
  return (x.name ?? x.sentence ?? String(x.v)).replace(/　/g, " ").trim();
}

/** 天気が当日の途中からの値か（「11時から」）：その日全体の天気どうしだけ比べる。 */
const partial = (s: Slot) => {
  const w = s.values?.weather as (V & { partial?: string | null }) | undefined;
  return w && w.s !== "absent" ? (w.partial ?? null) : null;
};

const rainy = (words: string) => /雨/.test(words);

/** 「前日17時」「2日前11時」「当日5時」。 */
const issueWord = (s: Pick<Slot, "lead" | "at">) => `${leadLabel(s.lead)}${hourOf(s.at)}時`;

const POP_RANGE = ["0〜6時", "6〜12時", "12〜18時", "18〜24時"];

/** その日の予報の変化（新しい順）。`all`：ForecastHistory.slots(day, now) の全部（記録なしの回も含む、時刻の順）。 */
export function dayChanges(all: Slot[]): DayChange[] {
  const out: DayChange[] = [];
  for (const kind of ["VPFD51", "VPFW50"] as Kind[]) {
    const mine = all.filter((s) => s.kind === kind);
    let prev: Slot | null = null;
    let gap = false;
    for (const s of mine) {
      if (s.state !== "ok" || !s.values) {
        if (prev) gap = true;
        continue;
      }
      // 当日の発表は途中からの値なので比べない（markChanges と同じ）。
      if (prev && s.lead > 0) {
        const base = { key: s.key, at: s.at, issueKind: kind, prevAt: prev.at, gap };
        const when = gap ? `${issueWord(prev)}〜${issueWord(s)}のあいだに` : `${issueWord(s)}の発表で`;
        const p = prev.values!;
        const v = s.values;
        // 雨の有無（その日全体の天気どうし）
        const wp = weatherWords(prev);
        const wv = weatherWords(s);
        let rainChanged = false;
        if (wp && wv && partial(prev) === partial(s) && rainy(wp) !== rainy(wv)) {
          rainChanged = true;
          out.push({ ...base, kind: rainy(wv) ? "rainOn" : "rainOff", when, what: rainy(wv) ? "雨の予報に変わった" : "雨の予報がなくなった", detail: `${wp} → ${wv}` });
        }
        // 降水確率（雨の有無が変わらないとき）
        if (!rainChanged) {
          const pairs: { a: number; b: number; range: string }[] = [];
          if (kind === "VPFD51" && p.pop6 && v.pop6)
            v.pop6.forEach((x, i) => {
              const a = num(p.pop6![i]);
              const b = num(x);
              if (a != null && b != null && Math.abs(b - a) >= POP_STEP) pairs.push({ a, b, range: POP_RANGE[i] });
            });
          if (kind === "VPFW50") {
            const a = num(p.popDay);
            const b = num(v.popDay);
            if (a != null && b != null && Math.abs(b - a) >= POP_STEP) pairs.push({ a, b, range: "1日" });
          }
          if (pairs.length) {
            const big = pairs.reduce((x, y) => (Math.abs(y.b - y.a) > Math.abs(x.b - x.a) ? y : x));
            const up = big.b > big.a;
            out.push({ ...base, kind: up ? "popUp" : "popDown", when, what: up ? "降水確率が上がった" : "降水確率が下がった", detail: pairs.map((x) => `${x.range} ${x.a} → ${x.b}%`).join("、") });
          }
        }
        // 最高・最低
        for (const [k, word] of [
          ["max", "最高"],
          ["min", "最低"],
        ] as const) {
          const a = num(p[k]);
          const b = num(v[k]);
          if (a == null || b == null || Math.abs(b - a) < TEMP_STEP) continue;
          const up = b > a;
          out.push({ ...base, kind: `${k}${up ? "Up" : "Down"}` as ChangeKind, when, what: `${word}の予報が${up ? "上がった" : "下がった"}`, detail: `${a} → ${b}℃（${Math.abs(b - a)}℃）` });
        }
      }
      prev = s;
      gap = false;
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : RANK[a.kind] - RANK[b.kind]));
}

/** いちばん大事な1つ（まとめの1行）：雨の有無 → 降水確率 → 気温、その中の新しいもの。無ければ null。 */
export function headlineChange(changes: DayChange[]): DayChange | null {
  return [...changes].sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0] ?? null;
}

/**
 * 画面に出す変化：一覧に出る発表（oneSource：同じ時刻に府県と週間があれば府県）の変化だけ。
 * 行を押すとその発表を選ぶので、一覧に無い発表の変化は出さない（府県の側で、その日の変化として言える）。
 */
export function shownChanges(all: Slot[]): DayChange[] {
  const keys = new Set(oneSource(all).map((s) => s.key));
  return dayChanges(all).filter((c) => keys.has(c.key));
}
