// 絵本の演出（第2次、2026-11-25 渡辺さん「文字の表示時間、読む時間、文節間の間、文字の消去、絵だけの鑑賞時間を区別」）。
//
// 文（組版の改行を含む本文）と、その出し方（演出の単位）を分ける。組版の改行（"\n" と、背の低い画面だけで折る "/"）は
// 時間に関わらない。時間は秒で決める：
//   ページの区間 = 前のページの文が消える（fadeOut）＋ 前のページの絵だけの時間（picture）
//                 ＋ 絵が先に見える時間（intro）＋ 文が出る時間（単位ごと）＋ 出そろってから読む時間（readHold）
//   最後のページは、読む時間のあとに文が消え、（作品名があれば浮かべて消し）額縁、絵だけの時間まで同じ区間に入れる。
// 演出の単位：
//   char   一字ずつ（擬音・はらり など）。charInterval 秒ごと、fadeIn 秒で浮かぶ。読点・句点で間をおく。
//   phrase 読点の区切り（文節のまとまり）ごとに、まとめて fadeIn 秒で浮かぶ。次の区切りまでは字数ぶんの読む時間。
//   line   一行まるごと fadeIn 秒で浮かぶ（「もう、いっぽん。」、作品名）。
// pauseBefore は、その単位を出す前の間（秒）。

export type RevealMode = "char" | "phrase" | "line";

export interface TextUnit {
  /** 本文のこの部分（組版の改行 "\n" と "/" を除いた字の並び）。 */
  text: string;
  mode: RevealMode;
  /** この単位の前の間（秒）。 */
  pauseBefore: number;
  /** 一字ずつのときの字の間隔（秒）。 */
  charInterval?: number;
  /** 浮かぶ秒。 */
  fadeIn: number;
}

export interface PageDirection {
  units: TextUnit[];
  /** 絵が先に見える秒（文が出る前）。 */
  intro: number;
  /** 出そろってから読む秒。 */
  readHold: number;
  /** 文が消える秒。 */
  fadeOut: number;
  /** 文が消えたあと、絵だけを見せる秒（最後のページは額縁のあと）。 */
  picture: number;
}

/** 結末の作品名（最後のページの文が消えきってから、独立して浮かぶ。ビーバームーンの E4、11/26 確定）。 */
export interface TitleTiming {
  /** 文が消えきってから、文字の無い風景の秒。 */
  gap: number;
  /** 一文まるごと浮かぶ秒。 */
  fadeIn: number;
  /** 残す秒。 */
  hold: number;
  /** 消える秒。 */
  fadeOut: number;
}

/** 一冊の演出（場面の StoryScene.direction が本文から作る）。 */
export interface BookDirection {
  pages: PageDirection[];
  /** 結末の作品名（本の titleEnd があるとき）。 */
  title?: TitleTiming;
  /** 額縁が入る秒（最後のページ、文と作品名が消えきってから）。そのあと最後のページの picture 秒、絵だけ。 */
  frame: number;
}

/** 読む速さ（秒/字）と、読点・句点の間（秒）。 */
export const READ = { char: 0.17, comma: 0.3, stop: 0.6 };

/** 組版の印（改行 "\n"、背の低い画面だけで折る "/"）を除いた字の並び。字の番号（演出の時刻）はこれで数える。 */
export const plainText = (s: string) => s.replace(/[\n/]/g, "");

export interface CharTime {
  /** 浮かびはじめ（ページの区間の頭からの秒）。 */
  at: number;
  /** 浮かぶ秒。 */
  fade: number;
}

export interface PageTimes {
  /** 字ごとの時刻（plainText の字の番号）。 */
  chars: CharTime[];
  /** 区間の頭から、文が出はじめるまで（前のページの消去・絵＋intro）。 */
  textStart: number;
  /** 全部の字が浮かびきる時刻。 */
  textFull: number;
  /** 文が消えはじめる時刻（最後のページだけ区間の中、ほかは次の区間の頭）。 */
  fadeStart: number;
  /** この区間の長さ（秒）。 */
  total: number;
}

const pauseAfter = (c: string) => ("、，".includes(c) ? READ.comma : "。！？".includes(c) ? READ.stop : 0);

/**
 * 1ページの字の時刻。lead は区間の頭から intro の前まで（前のページの消去と絵だけの時間）。
 * 最後のページ（last）は、読む時間のあと文が消えるまでを区間に入れ、そのあとに tail 秒（作品名・額縁・絵）を足す。
 */
export function pageTimes(d: PageDirection, lead: number, last = false, tail = 0): PageTimes {
  const chars: CharTime[] = [];
  let t = lead + d.intro;
  const textStart = t;
  let full = t;
  for (const u of d.units) {
    t += u.pauseBefore;
    const cs = [...u.text];
    if (u.mode === "char") {
      const step = u.charInterval ?? READ.char;
      cs.forEach((c) => {
        chars.push({ at: t, fade: u.fadeIn });
        full = Math.max(full, t + u.fadeIn);
        t += step + pauseAfter(c);
      });
    } else if (u.mode === "phrase") {
      // 読点・句点の後ろで区切る（区切りごとにまとめて浮かべ、字数ぶん読ませてから次へ）。
      let chunk: string[] = [];
      const flush = () => {
        if (!chunk.length) return;
        chunk.forEach(() => chars.push({ at: t, fade: u.fadeIn }));
        full = Math.max(full, t + u.fadeIn);
        t += chunk.length * READ.char + pauseAfter(chunk[chunk.length - 1]);
        chunk = [];
      };
      cs.forEach((c) => {
        chunk.push(c);
        if (pauseAfter(c)) flush();
      });
      flush();
    } else {
      cs.forEach(() => chars.push({ at: t, fade: u.fadeIn }));
      full = Math.max(full, t + u.fadeIn);
      t += cs.length * READ.char + pauseAfter(cs[cs.length - 1] ?? "");
    }
  }
  // 読む時間（readHold）は、全部の字が浮かびきってから数える（11/25 承認「全文が出てからの読む時間」）。
  const textFull = full;
  const fadeStart = textFull + d.readHold;
  const total = last ? fadeStart + d.fadeOut + tail : fadeStart;
  return { chars, textStart, textFull, fadeStart, total };
}

/** 本文（組版の印つき）を演出の単位に分ける。rule は行（組版の印を除いた字）と行の番号から、出し方を決める。 */
export function unitsOf(
  page: string,
  rule: (line: string, index: number) => Omit<TextUnit, "text">,
): TextUnit[] {
  return page
    .split("\n")
    .map((l, i) => ({ text: plainText(l), ...rule(plainText(l), i) }))
    .filter((u) => u.text.length > 0);
}
