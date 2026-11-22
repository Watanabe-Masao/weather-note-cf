// 満月の物語（2026-11-20 渡辺さん「GSAP + ScrollTrigger Apple風の複雑なスクロール演出」、全画面のページ）。
// 11/20 渡辺さん「一コマ一コマ、一つ一つのパーツ、背景、描画を通じた一体感で物語の世界観を表現し、満月の魅力を体験させる」
// 「テーマカラー関係なく共通で一本で」：一冊の絵本として見せる。
//   1. 本：紺の革の表紙が開き（見開きが画面に収まる）、紙のページにひと言。そのページの中へ入っていく。
//   2. 絵本の場面：一枚の続いた世界を、物語の一文ごとに一コマずつ（src/design/story）。文は空に一字ずつ浮かぶ。
//      場面の無い満月は、ひと言と物語の一段落ずつ。
//   3. 今夜の情報（11/20 渡辺さん「物語の最後には情報も」）：瞬間のカードと、その夜の空のカード（イベントの説明と同じ
//      部品、EventInfo）、その年だけのこと。
//   4. 知識：名前の由来・自然との関係（紙のページ）。次の満月の物語へ（一年を巡る13の物語）と、この年の一覧へ。
// 文は毎年使える部分だけ（shared/fullMoonNames.ts）、その年だけのことは計算から。絵と動きは文化的なイメージで、実際の
// 月の色や見え方とは別（ページの終わりに断る）。GSAP と ScrollTrigger は、このページを開いたときだけ読み込む。
import {
  type CSSProperties,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BLUE_MOON,
  FULL_MOON_NAMES,
  fullMoonInfo,
  type FullMoonNameInfo,
} from "../../shared/fullMoonNames";
import {
  fullMoonAlias,
  fullMoonName,
  fullMoonsOfYear,
} from "../../shared/moon";
import { eventNight, skyEventOn, skyEventShown, type SkyEvent } from "../../shared/skyEvents";
import { BOOK } from "../design/story/palette";
import { skyHidden } from "../../shared/dayWeather";
import { windowMoonLine } from "../../shared/windowMoon";
import { dirName } from "./moonParts";
import { DEFAULT_LAT_LON } from "../../shared/sunTimes";
import type { WeatherStore } from "../data/store";
import { eventArt, eventIcon } from "../design/eventAssets";
import { eventStage } from "../design/eventLogo";
import {
  bookVars,
  Flourish,
  GoldDefs,
  GoldFrame,
  spineVar,
} from "../design/story/Book";
import {
  CloudMark,
  Glint,
  LeafRule,
  PaperCorner,
  PhaseRow,
  MoonEmblem,
  SpineHills,
  SpineLatin,
  Sprig,
  SymbolIcon,
  Twig,
} from "../design/story/emblems";
import { STORY_SCENES } from "../design/story/scenes";
import { storyAsset } from "../design/story/storyAssets";
import { onSkyVars } from "../design/tokens";
import { EventMomentCard, EventNightCard } from "./EventInfo";
import { STARS } from "./eventBits";
import { factTags } from "./FullMoonSheet";
import { type Pager, storyPager } from "./storyPager";
import { CloseIcon } from "./icons";
import { Button, Glyph, IconButton } from "./kit";

const WHERE = "高知";
/** いまの雲を見る観測所（高知、今夜の情報のカードと同じ）。 */
const SKY_STATION = "47893";
/** 開いた本（見開き）を画面に収める縮め方（表紙は画面の幅の 84% まで大きく、見開きはその 2 倍の幅）。 */
const SPREAD = 0.56;
const HOUR_MS = 3_600_000;
/**
 * 縦書きの文の数字を漢数字に（11/20 22:12 渡辺さん「11月が横向き。十一月に」）。文そのもの（shared/fullMoonNames.ts）は
 * 横書きの画面でも使うので、縦に組むときだけ変える。0〜99 の整数（月・日・個数）を想定。
 */
const KAN = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
export function tateNum(t: string): string {
  return t
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\d+/g, (d) => {
      const n = Number(d);
      if (n >= 100) return [...d].map((c) => KAN[Number(c)]).join("");
      const ten = Math.floor(n / 10);
      const one = n % 10;
      return (
        (ten ? (ten > 1 ? KAN[ten] : "") + "十" : "") +
        (one || !ten ? KAN[one] : "")
      );
    });
}
/**
 * 各コマで止まる所（コマの頭から 0〜1）。文が出そろい（〜0.6）、絵の動きが落ち着いた（場面の動きは 0.75 までに終える、
 * docs/moon-story.md 5章）あと、文が消えはじめる（0.84）前（11/20 22:06 渡辺さん「止まる所が描画とリンクしていない」）。
 */
export const BEAT_REST = 0.78;
/** 締めくくりのきらめき：[横 %, 縦 %, 大きさ（倍）, 遅れ（秒）]。文のまわりに散らし、同時には一つ二つだけ光る。 */
const GLINTS: [number, number, number, number][] = [
  [18, 30, 0.9, 0.4],
  [82, 34, 0.7, 1.6],
  [12, 52, 0.6, 2.7],
  [88, 50, 1, 3.5],
  [26, 66, 0.55, 1.1],
  [74, 70, 0.75, 2.2],
  [50, 22, 0.5, 4.2],
];

/**
 * 朗読の速さ（11/20 23:14 渡辺さん「朗読するように再生しましょう」、22:43「文字の数や動きに合わせて一コマの長さを」）：
 * 文は一字ずつ、朗読の速さ（約 5.5 字/秒）で現れ、読点ではひと呼吸、句点ではもう少し長く間をおく。
 * コマの長さ（運ぶ秒数・スクロールの量）は、その文を読む時間から決める（読む時間が倍なら倍）。
 *   - 一字 READ_CHAR 秒、読点・中黒などに +PAUSE_COMMA、句点・！？に +PAUSE_STOP。
 *   - 文はコマの 0.06〜REVEAL_END で出そろう（その間を読む時間に合わせる）。そのあと止まる所（0.78）まで、文を読み終える間。
 *   - スクロールの量は beatWeights（秒数の平方根で縮める）。運ぶ時間は秒数そのまま。
 */
const READ_CHAR = 0.18;
const PAUSE_COMMA = 0.35;
const PAUSE_STOP = 0.6;
const REVEAL_START = 0.06;
const REVEAL_END = 0.66;
const MIN_BEAT_SEC = 3.2;
const SEC_PER_BEAT = 3.2;
/**
 * 物語のあとの区切りへ運ぶ秒数（11/21 0:36 渡辺さん「物語が終わってからの移動が急に速くなりすぎる」）：場面のコマと同じ
 * ゆっくりさで。一枚の絵（枠が入る）、締めくくり（ひと言を読む）、今夜の情報（間の一言が現れて滲んで消え、月がカードへ移る）。
 */
const AFTER_SEC = { frame: 3.6, epilogue: 5.5, info: 6 } as const;
/** 一字ずつの、読みはじめからの時刻（秒）と、読み終わり（秒）。 */
export function readingTimes(text: string): { at: number[]; total: number } {
  const at: number[] = [];
  let t = 0;
  for (const c of [...text]) {
    at.push(t);
    t += READ_CHAR + ("、，・".includes(c) ? PAUSE_COMMA : "。！？".includes(c) ? PAUSE_STOP : 0);
  }
  return { at, total: t };
}
/**
 * コマごとの秒数（朗読の時間から）。rests は、そのページを読み終えてから絵だけを見せる秒（絵本の形のページの rest、
 * 11/21 絵コンテ v0.3：6ページ 2.5 秒・9ページ 3 秒など）。読む時間に足す。
 */
export function beatSeconds(lines: string[], rests: number[] = [], holdLast = false): number[] {
  return lines.map((t, i) => {
    const read = readingTimes(tateNum(t)).total;
    // 最後のページで文だけ先に消す（holdLast）：読み終えて LAST_TAIL 秒おいて文が消え、止まる所まで絵だけが rest 秒。
    if (holdLast && i === lines.length - 1)
      return Math.max(MIN_BEAT_SEC, (read + LAST_TAIL + (rests[i] ?? 0)) / (BEAT_REST - 2 * REVEAL_START));
    return Math.max(MIN_BEAT_SEC, read / (REVEAL_END - REVEAL_START)) + (rests[i] ?? 0);
  });
}
/** 最後のページで、読み終えてから文が消えはじめるまでの秒。 */
export const LAST_TAIL = 1.6;
/**
 * 文の出入り（コマの中の位置、11/21 レビュー）：止まる所（BEAT_REST）を過ぎて送りはじめたら、すぐ消しはじめて短く消す。
 * 次のページの文は、そのコマの頭より CAP_LEAD 前から出しはじめる（前の文が消えてから1秒ほどで出はじめる）。
 */
export const CAP_OUT = 0.8;
export const CAP_OUT_DUR = 0.05;
export const CAP_LEAD = 0.16;
/**
 * 一字ずつ出る時刻（コマの中の 0〜1）。朗読の速さのまま（コマの秒数で割る）。lineAt があれば、行ごとにその所から
 * 出しはじめる（前の行が出そろう前には始めない）。行の切れ目は改行（\n）。
 */
export function revealTimes(text: string, seconds: number, lineAt?: number[]): number[] {
  const r = readingTimes(text);
  const chars = [...text];
  const out: number[] = [];
  let line = 0;
  let base = REVEAL_START;
  let lineStart = 0;
  let last = REVEAL_START;
  chars.forEach((c, k) => {
    if (k === 0 || chars[k - 1] === "\n") {
      if (k > 0) line++;
      base = Math.max(lineAt?.[line] ?? last, last);
      lineStart = r.at[k];
    }
    const t = base + (r.at[k] - lineStart) / seconds;
    out.push(t);
    last = t + READ_CHAR / seconds;
    void c;
  });
  return out;
}
/** コマごとのスクロールの重み（秒数に比例）。 */
/**
 * コマごとのスクロールの重み（11/20 23:59 渡辺さん「スクロールの距離が今度は長く感じる」）：運ぶ時間は朗読の秒数のまま、
 * スクロールの量は秒数の平方根で縮める（長い文でも 1.6 まで、短い文は 0.9 から）。指でなぞったときに長すぎないように。
 * 自動で運ぶときは時間で進むので、字は朗読の速さどおりに出る（スクロールの量には左右されない）。
 */
export function beatWeights(lines: string[], rests: number[] = [], holdLast = false): number[] {
  return beatSeconds(lines, rests, holdLast).map((s) => Math.min(1.6, Math.max(0.9, Math.sqrt(s / SEC_PER_BEAT))));
}
/** 場面の時間（コマの番号 i ＋ コマの中の 0〜1）を、スクロールの割合（0〜1）に。 */
export function beatToProgress(w: number[], time: number): number {
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const i = Math.max(0, Math.min(w.length - 1, Math.floor(time)));
  const before = w.slice(0, i).reduce((a, b) => a + b, 0);
  return Math.min(1, (before + (time - i) * (w[i] ?? 0)) / total);
}
/** スクロールの割合（0〜1）を、場面の時間に（beatToProgress の逆）。 */
export function progressToBeat(w: number[], p: number): number {
  const total = w.reduce((a, b) => a + b, 0) || 1;
  let x = Math.max(0, Math.min(1, p)) * total;
  for (let i = 0; i < w.length; i++) {
    if (x <= w[i] || i === w.length - 1) return i + Math.min(1, x / (w[i] || 1));
    x -= w[i];
  }
  return w.length;
}

/**
 * 物語の区切り（スクロールの px、小さい順）：表紙・見開き・場面の一コマずつ（文が読める所）・場面の終わり（一枚の絵）・
 * 締めくくり・今夜の情報の頭。下のドットは場面のコマ（firstBeat から一つずつ）。
 */
/**
 * 縦書きの字幕の字の大きさを、いちばん長い行（data-n 字）が列の高さに収まる段に（11/21 レビュー）。字の送りは
 * 1字＋字間 0.14em に、句読点の詰めの差を見て少し余裕（1.2）。lg → md → sm の順に試し、収まらなければ sm のまま。
 */
export function fitCaps(el: HTMLElement): void {
  el.querySelectorAll<HTMLElement>(".ms-cap").forEach((c) => {
    const n = Number(c.dataset.n) || 0;
    const h = c.clientHeight;
    if (!n || !h) return;
    c.classList.remove("fit-md", "fit-sm");
    for (const k of ["", "fit-md", "fit-sm"]) {
      if (k) c.classList.add(k);
      if (n * parseFloat(getComputedStyle(c).fontSize) * 1.2 <= h) return;
      if (k && k !== "fit-sm") c.classList.remove(k);
    }
  });
}

function storyStops(
  el: HTMLElement,
  scene: { beats: number } | null | undefined,
  weights: number[],
  seconds: number[],
  book = false,
  reduced = false,
): { px: number[]; firstBeat: number; secs: (number | undefined)[] } {
  const vh = el.clientHeight;
  fitCaps(el); // 大きさが変わると列の高さも変わる（区切りを測り直すときに一緒に）
  const b = el.querySelector<HTMLElement>(".ms-book");
  const w = el.querySelector<HTMLElement>(".ms-world");
  const ep = el.querySelector<HTMLElement>(".ms-epilogue");
  // 物語の終わり（data-story-end：ふだんは今夜の情報、絵本の形の満月はあとがき）。
  const end = el.querySelector<HTMLElement>("[data-story-end]")?.offsetTop ?? 0;
  const px: number[] = [0];
  /** その区切りへ一つ前から運ぶ秒数（コマは字の数に比例。ほかは距離から）。 */
  const secs: (number | undefined)[] = [];
  let firstBeat = -1;
  // 動きを減らす設定（11/21 レビュー：区切りが文の並びの途中にあり、文が上のボタンに重なっていた）：場面は一枚の絵、
  // 文はその下に並ぶので、区切りは各ページの文の頭（上の帯の下）に置く。
  if (reduced && w && scene) {
    const band = (el.querySelector<HTMLElement>(".ms-topband")?.offsetHeight ?? 0) + 8;
    const top = el.getBoundingClientRect().top - el.scrollTop;
    if (b) px.push(b.offsetTop + b.offsetHeight - vh);
    px.push(w.offsetTop);
    firstBeat = px.length;
    el.querySelectorAll<HTMLElement>(".ms-cap").forEach((c) => px.push(c.getBoundingClientRect().top - top - band));
    px.push(end);
    return { px: px.map((p) => Math.round(Math.min(end, Math.max(0, p)))), firstBeat, secs };
  }
  if (b) px.push(((b.offsetHeight - vh) * 1.35) / 2.8);
  if (w && scene) {
    const r = w.offsetHeight - vh;
    firstBeat = px.length;
    for (let i = 0; i < scene.beats; i++) {
      px.push(w.offsetTop + beatToProgress(weights, i + BEAT_REST) * r);
      secs[px.length - 1] = seconds[i] ?? SEC_PER_BEAT; // そのコマの朗読の秒数
    }
    // 場面の終わり（一枚の絵）：月が今夜の情報へ移りはじめる位置のわずか手前（丸めで移りはじめないように）。
    // 絵本の形の満月は、9ページが最後の一枚なので区切りを置かない（11/21 レビュー：ほぼ同じ絵へ一回むだに送っていた）。
    if (!book) {
      px.push(w.offsetTop + r - 2);
      secs[px.length - 1] = AFTER_SEC.frame;
    }
  } else if (b) px.push(b.offsetHeight - vh);
  if (ep) {
    px.push(ep.offsetTop + ep.offsetHeight / 2 - vh / 2);
    secs[px.length - 1] = AFTER_SEC.epilogue;
  }
  px.push(end);
  secs[px.length - 1] = AFTER_SEC.info;
  return {
    px: px.map((p) => Math.round(Math.min(end, Math.max(0, p)))),
    firstBeat,
    secs,
  };
}
/** 本棚の日付に添える年：今日から 330 日より先の満月だけ（それより近いものは月日だけで分かる）。 */
const farYear = (at: number) =>
  at - Date.now() > 330 * 86_400_000 ? Number(new Date(at + 9 * 3_600_000).toISOString().slice(0, 4)) : null;
const jst = (ms: number) => {
  const d = new Date(ms + 9 * HOUR_MS);
  return {
    date: d.toISOString().slice(0, 10),
    min: d.getUTCHours() * 60 + d.getUTCMinutes(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
  };
};

/** 一字ずつ浮かぶ文（読み上げは文のまま、字の箱は読み上げない）。 */
function Letters({ text }: { text: string }) {
  return (
    <>
      <span className="ms-sr">{text}</span>
      <span aria-hidden>
        {/* 改行（絵本の形のページの行の切れ目）は列を改める。字の番号（読む時刻）をずらさないよう、同じ組に入れる。 */}
        {[...text].map((c, i) =>
          c === "\n" ? (
            <br key={i} className="ms-ch" />
          ) : (
            <span key={i} className="ms-ch">
              {c}
            </span>
          ),
        )}
      </span>
    </>
  );
}

export function MoonStory({
  at,
  store,
  onClose,
  onList,
  onSky,
  onNext,
}: {
  at: number;
  store?: WeatherStore | null;
  onClose: () => void;
  onList?: () => void;
  /** 今夜の月を見る（月のこよみのその夜を開く。11/21 渡辺さん「アイデアも採用」）。 */
  onSky?: () => void;
  onNext?: (at: number) => void;
}) {
  const { lat, lon } = DEFAULT_LAT_LON;
  const root = useRef<HTMLDivElement>(null);
  const pager = useRef<Pager | null>(null);
  /** 場面の最初のコマの区切りの番号（ドットの 0 番）。場面が無ければ -1。 */
  const beatAt = useRef(-1);
  const j = jst(at);
  // その満月のイベント（食の日は食、ふだんは満月）と呼び名・説明。
  const event: SkyEvent = useMemo(() => {
    const e = skyEventOn(j.date, lat, lon);
    if (e && Math.abs(e.at - at) < 2 * 86_400_000) return e;
    const n = fullMoonName(at);
    return {
      kind: "full",
      at,
      name: n.name,
      blue: n.blue,
      span: null,
      obscuration: null,
    };
  }, [at, j.date, lat, lon]);
  const info: FullMoonNameInfo | null = event.name
    ? fullMoonInfo(event.name)
    : null;
  const story = event.blue ? { ...BLUE_MOON, short: BLUE_MOON.short } : info;
  const title = event.blue ? "ブルームーン" : (event.name ?? "満月");
  const facts = useMemo(
    () =>
      fullMoonsOfYear(Number(j.date.slice(0, 4)), lat, lon).find(
        (f) => Math.abs(f.at - at) < 2 * 86_400_000,
      ) ?? null,
    [j.date, lat, lon, at],
  );
  const tags = facts ? factTags(facts, WHERE) : [];
  const stage = eventStage(event.kind, event.blue, "navy");
  const pic = eventIcon(event) ?? eventArt(event, "navy")?.src ?? null;
  const wide = !eventIcon(event);
  // 絵本の場面（一文が一コマ）。場面の無い満月は、本の表紙と文だけ。
  // 絵本の形（book）を持つ満月は、そのページから（1ページ＝1コマ。行は改行で区切り、縦書きの列を改める）。
  const lines = story?.book ? story.book.pages.map((p) => p.lines.join("\n")) : (story?.tale?.lines ?? []);
  // 読み終えてから絵だけを見せる秒（絵本の形のページの rest）。
  const rests = story?.book ? story.book.pages.map((p) => p.rest ?? 0) : [];
  const linesKey = lines.join("\n") + rests.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 文の中身が同じなら同じ重み（配列は毎回作られる）
  const weights = useMemo(() => beatWeights(lines, rests, !!story?.book), [linesKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 同上
  const beatSecs = useMemo(() => beatSeconds(lines, rests, !!story?.book), [linesKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 同上
  const readings = useMemo(() => lines.map((t) => readingTimes(tateNum(t))), [linesKey]);
  // 場面は呼び名で引く（ブルームーンは「ブルームーン」で）。
  const sceneKey = event.blue ? "ブルームーン" : event.name;
  const scene =
    sceneKey && lines.length ? (STORY_SCENES[sceneKey] ?? null) : null;
  const World = scene?.World;
  const Win = scene?.Window;
  // 次の満月（一年を巡る物語）。
  // 本棚（11/20 18:01 渡辺さん「本棚っぽく。タップすると取り出すようなエフェクトからページが切り替わる」）：
  // 一年を巡る満月の物語を、暦の順（1月〜12月、ブルームーンは最後）に背を並べる。それぞれの本は、その呼び名の次の
  // 満月（今から5年先まで）を開く。読んでいる本は棚から抜けている。次に来る満月の本には「次」の印。
  const shelf = useMemo(() => {
    const y = Number(j.date.slice(0, 4));
    const all = [y, y + 1, y + 2, y + 3, y + 4].flatMap((yy) =>
      fullMoonsOfYear(yy, lat, lon),
    );
    const from = Math.min(at, Date.now()) - 12 * HOUR_MS;
    const later = all.filter(
      (f) => f.at > from && Math.abs(f.at - at) > 2 * 86_400_000,
    );
    const soon = all.find((f) => f.at > at + 86_400_000) ?? null;
    const books = [...FULL_MOON_NAMES.map((n) => n.name), "ブルームーン"].map(
      (name) => {
        const hit =
          later.find((f) =>
            name === "ブルームーン" ? f.blue : !f.blue && f.name === name,
          ) ?? null;
        const reading = name === (event.blue ? "ブルームーン" : event.name);
        const en =
          name === "ブルームーン"
            ? BLUE_MOON.en
            : (fullMoonInfo(name)?.en ?? "");
        return {
          name,
          en,
          at: hit?.at ?? null,
          reading,
          next: !!hit && !!soon && hit.at === soon.at,
        };
      },
    );
    return { books, soon };
  }, [j.date, lat, lon, at, event.blue, event.name]);
  const next = shelf.soon;
  // 本を取り出す：背が棚から持ち上がり、表紙をこちらへ向けながら画面の真ん中へ（次の物語の表紙と同じ位置・大きさ）。
  // そこで次の物語に切り替わる（次の物語は表紙から始まる）。動きを減らす設定では、すぐ切り替える。
  const pull = (
    e: React.MouseEvent<HTMLButtonElement>,
    book: { at: number | null; en: string; name: string },
  ) => {
    if (!book.at || !onNext) return;
    const target = book.at;
    const spine = e.currentTarget;
    const fly = root.current?.querySelector<HTMLElement>(".ms-flybook");
    if (
      !fly ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !spine.animate
    )
      return onNext(target);
    const r = spine.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(vw * 0.84, 340);
    const h = (w * 7) / 5;
    fly.querySelector("b")!.textContent = book.name;
    fly.querySelector(":scope > span")!.textContent = book.en;
    fly.style.cssText = `${spine.getAttribute("style") ?? ""}`;
    fly.hidden = false;
    spine.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-38%)" }],
      { duration: 220, easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" },
    );
    const from = `perspective(1200px) translate(${r.left}px, ${r.top - r.height * 0.38}px) scale(${r.width / w}, ${r.height / h}) rotateY(78deg)`;
    const to = `perspective(1200px) translate(${(vw - w) / 2}px, ${(vh - h) / 2}px) scale(1, 1) rotateY(0deg)`;
    fly.style.width = `${w}px`;
    fly.style.height = `${h}px`;
    const a = fly.animate(
      [
        { transform: from, opacity: 0 },
        { transform: from, opacity: 1, offset: 0.15 },
        { transform: to, opacity: 1 },
      ],
      {
        duration: 720,
        delay: 160,
        easing: "cubic-bezier(.45,.05,.25,1)",
        fill: "forwards",
      },
    );
    a.onfinish = () => onNext(target);
  };
  // 情報の見出し（11/21 渡辺さん「前日＋当日」）：見出しに出ている間は「今夜の」「明日の夜の」、それ以外は「◯/◯ の夜の」。
  const when = useMemo(() => {
    const shown = skyEventShown(Date.now(), lat, lon);
    if (shown && shown.event.at === event.at) return shown.phase === "eve" ? "明日の夜の" : "今夜の";
    const n = eventNight(event);
    return `${Number(n.slice(5, 7))}/${Number(n.slice(8))} の夜の`;
  }, [event, lat, lon]);
  // 窓の外の月（11/21 渡辺さん「アイデアも採用」、shared/windowMoon.ts）：締めくくりに、いまの空の具合で一言。
  // 雲は高知の観測所のいまの時間（読めていなければ分からないとして言い切らない）。
  const windowLine = useMemo(() => {
    const now = Date.now();
    const t = jst(now);
    const rows = store?.getHours(SKY_STATION, t.date).rows ?? [];
    const h = rows.length ? skyHidden(rows, Math.floor(t.min / 60) + 1, SKY_STATION) : null;
    return windowMoonLine(now, event, lat, lon, h ? h.hidden : null, dirName);
  }, [event, lat, lon, store]);
  // 読み終わりのしおり（11/21）：次の物語までの日数（日本時間の日付で数える）。
  const daysTo = (ms: number) =>
    Math.round((Date.parse(`${jst(ms).date}T00:00:00+09:00`) - Date.parse(`${jst(Date.now()).date}T00:00:00+09:00`)) / 86_400_000);

  // 閉じる：Esc と、開いている間は後ろをスクロールさせない。
  // 開いている間は、Tab のフォーカスを物語の中で回し、閉じたら開いたボタンへ戻す（11/21 レビュー：Tab で後ろのアプリへ
  // 出ていき、閉じたあとは body に残っていた）。
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const el = root.current;
      if (e.key !== "Tab" || !el) return;
      const f = [...el.querySelectorAll<HTMLElement>("button, a[href], input, [tabindex]:not([tabindex='-1'])")].filter(
        (x) => !x.hasAttribute("disabled") && x.offsetParent !== null,
      );
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === first || cur === el || !el.contains(cur))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (cur === last || !el.contains(cur))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.focus();
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [onClose]);

  // スクロールの演出（GSAP + ScrollTrigger、このページを開いたときだけ読み込む）。GSAP 公式スキル（greensock/gsap-skills）
  // の決まりに合わせる：動きを減らす設定は gsap.matchMedia で分け（設定が変わっても直る）、ScrollTrigger はページの上から
  // 順に作り、タイムラインの上にだけ付け、くり返す動きは見えない間は止め、字が読み込まれたら位置を測り直す。
  const [ready, setReady] = useState(false);
  // 物語をとばす（今夜の情報へ）：情報が見えたら消す。場面を押すと次の場面へ（スクロールで進むのと同じ）。
  const [skip, setSkip] = useState(true);
  useEffect(() => {
    const el = root.current;
    const info = el?.querySelector<HTMLElement>("[data-story-end]");
    if (!el || !info) return;
    const watch = () =>
      setSkip(info.getBoundingClientRect().top > el.clientHeight * 0.6);
    el.addEventListener("scroll", watch, { passive: true });
    return () => el.removeEventListener("scroll", watch);
  }, []);
  // 止まって数秒（IDLE_MS）さわらないと、下に「上にスワイプ」をそっと出す。さわる・動くと消える。今夜の情報から下は出さない。
  useEffect(() => {
    const el = root.current;
    const hint = el?.querySelector<HTMLElement>(".ms-swipe-hint");
    if (!el || !hint) return;
    const IDLE_MS = 3500;
    let timer = 0;
    const show = () => {
      const info = el.querySelector<HTMLElement>("[data-story-end]");
      if (info && el.scrollTop >= info.offsetTop - 4) return;
      // 表紙（いちばん上）には「スクロールでページをひらく」があるので出さない。
      if (el.scrollTop < 8) return;
      // 場面の中では、押しても次へ進むので「タップかスワイプで次へ」（11/21 渡辺さん「スワイプ以外にも」→ 押して進むことを伝える）。
      const w = el.querySelector<HTMLElement>(".ms-world");
      const inWorld = !!w && el.scrollTop >= w.offsetTop - 4 && el.scrollTop < w.offsetTop + w.offsetHeight - el.clientHeight;
      hint.classList.toggle("tap", inWorld);
      hint.classList.add("on");
    };
    const poke = () => {
      hint.classList.remove("on");
      window.clearTimeout(timer);
      timer = window.setTimeout(show, IDLE_MS);
    };
    const evs = ["scroll", "touchstart", "wheel", "keydown", "pointerdown"] as const;
    evs.forEach((ev) => el.addEventListener(ev, poke, { passive: true }));
    poke();
    return () => {
      window.clearTimeout(timer);
      evs.forEach((ev) => el.removeEventListener(ev, poke));
    };
  }, []);
  const skipStory = () => {
    const el = root.current;
    const info = el?.querySelector<HTMLElement>("[data-story-end]");
    if (el && info && pager.current) pager.current.glide(info.offsetTop);
    else info?.scrollIntoView({ behavior: "smooth" });
  };
  // 場面を押すと次のコマへ（ページ送りと同じ動き）。
  const nextBeat = () => pager.current?.step(1);
  // 下のドットを押すと、そのコマへ（同じ動き）。ドットの列が一つのボタン（高さ 44px）で、押した所に近いドットへ。
  const toDot = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // キーで押したとき（位置が無い）は動かさない。キーでは ←→ で前後のページへ（11/21 レビュー：Enter で必ず
    // 1ページ目へ戻っていた）。
    if (e.detail === 0) return;
    const dots = [...e.currentTarget.querySelectorAll<HTMLElement>(".ms-beat")];
    if (!dots.length || beatAt.current < 0) return;
    let k = 0;
    dots.forEach((d, i) => {
      const r = d.getBoundingClientRect();
      const r0 = dots[k].getBoundingClientRect();
      if (
        Math.abs(r.left + r.width / 2 - e.clientX) <
        Math.abs(r0.left + r0.width / 2 - e.clientX)
      )
        k = i;
    });
    pager.current?.goTo(beatAt.current + k);
  };
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let mm: { revert: () => void } | null = null;
    let unPager = () => {};
    let live = true;
    void (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (!live) return;
      gsap.registerPlugin(ScrollTrigger);
      const media = gsap.matchMedia(el);
      mm = media;
      // 動きを減らす設定：場面は動かさず、月が昇ったあとの一枚の絵として見せる（文はその下に全部）。
      media.add("(prefers-reduced-motion: reduce)", () => {
        if (!scene) return;
        const tl = gsap.timeline({ paused: true });
        scene.build(gsap as never, el, tl as never, false);
        tl.progress((scene.still ?? scene.beats - 1.5) / scene.beats);
      });
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const scroller = el;
        const scrub = (trigger: string) => ({
          trigger: el.querySelector(trigger),
          scroller,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.6,
        });
        // 1. 本：表紙が左へ開いて見開きになる（本は右へ寄りながら小さくなり、見開きが画面に収まる）。表紙は開くほど
        //    暗く、ページには表紙の影が落ちて消える。続いて文が消え、ページの中へ寄っていき、紙の色で次の場面へつなぐ。
        // 本は場面が止まる位置まで留まり（場面はその下に重なって上がってくる）、最後に窓の空の色で覆って、本の舞台を消す。
        // 場面は止まるとすぐにその色から溶けて現れるので、何も無い時間をはさまない（11/20 17:58 渡辺さん「夕焼けが長すぎる」）。
        const book = gsap.timeline({
          scrollTrigger: { ...scrub(".ms-book"), invalidateOnRefresh: true },
        });
        // 窓が画面を覆う大きさと、窓の真ん中を画面の真ん中へ動かす量（本の真ん中を軸に大きくする）。
        const dive = () => {
          const b = el.querySelector<HTMLElement>(".ms-book .bk");
          const w = el.querySelector<HTMLElement>(".ms-book .bk-window");
          if (!b || !w) return { s: 4, x: 0, y: 0 };
          const s =
            Math.max(
              el.clientWidth / w.offsetWidth,
              el.clientHeight / w.offsetHeight,
            ) * 1.04;
          const dx = w.offsetLeft + w.offsetWidth / 2 - b.offsetWidth / 2;
          const dy = w.offsetTop + w.offsetHeight / 2 - b.offsetHeight / 2;
          return { s, x: -s * dx, y: -s * dy };
        };
        book
          .to(".ms-book-hint", { opacity: 0, duration: 0.1 }, 0)
          // 縮めたあとに背（左の端）が画面の真ん中に来るよう、ずらす量は 50% × 縮める割合。
          .fromTo(
            ".ms-book .bk",
            { xPercent: 0, scale: 1 },
            {
              xPercent: 50 * SPREAD,
              scale: SPREAD,
              ease: "power2.inOut",
              duration: 1,
            },
            0.3,
          )
          // 表紙は背（左の端）を軸に、前半で起き上がり（幅が縮み、手前に来るので少し大きく、影が濃く）、後半で表紙の裏が
          // 左へ倒れて見開きになる（幅が広がり、影が抜ける）。背でつながったまま、二つのページは同じ大きさ（11/20 16:23
          // 渡辺さん「ページが離れていく動きが不自然」）。
          .fromTo(
            ".ms-book .bk-cover",
            { scaleX: 1, scaleY: 1 },
            { scaleX: 0, scaleY: 1.05, ease: "power2.in", duration: 0.5 },
            0.3,
          )
          .fromTo(
            ".ms-book .bk-cover-shade",
            { opacity: 0 },
            { opacity: 0.6, ease: "power1.in", duration: 0.5 },
            0.3,
          )
          .fromTo(
            ".ms-book .bk-back",
            { scaleX: 0, scaleY: 1.05 },
            { scaleX: 1, scaleY: 1, ease: "power2.out", duration: 0.5 },
            0.8,
          )
          .fromTo(
            ".ms-book .bk-back-shade",
            { opacity: 0.6 },
            { opacity: 0, ease: "power1.out", duration: 0.5 },
            0.8,
          )
          .fromTo(
            ".ms-book .bk-page-shadow",
            { opacity: 1 },
            { opacity: 0, ease: "power1.out", duration: 0.9 },
            0.4,
          )
          // 窓の中へ寄る：窓が画面いっぱいになるまで本を大きくし、窓の真ん中を画面の真ん中へ。文と枠は先に消える。
          .to(
            [
              ".ms-book .bk-page-text > small",
              ".ms-book .bk-page-text > h3",
              ".ms-book .bk-page .bk-frame",
            ],
            { opacity: 0, duration: 0.25 },
            1.65,
          )
          .to(
            ".ms-book .bk",
            {
              xPercent: 0,
              scale: () => dive().s,
              x: () => dive().x,
              y: () => dive().y,
              ease: "power2.inOut",
              duration: 1,
            },
            1.75,
          )
          .to(".ms-book-dive", { opacity: 1, duration: 0.25 }, 2.55)
          .set(".ms-book > .ms-sticky", { autoAlpha: 0 }, 2.8);
        // 場面の無い満月：覆った夜の色は本の終わりに自分で溶かす（場面が溶かす役をしないので）。
        if (!scene)
          book.to(".ms-dive-wrap", { opacity: 0, duration: 0.3 }, 2.8);
        // 表紙のメダルの光が脈打つ（本が画面にある間だけ）。
        const glow = gsap.to(".bk-medal-glow", {
          opacity: 0.85,
          duration: 2.6,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
          paused: true,
        });
        ScrollTrigger.create({
          trigger: el.querySelector(".ms-book"),
          scroller,
          start: "top bottom",
          end: "bottom top",
          onToggle: (t) => (t.isActive ? glow.play() : glow.pause()),
        });
        // 絵本の形の満月の終わり（11/21 渡辺さん「出だしが絵本を開くから始まるなら、最後は閉じるで終わった方が」）：
        // 自然と科学を読み終えたら、開いたときの見開きから、開くのと逆の順に本を閉じる（表紙の裏が起き上がり、表紙が右の
        // ページにかぶさる）。閉じた本の表は、深い紺の革に金の枠と副題だけ。そのあと今夜の月（本の外、本物の空）へ。
        if (el.querySelector(".ms-endbook")) {
          gsap
            .timeline({ scrollTrigger: scrub(".ms-endbook") })
            .fromTo(".ms-endbook .bk", { xPercent: 50 * SPREAD, scale: SPREAD }, { xPercent: 0, scale: 1, ease: "power2.inOut", duration: 1 }, 0.15)
            .fromTo(".ms-endbook .bk-back", { scaleX: 1, scaleY: 1 }, { scaleX: 0, scaleY: 1.05, ease: "power2.in", duration: 0.5 }, 0.15)
            .fromTo(".ms-endbook .bk-back-shade", { opacity: 0 }, { opacity: 0.6, ease: "power1.in", duration: 0.5 }, 0.15)
            .fromTo(".ms-endbook .bk-cover", { scaleX: 0, scaleY: 1.05 }, { scaleX: 1, scaleY: 1, ease: "power2.out", duration: 0.5 }, 0.65)
            .fromTo(".ms-endbook .bk-cover-shade", { opacity: 0.6 }, { opacity: 0, ease: "power1.out", duration: 0.5 }, 0.65)
            .fromTo(".ms-endbook .bk-page-shadow", { opacity: 0 }, { opacity: 1, ease: "power1.in", duration: 0.5 }, 0.3)
            .to({}, { duration: 0.35 }, 1.15);
        }
        // 2. 絵本の場面：一文ごとに一コマ。紙が中心から溶けて絵が現れ、文は空に一字ずつ浮かぶ。
        if (scene) {
          // 場面のタイムラインはコマの番号（0〜コマ数）で組み、スクロールとは字の数で重みを付けた割合でつなぐ。
          const world = gsap.timeline({ paused: true });
          // 窓の絵（場面の最初の空）から、本当の場面へ溶ける。
          // 本の終わりに画面を覆った空の色（.ms-book-dive は画面に固定）は、場面が止まってから溶ける。場面が下から
          // 上がってくる間は覆ったままなので、境目は見えない。
          world.fromTo(
            ".ms-dive-wrap",
            { opacity: 1 },
            {
              opacity: 0,
              ease: "power1.in",
              duration: 0.3,
              immediateRender: false,
            },
            0,
          );
          const loop = scene.build(gsap as never, el, world as never);
          lines.forEach((text, i) => {
            const cap = `.ms-cap[data-i="${i}"]`;
            const secs = beatSecs[i] ?? SEC_PER_BEAT;
            // 絵本の形のページ（11/21 絵コンテ v0.3）：字は朗読の速さのまま出し、読み終えたあとは rest の秒だけ絵を見せる。
            // 行を出す所が決まっているページ（6 月が昇る）は、絵の動きに合わせて行ごとに。
            const times = story?.book ? revealTimes(tateNum(text), secs, scene.lineAt?.[i]) : null;
            // 最後のページ（9）は、文だけが先に消え、止まる所では絵だけが rest の秒残る（絵コンテ「文が消えて絵が残る」）。
            const lastBook = !!story?.book && i === lines.length - 1;
            const fadeAt = lastBook ? REVEAL_START + ((readings[i]?.total ?? 0) + LAST_TAIL) / secs : CAP_OUT;
            // 次のページの文は、前のページの文が消えたらすぐ（コマの頭より少し前から）出しはじめる（11/21 レビュー：送って
            // から次の文が出るまで約5秒、何も無い時間があった）。
            const at = i + REVEAL_START - (i === 0 ? 0.04 : CAP_LEAD);
            world
              .set(cap, { opacity: 1 }, at)
              .fromTo(
                `${cap} .ms-ch`,
                // 字は inline（11/21 レビュー：一字ずつ inline-block にしていたので、行頭の句点を避ける決まりが効かず、
                // 「。」だけが次の列の頭に来ていた）。inline には位置の動きが効かないので、滲みと透け具合だけで出す。
                { opacity: 0, filter: "blur(3px)" },
                {
                  opacity: 1,
                  filter: "blur(0px)",
                  duration: 0.12,
                  ease: "power1.out",
                  // 朗読の間：一字ずつ、読む時刻に合わせて（読点・句点で間をおく）。
                  stagger: (k: number) => {
                    if (times) return (times[k] ?? REVEAL_END) - REVEAL_START;
                    const r = readings[i];
                    return r && r.total > 0 ? ((r.at[k] ?? r.total) / r.total) * (REVEAL_END - REVEAL_START - 0.12) : 0;
                  },
                },
                at,
              )
              .to(
                cap,
                {
                  opacity: 0,
                  y: lastBook ? 0 : -12,
                  filter: "blur(2px)",
                  duration: lastBook ? 0.06 : CAP_OUT_DUR,
                  ease: "power1.in",
                },
                i + fadeAt,
              )
              .set(cap, { y: 0, filter: "blur(0px)" }, i + 1);
          });
          world.fromTo(
            ".ms-world-frame",
            { opacity: 0, scale: 1.06 },
            { opacity: 1, scale: 1, duration: 0.5 },
            scene.beats - 0.75,
          );

          world.set({}, {}, scene.beats);
          gsap.fromTo(
            world,
            { time: 0 },
            {
              time: scene.beats,
              duration: 1,
              ease: (p: number) => progressToBeat(weights, p) / scene.beats,
              scrollTrigger: scrub(".ms-world"),
            },
          );
          // 場面から締めくくりへ移るとき、外の金の枠は背景の色へ溶けて消える（11/20 22:11 渡辺さん）。枠の出入りは場面の
          // タイムラインが枠（.ms-world-frame）の不透明度で持つので、ここは中の絵（svg）の不透明度で（同じ値を二つで動かさない）。
          const ep = el.querySelector(".ms-epilogue") ?? el.querySelector("[data-story-end]");
          if (ep)
            gsap.fromTo(
              // 下のドットも一緒に（11/21 レビュー：場面の絵が消えたあと、ドットだけが空に残っていた）。
              ".ms-world-frame > svg, .ms-beats",
              { opacity: 1 },
              {
                opacity: 0,
                ease: "power1.in",
                scrollTrigger: {
                  trigger: ep,
                  scroller,
                  start: "top bottom",
                  end: "top 60%",
                  scrub: 0.4,
                },
              },
            );
          // 物語の月 → 今夜の情報の月：場面が画面から出始めてから、瞬間のカードの月が所定の位置に来るまで、浮かぶ月が
          // 二つの月の間を（どちらも今の位置から測って）移る。途中は元の二つの月を隠す。
          const fly = el.querySelector<HTMLElement>(".ms-flymoon");
          // 場面の月の目印は、どの場面でも StoryMoon（src/design/story/parts.tsx）が付ける。
          const from = el.querySelector<SVGGElement>("[data-story-moon]");
          const disc = el.querySelector<SVGElement>("[data-story-disc]");
          const to = () =>
            el.querySelector<HTMLElement>(".ms-info .emc-sky > canvas");
          const ease = gsap.parseEase("power2.inOut");
          const place = (p: number) => {
            const target = to();
            if (!fly || !from || !disc || !target) return;
            const moving = p > 0 && p < 1;
            fly.style.opacity = moving ? "1" : "0";
            from.style.opacity = p > 0 ? "0" : "";
            target.style.opacity = p < 1 ? "0" : "";
            if (!moving) return;
            const a = disc.getBoundingClientRect();
            const b = target.getBoundingClientRect();
            const k = ease(p);
            const size = a.width + (b.width - a.width) * k;
            const cx =
              a.left +
              a.width / 2 +
              (b.left + b.width / 2 - a.left - a.width / 2) * k;
            const cy =
              a.top +
              a.height / 2 +
              (b.top + b.height / 2 - a.top - a.height / 2) * k;
            gsap.set(fly, {
              width: size,
              height: size,
              x: cx - size / 2,
              y: cy - size / 2,
            });
          };
          ScrollTrigger.create({
            trigger: el.querySelector(".ms-world"),
            scroller,
            start: "bottom bottom",
            // 終わりは今夜の情報の区切り（情報の頭が画面の上）ちょうど（11/20 22:44 渡辺さん「レイヤーの確認」：
            // カードの真ん中で測っていたため、区切りで止まると移る途中のまま、カードの月が隠れていた）。
            endTrigger: el.querySelector(".ms-info"),
            end: "top top",
            onUpdate: (t) => place(t.progress),
            onLeave: () => place(1),
            onLeaveBack: () => place(0),
          });
          // 落ち葉や雪は、場面が画面にある間だけ動かす。
          if (loop)
            ScrollTrigger.create({
              trigger: el.querySelector(".ms-world"),
              scroller,
              start: "top bottom",
              end: "bottom top",
              onToggle: (t) => (t.isActive ? loop.play() : loop.pause()),
            });
        }
        // 3〜6. 文・札・段落が、ページの上から順に浮かび上がる。
        gsap.utils
          .toArray<HTMLElement>(".ms-rise, .ms-fact, .ms-tale-line", el)
          .forEach((t) => {
            const at = { trigger: t, scroller, scrub: 0.5 };
            // clamp：ページの終わり近くの段も、いちばん下までスクロールすれば浮かび終わる（途中で止まって重ならない）。
            if (t.classList.contains("ms-fact"))
              gsap.fromTo(
                t,
                { opacity: 0, scale: 0.86 },
                {
                  opacity: 1,
                  scale: 1,
                  ease: "back.out(1.6)",
                  scrollTrigger: {
                    ...at,
                    start: "clamp(top 90%)",
                    end: "clamp(top 65%)",
                  },
                },
              );
            else if (t.classList.contains("ms-tale-line"))
              gsap.fromTo(
                t,
                { opacity: 0.14, y: 16 },
                {
                  opacity: 1,
                  y: 0,
                  ease: "none",
                  scrollTrigger: {
                    ...at,
                    start: "clamp(top 80%)",
                    end: "clamp(top 48%)",
                  },
                },
              );
            else
              gsap.fromTo(
                t,
                { opacity: 0, y: 48 },
                {
                  opacity: 1,
                  y: 0,
                  ease: "none",
                  scrollTrigger: {
                    ...at,
                    start: "clamp(top 92%)",
                    end: "clamp(top 62%)",
                  },
                },
              );
          });
        // 紙を重ねる（11/21 渡辺さん「カードとカードは下から上に来るだけ。もうちょい表現を」→ おすすめの「紙を重ねる＋インクが浮かぶ」）：
        // 次の紙は少し傾いて下から滑り込み、まっすぐ落ち着く。前の紙は少し遅れて奥へ沈み、暗くなる（次の紙がその上に重なる）。
        // 沈むのは外の .ms-sheet、滑り込むのは内の .ms-sheet-in（同じ要素の同じ値を二つの動きで取り合わない）。
        const sheets = gsap.utils.toArray<HTMLElement>(".ms-sheet", el);
        sheets.forEach((sh, i) => {
          const inner = sh.querySelector<HTMLElement>(".ms-sheet-in");
          if (inner)
            gsap.fromTo(
              inner,
              { opacity: 0, y: 96, rotate: i % 2 ? 1.6 : -1.6 },
              {
                opacity: 1,
                y: 0,
                rotate: 0,
                ease: "power2.out",
                scrollTrigger: {
                  trigger: sh,
                  scroller,
                  start: "clamp(top 100%)",
                  end: "clamp(top 58%)",
                  scrub: 0.6,
                },
              },
            );
          // 沈むのは、次の紙が別の章のときだけ（今夜の情報の二枚は並べて読むので、上の一枚を隠さない）。
          const next = sheets[i + 1];
          if (next && next.closest("section") !== sh.closest("section"))
            gsap.fromTo(
              sh,
              { y: 0, scale: 1, opacity: 1 },
              {
                y: 72,
                scale: 0.94,
                opacity: 0.5,
                ease: "none",
                immediateRender: false,
                scrollTrigger: {
                  trigger: next,
                  scroller,
                  start: "top 92%",
                  end: "top 30%",
                  scrub: 0.6,
                },
              },
            );
        });
        // インクが浮かぶ：紙が落ち着くと、見出しが滲みからくっきりへ。本文は段ごとに（小見出しはその本文と組で）、
        // スクロールの量に合わせて、読む位置に来た所からくっきりする（11/21 渡辺さん「ブロックに分けてスワイプの距離に
        // 応じて」：時間で順に出していたので、下の段が滲んだまま待たされていた）。象徴の札ははんこのように、下のセピアの
        // 絵は下から塗るように、それぞれが画面に入ったとき。戻ると消え、もう一度来ると浮かぶ。
        gsap.utils.toArray<HTMLElement>(".ms-paper", el).forEach((pp) => {
          const q = (sel: string) =>
            gsap.utils.toArray<HTMLElement>(sel, pp);
          const head = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
          head.fromTo(
            q(".ms-phases, .ms-paper-kicker, h3, .ms-leafrule, .bk-flourish"),
            { opacity: 0, filter: "blur(6px)" },
            { opacity: 1, filter: "blur(0px)", duration: 1.1, stagger: 0.25 },
          );
          ScrollTrigger.create({
            trigger: pp,
            scroller,
            start: "top 62%",
            onEnter: () => head.play(),
            onLeaveBack: () => head.reverse(),
          });
          q(":scope > p:not(.ms-symbols)").forEach((para) => {
            const sub = para.previousElementSibling?.tagName === "H4" ? (para.previousElementSibling as HTMLElement) : null;
            const block = sub ? [sub, para] : [para];
            gsap.fromTo(
              block,
              { opacity: 0, filter: "blur(4px)" },
              {
                opacity: 1,
                filter: "blur(0px)",
                ease: "none",
                stagger: 0.15,
                scrollTrigger: {
                  trigger: sub ?? para,
                  scroller,
                  start: "top 94%",
                  end: "top 70%",
                  scrub: 0.3,
                },
              },
            );
          });
          const stamps = q(".ms-symbols em");
          if (stamps.length) {
            const st = gsap.timeline({ paused: true });
            st.fromTo(
              stamps,
              { opacity: 0, scale: 1.5 },
              { opacity: 1, scale: 1, duration: 0.3, ease: "power4.in", stagger: 0.32 },
            );
            ScrollTrigger.create({
              trigger: stamps[0],
              scroller,
              start: "top 85%",
              onEnter: () => st.play(),
              onLeaveBack: () => st.reverse(),
            });
          }
          const art = q(".ms-paper-art");
          if (art.length)
            gsap.fromTo(
              art,
              { clipPath: "inset(100% 0% 0% 0%)" },
              {
                clipPath: "inset(0% 0% 0% 0%)",
                ease: "none",
                scrollTrigger: { trigger: art[0], scroller, start: "top 95%", end: "bottom 80%", scrub: 0.3 },
              },
            );
        });
        // 空の色が進む（11/21 渡辺さん「アイデアも採用」）：表紙のあたりは夕方の色、場面を読み進めるうちに夜へ、締めくくり
        // から先は深夜へ。地の色（.moon-story の --sky-0 / --sky-1）だけを、スクロールに合わせて変える。
        const after = el.querySelector(".ms-epilogue") ?? el.querySelector("[data-story-end]");
        gsap.fromTo(
          el,
          { "--sky-0": BOOK.dusk[0], "--sky-1": BOOK.dusk[1] },
          {
            "--sky-0": BOOK.night[0],
            "--sky-1": BOOK.night[1],
            ease: "none",
            scrollTrigger: {
              trigger: el.querySelector(".ms-world") ?? el.querySelector(".ms-book"),
              scroller,
              start: "top bottom",
              end: "bottom bottom",
              scrub: true,
            },
          },
        );
        if (after)
          gsap.fromTo(
            el,
            { "--sky-0": BOOK.night[0], "--sky-1": BOOK.night[1] },
            {
              "--sky-0": BOOK.deep[0],
              "--sky-1": BOOK.deep[1],
              ease: "none",
              immediateRender: false,
              scrollTrigger: {
                trigger: after,
                scroller,
                start: "top bottom",
                endTrigger: el.querySelector(".ms-tonight") ?? after,
                end: "top bottom",
                scrub: true,
              },
            },
          );
        // 読み終わりのしおり（11/21）：本棚が見えると、読んでいた本の抜けた所に金のしおりが上から下りて、少し揺れて止まる。
        const mark = el.querySelector(".ms-bookmark");
        if (mark)
          gsap.fromTo(
            mark,
            { scaleY: 0, rotate: 0 },
            {
              keyframes: [
                { scaleY: 1, duration: 0.9, ease: "power2.out" },
                { rotate: 4, duration: 0.35, ease: "sine.inOut" },
                { rotate: -2, duration: 0.4, ease: "sine.inOut" },
                { rotate: 0, duration: 0.5, ease: "sine.out" },
              ],
              scrollTrigger: {
                trigger: el.querySelector(".ms-shelf"),
                scroller,
                start: "top 70%",
                toggleActions: "play none none reverse",
              },
            },
          );
        // 区切りのドットは、場面の動きではなく、ページ送りの「いまの区切り」で灯す（storyPager の onIndex）。
      });
      // 明朝の字が読み込まれると高さが変わるので、測り直す。
      void document.fonts?.ready.then(() => live && ScrollTrigger.refresh());
      // ページ送り（11/20 20:17 渡辺さん「慣性スクロール・スナップ改善」、src/ui/storyPager.ts）：物語の部分は、指の
      // 動きから行き先の区切りを決めて、指を離した速さのまま滑らかに運ぶ。区切りは ScrollTrigger が測り直すたびに取り直す。
      let firstBeat = -1;
      let secs: (number | undefined)[] = [];
      const dots = [...el.querySelectorAll<HTMLElement>(".ms-beat")];
      const pg = storyPager(el, {
        measure: () => {
          const m = storyStops(el, scene, weights, beatSecs, !!story?.book, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
          firstBeat = m.firstBeat;
          beatAt.current = firstBeat;
          secs = m.secs;
          return m.px;
        },
        reduced: () =>
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        seconds: (i) => secs[i],
        // 本編（場面）の頭より前は区切りへ運ばない。場面の無い満月は、本の後ろ（文の章）から。
        freeBefore: () =>
          (el.querySelector<HTMLElement>(".ms-world")?.offsetTop ?? 0) - 1,
        // 見開きから1ページ目へ：場面の頭までは短く、そこから朗読の速さで（11/21 レビュー：文が出るまで約10秒）。
        waypoint: () => {
          const w = el.querySelector<HTMLElement>(".ms-world");
          return w && scene ? w.offsetTop : undefined;
        },
        onIndex: (i) => {
          const nb = el.querySelector(".ms-beats");
          const cur = i - firstBeat;
          if (nb && cur >= 0 && cur < dots.length)
            nb.setAttribute("aria-label", `ページを選ぶ（いま ${cur + 1}/${dots.length}、← → で前後のページ）`);
          dots.forEach((d, k) =>
            d.classList.toggle("on", firstBeat >= 0 && k === i - firstBeat),
          );
        },
      });
      pager.current = pg;
      ScrollTrigger.addEventListener("refresh", pg.refresh);
      unPager = () => {
        ScrollTrigger.removeEventListener("refresh", pg.refresh);
        pg.destroy();
        pager.current = null;
      };
      setReady(true);
    })();
    return () => {
      live = false;
      mm?.revert();
      unPager();
    };
  }, [scene, weights, readings, beatSecs]);

  const style = {
    ...(onSkyVars() as CSSProperties),
    ...bookVars(),
    // 場面の長さ（スクロール）は、コマごとの重み（朗読の秒数の平方根）の合計 × 110svh。
    ["--beats" as string]: scene ? weights.reduce((a, b) => a + b, 0) : 0,
    ["--ms-scene-sky" as string]: scene?.sky ?? "none",
    ["--ev-glow" as string]: stage.glow,
    ["--ev-line" as string]: stage.line,
    ["--ev-star" as string]: stage.star,
  } as CSSProperties;

  // 今夜の情報（今夜の月）。物語の終わり（ページ送りの最後の区切り）は data-story-end の章：ふだんは今夜の情報、
  // 絵本の形（book）を持つ満月は、あとがきの章（今夜の情報は自然と科学のあとへ下がる）。
  // 3. 今夜の情報（11/20 渡辺さん「物語の最後には情報も」）：イベントの説明と同じカード。
  const infoBlock = (
  <section className="ms-chapter ms-info" data-story-end={story?.book ? undefined : ""}>
    <small className="ms-rise">
      {/* 満月の夜の日付（11/21：コールドムーンは瞬間が 12/24 の朝なので、見る夜は 12/23。瞬間の日付を出すと「12月24日・今夜の」と
          食い違っていた）。瞬間の日時は下のカードに。 */}
      {Number(eventNight(event).slice(5, 7))}月{Number(eventNight(event).slice(8))}日の夜
    </small>
    <h3 className="ms-rise">{when}{title}</h3>
    {/* 紙を重ねる見せ方（11/21 渡辺さん「おすすめで」）：外の .ms-sheet が奥へ沈み、内の .ms-sheet-in が傾いて滑り込む。 */}
    <div className="ms-sheet">
      <div className="ms-sheet-in ms-card">
        <EventMomentCard event={event} stage={stage} />
      </div>
    </div>
    <div className="ms-sheet">
      <div className="ms-sheet-in ms-card">
        <EventNightCard
          event={event}
          stage={stage}
          store={store}
          tag="moon-story"
        />
      </div>
    </div>
    {/* 窓の外の月の一言：締めくくりを出さない満月（book）は、今夜の情報の中で。 */}
    {story?.book && windowLine && <p className="ms-window ms-rise">{windowLine}</p>}
    {/* 今夜の情報から空へ（11/21 渡辺さん「アイデアも採用」）：月のこよみのその夜（見え方・空の明るさ）を開く。 */}
    {onSky && (
      <Button size="sm" className="ms-sky-btn ms-rise" onClick={onSky}>
        {when}月を見る
        <Glyph name="next" />
      </Button>
    )}
    {tags.length > 0 && (
      <p className="fm-tags ms-rise">
        {tags.map((t) => (
          <em key={t}>{t}</em>
        ))}
      </p>
    )}
  </section>
  );
  return (
    <div
      className={ready ? "moon-story ready" : "moon-story"}
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={`${title}の物語`}
      tabIndex={-1}
      style={style}
    >
      {/* 上の帯：閉じる・とばすの下を夜の色で薄く覆い、文と重ならないように（11/20 17:58 渡辺さん「✖️ボタンとの文字被り」）。 */}
      <GoldDefs />
      <span className="ms-topband" aria-hidden />
      {/* 止まって数秒さわらないと「上にスワイプ」（11/20 23:45 渡辺さん）。物語の部分（今夜の情報より上）だけ。 */}
      <span className="ms-swipe-hint" aria-hidden>
        <Glyph name="up" />
        <span className="ms-hint-swipe">上にスワイプ</span>
        <span className="ms-hint-tap">タップかスワイプで次へ</span>
      </span>
      {/* 本棚から取り出す本（押したときだけ見える）。 */}
      <span className="ms-flybook" aria-hidden hidden>
        <GoldFrame />
        <CloudMark className="bk-cloud" />
        <b />
        <span />
      </span>
      <div className={skip ? "ms-skip" : "ms-skip gone"}>
        <Button size="sm" kind="quiet" onClick={skipStory}>
          物語をとばす
        </Button>
      </div>
      {/* 物語の月を、今夜の情報の月へ引き継ぐ（16:45 のレビュー「同じ月が形を変えて次の画面へ」）。 */}
      {/* 絵本の形（book）の満月は移さない：物語の月は9ページの絵の中に残る（11/21 承認：物語の月は表現、今夜の月は計算）。 */}
      {scene && !story?.book && <span className="ms-flymoon" aria-hidden />}
      {/* 本の終わりに画面を覆う空の色（画面に固定。場面の上に重ねるので、本の舞台の外に置く）。 */}
      {/* 覆うのは本が（中の色）、溶かすのは場面が（外の枠）。同じ値を二つのタイムラインで動かさない。 */}
      <span className="ms-dive-wrap" aria-hidden>
        <span className={scene ? "ms-book-dive scene" : "ms-book-dive"} />
      </span>
      <div className="ms-close">
        <IconButton label="閉じる" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>

      {/* 1. 本：紺の革の表紙（金の枠・満月のメダル・英語の名前を主に、日本語は小さく）が開き、紙のページにひと言。 */}
      <section className="ms-book">
        <div className="ms-sticky ms-book-stage">
          <span className="event-stars" aria-hidden>
            {STARS.map(([x, y, r, d], i) => (
              <i
                key={i}
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: r,
                  height: r,
                  animationDelay: `${d}s`,
                }}
              />
            ))}
            <b className="event-shoot" />
          </span>
          <div className="bk">
            <div className="bk-page">
              <div className="bk-inner">
                <GoldFrame />
                <div className="bk-page-text">
                  <small>{j.m}月の満月の物語</small>
                  {/* ページの窓：場面の最初のコマの小さな絵。この中へ寄って場面に入る（16:45 のレビュー「ページの中に風景が
                      広がる連続的な転換」）。場面の無い満月は、その満月の絵。 */}
                  <div className="bk-window">
                    {Win ? (
                      <Win />
                    ) : (
                      pic && (
                        <img
                          src={pic}
                          alt=""
                          className={wide ? "wide" : undefined}
                        />
                      )
                    )}
                  </div>
                  {/* 絵本の形の満月は、副題が本文の一行なので、表紙と同じく句点まで（11/21：「いっぽん。また、いっぽん」で終わって見えた）。 */}
                  <h3 className={story?.book ? "bk-refrain" : undefined}>
                    {story?.book && story.tale?.tagline
                      ? // 本文の一行の副題は、句点の後ろでだけ折り返す（11/21：「いっぽん。ま／た、いっぽん。」と切れていた）。
                        `${story.tale.tagline}。`.split(/(?<=。)/).map((part, i) => (
                          <span key={i}>
                            {i > 0 && <wbr />}
                            {part}
                          </span>
                        ))
                      : (story?.tale?.tagline ?? story?.gloss ?? title)}
                  </h3>
                </div>
              </div>
              <span className="bk-page-shadow" aria-hidden />
            </div>
            <div className="bk-cover">
              {/* 表紙（11/20 18:19 渡辺さんの見本）：革のしぼ、金の二重の枠と四隅の唐草、Weather Note の印、名前は明朝の金、
                  型押しの満月（絵を革に押したように）、ひと言、The Story of the Full Moon。 */}
              <div className="bk-front">
                <GoldFrame />
                {scene?.coverCorner && (
                  <>
                    <img
                      className="bk-corner l"
                      src={scene.coverCorner}
                      alt=""
                      aria-hidden
                    />
                    <img
                      className="bk-corner r"
                      src={scene.coverCorner}
                      alt=""
                      aria-hidden
                    />
                  </>
                )}
                <span className="bk-mark">
                  <CloudMark className="bk-cloud" />
                  <small>Weather Note</small>
                </span>
                <Flourish />
                <h2>{title}</h2>
                {story && <span className="bk-en">{story.en}</span>}
                {scene?.CoverArt ? (
                  // 素材を重ねた表紙の絵（11/20 18:42 渡辺さんの素材）。
                  <div className="bk-medal art">
                    <scene.CoverArt />
                  </div>
                ) : (
                  <div className="bk-medal">
                    <span className="bk-medal-glow" aria-hidden />
                    {pic && (
                      <img
                        src={pic}
                        alt=""
                        className={wide ? "wide" : undefined}
                      />
                    )}
                    <MoonEmblem
                      name={sceneKey ?? ""}
                      className="bk-medal-emblem"
                    />
                  </div>
                )}
                {story?.tale && (
                  <p className="bk-tag">{story.tale.tagline}。</p>
                )}
                <small className="bk-sub">
                  The Story of the Full Moon
                  {!event.blue && fullMoonAlias(event.name, at)
                    ? `・別名 ${fullMoonAlias(event.name, at)}`
                    : ""}
                </small>
                <span className="bk-cover-shade" aria-hidden />
              </div>
            </div>
            {/* 表紙の裏（開くと左のページになる）。 */}
            <div className="bk-back" aria-hidden>
              {pic && (
                <img src={pic} alt="" className={wide ? "wide" : undefined} />
              )}
              <span className="bk-back-shade" />
            </div>
          </div>
          <span className="ms-book-hint ms-hero-hint" aria-hidden>
            スクロールでページをひらく
            <Glyph name="down" />
          </span>
        </div>
      </section>

      {/* 2. 絵本の場面：一つの続いた世界を、物語の一文ごとに一コマずつ。文は空に一字ずつ。 */}
      {scene && World && (
        <section className="ms-world" aria-label="絵本のページ">
          <div
            className="ms-sticky ms-world-stage"
            role="presentation"
            onClick={nextBeat}
          >
            <World />
            <span className="ms-world-frame" aria-hidden>
              <GoldFrame w={400} h={860} inset={10} bevel={false} />
            </span>
            <span className="ms-caps-veil" aria-hidden />
            <div className="ms-caps">
              {lines.map((t, i) => (
                <p
                  key={i}
                  className="ms-cap"
                  data-i={i}
                  // いちばん長い行の字数（縦書きの列に収まる字の大きさを選ぶ。fitCaps）。
                  data-n={Math.max(...tateNum(t).split("\n").map((l) => [...l].length))}
                >
                  <Letters text={tateNum(t)} />
                </p>
              ))}
            </div>
            <button
              type="button"
              className="ms-beats"
              aria-label="ページを選ぶ（← → で前後のページ）"
              onClick={toDot}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  e.stopPropagation();
                  pager.current?.step(e.key === "ArrowRight" ? 1 : -1);
                }
              }}
            >
              {lines.map((_, i) => (
                <i key={i} className="ms-beat" />
              ))}
            </button>
          </div>
        </section>
      )}

      {/* 締めくくり（16:27 のレビュー「最後の余韻」）：ひと言をもう一度。ここから今夜の情報へつなぐ。 */}
      {/* 絵本の形（book）を持つ満月は、9ページで物語が終わるので出さない（11/21 承認：余韻を分けない）。 */}
      {scene && story?.tale && !story.book && (
        <section className="ms-chapter ms-epilogue">
          {/* きらめき（11/20 20:42 渡辺さん「ここにもちょっとキラッとしたエフェクトを」）：飾りの線の真ん中の菱形と、
              文のまわりに小さな星が、間をおいて一つずつ瞬く。動きを減らす設定では出さない。 */}
          <span className="ms-glints" aria-hidden>
            {GLINTS.map(([x, y, s, d], i) => (
              <Glint
                key={i}
                className="ms-glint"
                style={
                  {
                    ["--x" as string]: `${x}%`,
                    ["--y" as string]: `${y}%`,
                    ["--s" as string]: s,
                    ["--d" as string]: `${d}s`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
          <span className="ms-flourish-glint">
            <Flourish />
            <Glint className="ms-glint lead" />
          </span>
          <p className="ms-rise">
            {story.tale.tagline.split("、").map((t, i, all) => (
              <span key={i}>
                {t}
                {i < all.length - 1 ? "、" : "。"}
                {i < all.length - 1 && <br />}
              </span>
            ))}
          </p>
          <small className="ms-rise">{title}</small>
          {/* 小さな金の枯れ枝（11/20 21:05 渡辺さん）：名前の下にそっと。 */}
          <Twig className="ms-twig ms-rise" />
          {windowLine && <p className="ms-window ms-rise">{windowLine}</p>}
        </section>
      )}


      {/* 2. 季節の物語（場面の無い満月）：ひと言と、物語の一段落ずつ。物語の無い呼び名は、象徴の文だけ。 */}
      {story && !scene && (
        <section className="ms-chapter ms-tale">
          <small className="ms-rise">{j.m}月の満月の物語</small>
          <h3 className="ms-rise">{story.tale?.tagline ?? story.gloss}</h3>
          {/* 絵本の形（book）があれば、そのページを一段ずつ（場面の素材が届く前の形。11/21 コールドムーンの実装計画 PR-1）。
              tale.lines は物語の外のための古い文なので、book があるときは出さない。 */}
          {story.book
            ? story.book.pages.map((pg, i) => (
                <p key={i} className="ms-tale-line">
                  {pg.lines.map((l, k) => (
                    <span key={k}>
                      {k > 0 && <br />}
                      {l}
                    </span>
                  ))}
                </p>
              ))
            : (story.tale?.lines ?? [story.meaning]).map((t, i) => (
                <p key={i} className="ms-tale-line">
                  {t}
                </p>
              ))}
        </section>
      )}

      {!story?.book && infoBlock}

      {/* 5. 知識：名前の由来・自然との関係（11/20 20:56 渡辺さんの見本）：古い紙のページ、角を内に丸く切った金の二重の枠、
          見出しの下に小枝の線、最初の字を大きく、象徴の言葉は小さな絵と並べ、ページの下に淡いセピアの絵（場面ごと）。 */}
      {story &&
        (
          [
            // 絵本の形を持つ満月は、あとがき・自然と科学を book から（無ければ、名前の由来・自然との関係）。
            // 節は { heading?, text }（自然と科学は小見出しつき）。あとがきの上には小さく「物語のあとがき」。
            [
              story.book?.afterword.title ?? "名前の由来",
              (story.book?.afterword.paragraphs ?? story.origin).map((text) => ({ heading: undefined as string | undefined, text })),
              false,
              story.book ? "物語のあとがき" : null,
            ],
            [
              story.book?.science.title ?? "自然との関係",
              story.book?.science.sections ?? story.nature.map((text) => ({ heading: undefined as string | undefined, text })),
              true,
              null,
            ],
          ] as const
        ).map(([head, paras, last, kicker]) => (
          <section key={head} className="ms-chapter ms-text" data-story-end={story.book && !last ? "" : undefined}>
            {/* 紙のページ（11/20 21:14 渡辺さん：四隅は角の丸い枠と唐草にそろえる）。見出しまわりはページごと：
                名前の由来は上に月の満ち欠けと菱形の飾り、自然との関係は小枝の線と象徴の言葉の札。 */}
            <div className="ms-sheet">
            <div
              className={[
                "ms-paper",
                "origin",
                last ? "nature" : "",
                scene?.PaperArt ? "with-art" : "",
                "ms-sheet-in",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {["tl", "tr", "bl", "br"].map((c) => (
                <PaperCorner key={c} className={`ms-paper-corner ${c}`} />
              ))}
              {!last && (
                <PhaseRow
                  moon={storyAsset("common", "emboss")}
                  className="ms-phases"
                />
              )}
              {kicker && <small className="ms-paper-kicker">{kicker}</small>}
              <h3>{head}</h3>
              {last ? <LeafRule className="ms-leafrule" /> : <Flourish />}
              {paras.map((t, i) => (
                <Fragment key={i}>
                  {t.heading && <h4 className="ms-paper-sub">{t.heading}</h4>}
                  <p className={i === 0 ? "lead" : undefined}>{t.text}</p>
                </Fragment>
              ))}
              {last && (
                <p className="ms-symbols">
                  {story.symbols.map((w) => (
                    <em key={w}>
                      <SymbolIcon word={w} className="ms-symbol-icon" />
                      {w}
                    </em>
                  ))}
                </p>
              )}
              {scene?.PaperArt && (
                <span className="ms-paper-art">
                  <scene.PaperArt kind={last ? "nature" : "origin"} />
                </span>
              )}
            </div>
            </div>
          </section>
        ))}

      {/* 本を閉じる（絵本の形の満月だけ）：開いたときの見開きから、逆の順に閉じる。右のページに「おしまい」。 */}
      {story?.book && (
        <section className="ms-endbook" aria-label="本を閉じる">
          <div className="ms-sticky ms-endbook-stage">
            <div className="bk">
              <div className="bk-page">
                <div className="bk-inner">
                  <GoldFrame />
                  <p className="ms-endbook-fin">おしまい</p>
                </div>
                <span className="bk-page-shadow" aria-hidden />
              </div>
              <div className="bk-cover">
                <div className="bk-front ms-endbook-cover">
                  <GoldFrame />
                  <span className="bk-mark">
                    <CloudMark className="bk-cloud" />
                    <small>Weather Note</small>
                  </span>
                  {/* 型押し（11/21 渡辺さん「ここはエンボス加工風がいい」）：表紙のメダルと同じく、絵を革に押したように。 */}
                  {scene?.closedArt ? (
                    <img className="ms-endbook-art" src={scene.closedArt} alt="" />
                  ) : pic && (
                    <div className="bk-medal ms-endbook-medal">
                      <span className="ms-endbook-relief">
                        <img src={pic} alt="" className={wide ? "wide" : undefined} />
                      </span>
                    </div>
                  )}
                  {story.tale && <p className="bk-tag">{story.tale.tagline}。</p>}
                  <span className="bk-cover-shade" aria-hidden />
                </div>
              </div>
              <div className="bk-back" aria-hidden>
                {pic && <img src={pic} alt="" className={wide ? "wide" : undefined} />}
                <span className="bk-back-shade" />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 絵本の形（book）を持つ満月は、あとがき → 自然と科学 → 今夜の月（11/21 承認：絵本 → あとがき → 自然と科学 → 今夜の月）。 */}
      {story?.book && infoBlock}

      {/* 5. 本棚（一年を巡る満月の物語）と、終わり */}
      <section className="ms-chapter ms-tonight">
        {/* 本棚（11/20 18:19 渡辺さんの見本）：木目の棚、上に飾り板。革の背に、型押しの月・紋・名前・日付・山並み・金の帯。 */}
        <div className="ms-case ms-rise">
          <div className="ms-crest">
            <CloudMark className="ms-crest-cloud" />
            <small>Weather Note</small>
            <h3>満月の物語の本棚</h3>
            <span className="ms-crest-sub">
              <Sprig className="ms-sprig" />
              The Full Moon Stories
              <Sprig className="ms-sprig" flip />
            </span>
          </div>
          <div className="ms-shelf" role="list" aria-label="満月の物語の本棚">
            {shelf.books.map((bk, i) => (
              <div
                key={bk.name}
                role="listitem"
                className={bk.reading ? "ms-slot reading" : "ms-slot"}
              >
                {bk.reading ? (
                  <span
                    className="ms-spine-gap"
                    role="img"
                    aria-label={`${bk.name}（いま読んでいる本）`}
                  >
                    {/* 読み終わりのしおり（11/21）：本棚が見えると、抜けた所に金のしおりがすっと下りる。 */}
                    <span className="ms-bookmark" aria-hidden />
                  </span>
                ) : (
                  <button
                    type="button"
                    className={bk.next ? "ms-spine next" : "ms-spine"}
                    style={spineVar(i)}
                    disabled={!bk.at || !onNext}
                    onClick={(e) => pull(e, bk)}
                    aria-label={
                      bk.at
                        ? `${bk.name}の物語を開く（${farYear(bk.at) ? `${farYear(bk.at)}年` : ""}${jst(bk.at).m}/${jst(bk.at).d}）${bk.next ? "、次の満月" : ""}`
                        : `${bk.name}（5年以内に無し）`
                    }
                  >
                    <span className="sp-band" aria-hidden />
                    {/* 背（11/20 19:52 渡辺さんの見本の背）：型押しの月、英語の呼び名、日本語の呼び名、紋、日付、山並み。 */}
                    <img
                      className="sp-moon art"
                      src={
                        STORY_SCENES[bk.name]?.spineArt?.moon ??
                        storyAsset("common", "emboss")
                      }
                      alt=""
                    />
                    <SpineLatin className="sp-latin" lines={bk.en.split(" ")} />
                    <span className="sp-rule" aria-hidden />
                    {/* 日本語の呼び名（11/20 20:09 渡辺さん「ストロベリ／ーと分かれる。コーンムーンなど短いものは一行に」）：
                        7字までは一列。長いものは「〇〇／ムーン」の二列で、語の途中では折らない。 */}
                    <b className={bk.name.length > 7 ? "two" : undefined}>
                      {bk.name.length > 7 && bk.name.endsWith("ムーン") ? (
                        <>
                          <span>{bk.name.slice(0, -3)}</span>
                          <span>ムーン</span>
                        </>
                      ) : (
                        <span>{bk.name}</span>
                      )}
                    </b>
                    {STORY_SCENES[bk.name]?.spineArt ? (
                      <img
                        className="sp-emblem art"
                        src={STORY_SCENES[bk.name]!.spineArt!.emblem}
                        alt=""
                      />
                    ) : (
                      <MoonEmblem name={bk.name} className="sp-emblem" />
                    )}
                    {bk.at && (
                      <small>
                        {/* 一年より先の満月は年も（11/21 レビュー：2029/1/30 が来年1月に見えた）。 */}
                        {farYear(bk.at) && <span className="sp-year">{farYear(bk.at)}</span>}
                        {jst(bk.at).m}/{jst(bk.at).d}
                      </small>
                    )}
                    <SpineHills className="sp-hills" />
                    <span className="sp-band" aria-hidden />
                    {bk.next && <span className="sp-ribbon" aria-hidden />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        {next && (
          <p className="ms-shelf-hint ms-rise">
            次の物語は{next.blue ? "ブルームーン" : next.name}（{jst(next.at).m}/
            {jst(next.at).d}）
            {daysTo(next.at) > 0 ? `、あと${daysTo(next.at)}日` : ""}
            。背を押すと、その本を取り出して開きます。
          </p>
        )}
        <div className="ms-end ms-rise">
          {onList && (
            <Button size="sm" onClick={onList}>
              この年の満月の一覧
              <Glyph name="next" />
            </Button>
          )}
          <Button size="sm" kind="quiet" onClick={onClose}>
            閉じる
          </Button>
        </div>
        <small className="ms-note">
          名前は主に北米の季節に基づく文化的な呼び名で、日本の季節とは必ずしも一致しません。絵や動きは文化的なイメージで、実際の月の色や明るさ・見え方とは別です。時刻と見え方は
          {WHERE}で計算しています。
        </small>
      </section>
    </div>
  );
}
