// 満月の物語の「ページ送り」（11/20 20:17 渡辺さん「慣性スクロール・スナップ改善」）。
// 物語の部分（本の表紙 → 見開き → 場面の一コマずつ → 締めくくり → 今夜の情報の頭）だけ、指の動きをこちらで受け持つ：
//   - 指が触れている間は、指と一緒に 1:1 で動かす（ブラウザの慣性は使わない）。
//   - 離したら、指の速さと向きから行き先の区切りを決める。軽く払えば向きの次の区切り、強く払えば、その勢いで届く
//     区切り（ただし一度に最大 MAX_STEP 個まで。意図しない飛び越しを防ぐ）。
//   - 行き先へは「指を離した速さ」から始まる減速（臨界減衰のばね）で運ぶ。跳ね返らないよう、ばねの強さを速さに合わせる。
//     requestAnimationFrame で動かすので、端末のリフレッシュレート（120Hz の iPhone も）に合わせて描く。
//   - 動いている間に指が触れたら、その場で止めて指に返す。
//   - マウスのホイール・トラックパッドは、一つの操作（間が空くまで）で一つ進む。
// 今夜の情報から下（読む所）は、ブラウザのふつうのスクロールのまま。
// 区切りの位置は測って取っておき（refresh）、動いている間はレイアウトを読まない。

type Opts = {
  /** 区切りの位置（スクロールの px、小さい順）。最後は今夜の情報の頭。 */
  measure: () => number[];
  /** いまの区切り（いちばん近いもの）が変わったとき。止まりきったときは settled = true。 */
  onIndex?: (i: number, settled: boolean) => void;
  /** 動きを減らす設定（速く、短く運ぶ）。 */
  reduced?: () => boolean;
};

const MAX_STEP = 3;
/** 指を離した速さから「届く距離」を見積もる（iOS のスクロールの減速と同じ考え：距離 ≒ 速さ × 0.5 秒）。 */
const PROJECT_S = 0.5;
/** 軽く払った、とみなす速さ（px/秒）と、動かした距離（px）。これより小さければ、元の区切りへ戻す。 */
const FLICK_V = 120;
const DRAG_MIN = 14;

export type Pager = {
  /** 区切りの位置を測り直す（大きさが変わったとき）。 */
  refresh: () => void;
  /** 区切り i へ滑らかに運ぶ（ドットを押したとき）。 */
  goTo: (i: number) => void;
  /** 向き（+1 / -1）の次の区切りへ。 */
  step: (dir: 1 | -1) => void;
  /** px の位置へ滑らかに運ぶ。 */
  glide: (to: number, v?: number) => void;
  destroy: () => void;
};

export function storyPager(el: HTMLElement, o: Opts): Pager {
  let stops = o.measure();
  let raf = 0;
  let index = -1;
  let target: number | null = null;
  const last = () => stops[stops.length - 1] ?? 0;
  const nearest = (y: number) => {
    let best = 0;
    for (let i = 1; i < stops.length; i++)
      if (Math.abs(stops[i] - y) < Math.abs(stops[best] - y)) best = i;
    return best;
  };
  const report = (y: number, settled: boolean) => {
    const i = nearest(y);
    if (i !== index || settled) {
      index = i;
      o.onIndex?.(i, settled);
    }
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    target = null;
  };

  // 臨界減衰のばね：x(t) = to + (A + B t) e^{-ωt}、A = x0 - to、B = v0 + ω A。
  // 速さの向きが行き先へ向いているとき B が A と同じ符号なら行き過ぎない：ω ≥ |v0| / |A| にする。
  const glide = (to: number, v0 = 0) => {
    stop();
    const x0 = el.scrollTop;
    const A = x0 - to;
    if (Math.abs(A) < 0.5) {
      el.scrollTop = to;
      report(to, true);
      return;
    }
    const base = o.reduced?.() ? 18 : 11;
    const toward = Math.sign(v0) === Math.sign(-A);
    let w = Math.max(base, toward ? Math.abs(v0) / Math.abs(A) : 0);
    w = Math.min(w, 30);
    // 行き先と逆向きの速さは、いったん捨てる（指を戻しながら離したとき）。
    const v = toward ? v0 : 0;
    const B = v + w * A;
    // 最初のコマから進める（rAF の時刻はコマの始まりなので、始めの時刻を半コマ前に取る）。
    let t0 = -1;
    target = to;
    const tick = (now: number) => {
      if (t0 < 0) t0 = now - 8;
      const t = (now - t0) / 1000;
      const d = (A + B * t) * Math.exp(-w * t);
      if (Math.abs(d) < 0.6 && t > 0.05) {
        el.scrollTop = to;
        raf = 0;
        target = null;
        report(to, true);
        return;
      }
      el.scrollTop = to + d;
      report(to + d, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  /** 今いる所（またはいま向かっている区切り）から、向きへ n 個先の区切り。 */
  const from = () => (target !== null ? target : el.scrollTop);
  const stepFrom = (y: number, dir: 1 | -1, n = 1) => {
    const eps = 2;
    if (dir > 0) {
      const ahead = stops.filter((s) => s > y + eps);
      return ahead[Math.min(n, ahead.length) - 1] ?? last();
    }
    const behind = stops.filter((s) => s < y - eps).reverse();
    return behind[Math.min(n, behind.length) - 1] ?? stops[0] ?? 0;
  };

  // ---- 指 ----
  let tracking = false;
  let decided = false;
  let startY = 0;
  let startTop = 0;
  let samples: { t: number; y: number }[] = [];
  const inStory = (top: number, dy: number) =>
    top < last() - 1 || (top <= last() + 1 && dy > 0);

  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const wasMoving = raf !== 0;
    stop();
    tracking = true;
    decided = false;
    startY = e.touches[0].clientY;
    startTop = el.scrollTop;
    samples = [{ t: e.timeStamp, y: startY }];
    // 動いている途中で触れて止めただけなら、その場で離してもそこに残らないよう、最初の動きで判断する。
    if (wasMoving) decided = false;
  };
  const onMove = (e: TouchEvent) => {
    if (!tracking) return;
    const y = e.touches[0].clientY;
    const dy = y - startY;
    if (!decided) {
      if (Math.abs(dy) < 3) return;
      decided = true;
      if (!inStory(startTop, dy)) {
        tracking = false; // ふつうのスクロールに任せる
        return;
      }
    }
    e.preventDefault();
    el.scrollTop = Math.max(0, startTop - dy);
    samples.push({ t: e.timeStamp, y });
    if (samples.length > 6) samples.shift();
    report(el.scrollTop, false);
  };
  const onEnd = (e: TouchEvent) => {
    if (!tracking) return;
    tracking = false;
    if (!decided) {
      // 触れただけ（タップ）：止めた所が区切りの途中なら、近い区切りへ戻す。
      const n = stops[nearest(el.scrollTop)];
      if (el.scrollTop < last() - 1 && Math.abs(n - el.scrollTop) > 1) glide(n);
      return;
    }
    // 離す直前 100ms の速さ（スクロールの向き、px/秒）。
    const end = samples[samples.length - 1];
    const first = samples.find((s) => end.t - s.t <= 100) ?? samples[0];
    const dt = Math.max(1, end.t - first.t);
    const stale = e.timeStamp - end.t > 80; // 指を止めてから離した
    const v = stale ? 0 : (-(end.y - first.y) / dt) * 1000;
    const top = el.scrollTop;
    const moved = top - startTop;
    if (top > last() + 1 && v >= 0) return; // 今夜の情報へ入った：そのまま
    const dir: 1 | -1 =
      Math.abs(v) > FLICK_V ? (v > 0 ? 1 : -1) : moved >= 0 ? 1 : -1;
    if (Math.abs(v) <= FLICK_V && Math.abs(moved) < DRAG_MIN) {
      glide(stops[nearest(top)]);
      return;
    }
    // 届く距離から何個先か（最低 1、最大 MAX_STEP）。始めの区切りから数える。
    const origin = stops[nearest(startTop)];
    const projected = top + v * PROJECT_S;
    let n = 1;
    while (
      n < MAX_STEP &&
      (dir > 0
        ? stepFrom(origin, 1, n + 1) <= projected
        : stepFrom(origin, -1, n + 1) >= projected)
    )
      n++;
    let to = stepFrom(origin, dir, n);
    // 指で区切りを越えて引いたのに、勢いが無い：越えた先の区切りへ（戻さない）。
    if ((dir > 0 && to < top) || (dir < 0 && to > top))
      to = stepFrom(top, dir, 1);
    glide(to, v);
  };

  // ---- ホイール・トラックパッド：一つの操作で一つ進む ----
  let wheelAt = 0;
  let wheelSum = 0;
  let wheelDone = false;
  const onWheel = (e: WheelEvent) => {
    const top = from();
    if (!inStory(top, -e.deltaY)) return;
    e.preventDefault();
    if (e.timeStamp - wheelAt > 220) {
      wheelSum = 0;
      wheelDone = false;
    }
    wheelAt = e.timeStamp;
    wheelSum += e.deltaY;
    if (wheelDone || Math.abs(wheelSum) < 12) return;
    wheelDone = true;
    glide(stepFrom(top, wheelSum > 0 ? 1 : -1));
  };

  // ---- キー（↓↑・PageDown・PageUp・スペース） ----
  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      ((tag === "BUTTON" || tag === "A") && e.key === " ")
    )
      return;
    const dir =
      e.key === "ArrowDown" ||
      e.key === "PageDown" ||
      (e.key === " " && !e.shiftKey)
        ? 1
        : e.key === "ArrowUp" ||
            e.key === "PageUp" ||
            (e.key === " " && e.shiftKey)
          ? -1
          : 0;
    if (!dir) return;
    const top = from();
    if (!inStory(top, -dir)) return;
    e.preventDefault();
    glide(stepFrom(top, dir as 1 | -1));
  };

  const onResize = () => {
    stops = o.measure();
  };
  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: false });
  el.addEventListener("touchend", onEnd, { passive: true });
  el.addEventListener("touchcancel", onEnd, { passive: true });
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  report(el.scrollTop, true);

  return {
    refresh: onResize,
    goTo: (i) => glide(stops[Math.max(0, Math.min(stops.length - 1, i))] ?? 0),
    step: (dir) => glide(stepFrom(from(), dir)),
    glide,
    destroy: () => {
      stop();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    },
  };
}
