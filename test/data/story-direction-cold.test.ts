import { describe, expect, it } from "vitest";
import { fullMoonInfo } from "../../shared/fullMoonNames";
import { buildColdScene, COLD_CUES, COLD_LEAD } from "../../src/design/story/ColdWorld";
import { coldDirection, SLEEP_TIMES } from "../../src/design/story/coldDirection";
import { plainText } from "../../src/design/story/direction";
import { STORY_SCENES } from "../../src/design/story/scenes";
import { BEAT_REST, directedPlan, segBeat, tateNum } from "../../src/ui/MoonStory";

// コールドムーンの最終の演出（第3次品質改善、2026-11-27 承認）を、共通の演出エンジン（direction.ts・MoonStory の拍）を
// 変えても崩れないように確かめる。本文・時間・光の順は Project「コールドムーン_第3次品質改善_段階3_文章と終幕の案」。
const book = fullMoonInfo("コールドムーン")!.book!;
const pages = book.pages.map((p) => p.lines);
const dir = coldDirection(pages, book.titleEnd);
const plan = directedPlan(dir);
const text = (i: number) => plainText(tateNum(pages[i].join("\n")));
/** ページ i の本文で、word の最初の字の番号（from より後ろ）。 */
const idx = (i: number, word: string, from = 0) => [...text(i).slice(0, text(i).indexOf(word, from))].length;

/** MoonStory と同じ計算で、合図の言葉の最初の字が浮かびはじめる拍（場面に渡す cueAt）。 */
function cueAt(): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  for (const [p, words] of Object.entries(COLD_CUES)) {
    const i = Number(p);
    const t = text(i);
    let from = 0;
    out[i] = words.map((w) => {
      const k = t.indexOf(w, from);
      if (k < 0) return Number.NaN;
      from = k + w.length;
      const c = plan.times[i].chars[[...t.slice(0, k)].length];
      return c ? segBeat(plan, i, c.at) : Number.NaN;
    });
  }
  for (const i of STORY_SCENES["コールドムーン"]?.pictureFirst ?? []) out[100 + i] = [segBeat(plan, i, plan.times[i].textStart - plan.pages[i].intro)];
  return out;
}

type Step = { method: string; target: string; vars: Record<string, unknown>; to?: Record<string, unknown>; at: number };
/** 場面の動きを書き留める（gsap のタイムラインの代わり）。 */
function record(): Step[] {
  const steps: Step[] = [];
  const tl: Record<string, unknown> = {};
  for (const method of ["to", "from", "set", "fromTo"])
    tl[method] = (target: string, a: Record<string, unknown>, b?: unknown, c?: unknown) => {
      if (method === "fromTo") steps.push({ method, target, vars: a, to: b as Record<string, unknown>, at: Number(c ?? 0) });
      else steps.push({ method, target, vars: a, at: Number(b ?? 0) });
      return tl;
    };
  tl.call = () => tl;
  tl.add = () => tl;
  buildColdScene({ timeline: () => tl as never, utils: { toArray: () => [] } } as never, {} as Element, tl as never, false, cueAt());
  return steps;
}
const steps = record();
/** target の動きの、始まりと終わりの拍。 */
function span(target: string, n = 0): { from: number; to: number } {
  const s = steps.filter((x) => x.target === target)[n];
  expect(s, target).toBeDefined();
  const d = Number((s.to ?? s.vars).duration ?? 0);
  return { from: s.at, to: s.at + d };
}

describe("コールドムーンの最終の演出（第3次品質改善）", () => {
  it("場面は自分の演出（coldDirection）を持ち、8P は絵が先で 9P の夜明けへつながる", () => {
    const sc = STORY_SCENES["コールドムーン"]!;
    expect(sc.direction).toBe(coldDirection);
    expect(sc.pictureFirst).toEqual([8]);
    expect(dir.pages.length).toBe(9);
    // 見本の切り替え（URL の ?cold…、比べる案）は本番に残さない。
    expect(Object.keys(sc)).not.toContain("sample");
  });
  it("字の時刻は、組版の印（改行・\"/\"）を除いた字の数だけ。背の低い画面で折っても時間は変わらない", () => {
    pages.forEach((_, i) => expect(plan.times[i].chars.length).toBe([...text(i)].length));
    const flat = coldDirection(pages.map((l) => l.map((x) => x.replace(/\//g, ""))), book.titleEnd);
    expect(directedPlan(flat).secs).toEqual(plan.secs);
  });
  it("物語が進むほど言葉が少なくなる：8P は「ながい、ながい夜。」の一文だけ", () => {
    expect(pages[7]).toEqual(["ながい、ながい夜。"]);
    expect([...text(7)].length).toBeLessThan(Math.min(...[0, 1, 2, 3, 4, 5, 6].map((i) => [...text(i)].length)));
  });
  it("8P：「ながい、」のあと約 3 秒の沈黙をおいて「ながい夜。」", () => {
    const t = plan.times[7];
    const k = idx(7, "ながい夜");
    expect(k).toBe(4);
    const first = t.chars[0];
    const second = t.chars[k];
    // 「ながい、」が浮かびはじめてから「ながい夜。」まで（承認の実測 2.98 秒）。
    expect(second.at - first.at).toBeGreaterThanOrEqual(2.9);
    expect(second.at - first.at).toBeLessThanOrEqual(3.1);
    // 「ながい、」の4字は同時に浮かぶ（一つの意味のまとまり）。
    for (let j = 1; j < k; j++) expect(t.chars[j].at).toBe(first.at);
  });
  it("8P：文が消えたあと、字のない時間を約 7 秒（全体で 18 秒ほど）", () => {
    expect(dir.pages[7].picture).toBeGreaterThanOrEqual(7);
    expect(SLEEP_TIMES.picture8).toBe(dir.pages[7].picture);
    expect(SLEEP_TIMES.fade8).toBe(dir.pages[7].fadeOut);
    expect(SLEEP_TIMES.intro9).toBe(dir.pages[8].intro);
    const t = plan.times[7];
    const whole = t.fadeStart + dir.pages[7].fadeOut + dir.pages[7].picture - (t.textStart - dir.pages[7].intro);
    expect(whole).toBeGreaterThanOrEqual(17);
    expect(whole).toBeLessThanOrEqual(21);
  });
  it("8P の光の順：穴の縁の月光 → 寝顔の光（背景はまだ暗い）→ 夜明け", () => {
    const end8 = 7 + BEAT_REST; // 8P の区間の終わり（文が消えはじめる拍）
    const band = span(".cw-band");
    const face = span(".cw-birdlight");
    const dawn = span(".cw-sky-dawn");
    const night = span(".cw-shade-night", steps.filter((x) => x.target === ".cw-shade-night").length - 1);
    // 1. 穴の縁の月光は、寝顔の光より先に動きはじめる。
    expect(band.from).toBeLessThan(face.from);
    // 2. 寝顔の光は、8P の文が消えたあと（字のない時間）に届く。
    expect(face.from).toBeGreaterThan(end8);
    // 3. 寝顔の光がいちばん明るくなってから、夜明け（空が白む・夜の陰が薄れる）がはじまる。寝顔に光が届く間、背景は暗いまま。
    expect(face.to).toBeLessThanOrEqual(dawn.from + 1e-9);
    expect(face.to).toBeLessThanOrEqual(night.from + 1e-9);
    // 字のない時間の秒にすると：寝顔の光は 1.6 秒から、夜明けは 5 秒から（その間 3 秒以上）。
    const fly = cueAt()[8][0];
    const perSec = (fly - end8) / (SLEEP_TIMES.fade8 + SLEEP_TIMES.picture8 + SLEEP_TIMES.intro9);
    const sec = (beat: number) => (beat - end8) / perSec - SLEEP_TIMES.fade8;
    expect(sec(face.from)).toBeCloseTo(1.6, 5);
    expect(sec(dawn.from)).toBeCloseTo(5.0, 5);
    // 夜明けは 9P のコガラの声（フィーチー）より前に終わる。
    expect(dawn.to).toBeLessThanOrEqual(fly);
  });
  it("9P：節ごとに「フィーチー、フィーチー。／もう、朝。」→「西の空には、／まだ、白い月。」→ 絵だけの時間 →「コールドムーン。」", () => {
    const t = plan.times[8];
    const west = idx(8, "西の空");
    const name = idx(8, "コールドムーン");
    // 前の節は、次の節が出る前に消えきる（同じ起点から出すので重ならない）。
    for (let j = 0; j < west; j++) expect(t.chars[j].out! + t.chars[j].outFade!).toBeLessThanOrEqual(t.chars[west].at);
    // 作品名の前は、本文が消えて朝の世界を絵だけで 2 秒眺める。
    const lastOut = Math.max(...t.chars.slice(0, name).map((c) => c.out! + c.outFade!));
    expect(t.chars[name].at - lastOut).toBeGreaterThanOrEqual(2);
    // 作品名はまるごと（一行）浮かぶ。
    for (let j = name; j < t.chars.length; j++) expect(t.chars[j].at).toBe(t.chars[name].at);
    expect(t.chars.slice(name).every((c) => c.out === undefined)).toBe(true);
  });
  it("9P：額縁は、作品名が消えきってから", () => {
    const t = plan.times[8];
    const name = idx(8, "コールドムーン");
    const titleFull = t.chars[name].at + t.chars[name].fade;
    // 作品名を読む時間（readHold）を残してから消える。
    expect(t.fadeStart - titleFull).toBeCloseTo(dir.pages[8].readHold, 5);
    // 額縁は、最後のページの文（作品名）が消えきった時刻から（MoonStory：gone = fadeStart + fadeOut、本の titleEnd は無い）。
    expect(book.titleEnd).toBeUndefined();
    expect(dir.title).toBeUndefined();
    const gone = t.fadeStart + dir.pages[8].fadeOut;
    expect(gone).toBeGreaterThan(titleFull);
    expect(dir.frame).toBeGreaterThan(0);
    expect(t.total).toBeGreaterThanOrEqual(gone + dir.frame);
  });
  it("2P・3P：絵は言葉より遅れない（合図の拍を切り上げない。場面はページの区間の頭から動く）", () => {
    const at = cueAt();
    expect(COLD_LEAD).toBeCloseTo(1 - BEAT_REST, 9);
    // どの合図も、場面が受け付ける範囲（ページの区間の頭〜そのコマの中）にある＝切り上げ・切り下げが起きない。
    for (const [p, beats] of Object.entries(at)) {
      const i = Number(p);
      if (i >= 100) continue;
      for (const b of beats) {
        expect(b, `${i + 1}P`).toBeGreaterThanOrEqual(i - COLD_LEAD);
        expect(b, `${i + 1}P`).toBeLessThanOrEqual(i + 0.74);
      }
    }
    // 2P「ちょん、」「ちょん。」：跳ねは字の出る拍に一回ずつ（同じ拍に重ならない）。
    const hops = steps.filter((x) => x.target === ".cw-hop" && x.vars.keyframes).map((x) => x.at);
    expect(hops).toEqual([at[1][0], at[1][1]]);
    expect(hops[1]).toBeGreaterThan(hops[0]);
    // 2P・3P の寄りは、そのページの文が出はじめるより前に始まる（前のページの構図の上に、次のページの字を出さない）。
    const cams = steps.filter((x) => x.target === ".cw-camera").map((x) => x.at);
    for (const i of [1, 2]) {
      const textAt = segBeat(plan, i, plan.times[i].textStart);
      const move = cams.filter((c) => c < textAt).at(-1)!;
      expect(move, `${i + 1}P`).toBeGreaterThan(i - COLD_LEAD - 1e-9);
    }
    // 3P「木の皮のすきまに、」：すきまに顔を近づける動きは、その字と同じ拍から。
    const near = steps.find((x) => x.target === ".cw-seed" && x.method === "to" && x.vars.x !== undefined)!;
    expect(near.at).toBeCloseTo(at[2][0], 9);
  });
  it("合図の言葉は、どれも本文にあり、出る順に並ぶ（3P の種・6P の月の出・9P の声）", () => {
    const at = cueAt();
    for (const [p, words] of Object.entries(COLD_CUES)) {
      const beats = at[Number(p)];
      words.forEach((w, k) => expect(Number.isFinite(beats[k]), `${Number(p) + 1}P「${w}」`).toBe(true));
      for (let k = 1; k < beats.length; k++) expect(beats[k]).toBeGreaterThanOrEqual(beats[k - 1]);
    }
    // 3P：2つ目の種は、1つ目をしまい終えた（句点）あと。
    expect(at[2][3]).toBeGreaterThan(at[2][2]);
    // 6P：月の縁が山の向こうに出る前に、1.6 秒の間。
    const t6 = plan.times[5];
    const k6 = idx(5, "山のむこう");
    expect(t6.chars[k6].at - (t6.chars[k6 - 1].at + 0.17)).toBeGreaterThanOrEqual(1.6);
  });
});
