// 満月の物語の「ページ送り」（11/20 20:17 渡辺さん「慣性スクロール・スナップ改善」）。
// 物語の部分（本の表紙 → 見開き → 場面の一コマずつ → 締めくくり → 今夜の情報の頭）だけ、指の動きをこちらで受け持つ：
//   - 指が触れている間は、指と一緒に 1:1 で動かす（ブラウザの慣性は使わない）。
//   - 短く払ったときだけ、指の速さと向きから行き先の区切りを決める（ゆっくりのスクロールは、指のまま・惰性だけ）。軽く払えば向きの次の区切り、強く払えば、その勢いで届く
//     区切り（ただし一度に最大 MAX_STEP 個まで。意図しない飛び越しを防ぐ）。
//   - 行き先へは、指を離した速さを引き継いで、減速だけでゆっくり止まる（1.1〜1.8 秒、行き過ぎない）。
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
  /** 区切り i へ一つ前の区切りから運ぶ秒数（無ければ距離から）。場面のコマは字の数に比例（11/20 22:43）。 */
  seconds?: (i: number) => number | undefined;
  /** 動きを減らす設定（速く、短く運ぶ）。 */
  reduced?: () => boolean;
};

const MAX_STEP = 3;
/** 指を離した速さから「届く距離」を見積もる（iOS のスクロールの減速と同じ考え：距離 ≒ 速さ × 0.5 秒）。 */
const PROJECT_S = 0.5;
/** 軽く払った、とみなす速さ（px/秒）。 */
const FLICK_V = 120;
/** 短く払った、とみなす触れていた時間（ms）と、動かした距離（px）。これより長い・遠いのは、ゆっくりのスクロール。 */
const FLICK_MS = 280;
const FLICK_PX = 140;
/** ゆっくりのスクロールで離したあとの惰性（ブラウザのスクロールに近い減速、時定数 秒）。 */
const COAST_S = 0.33;

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

  // 減速しながら止まる（11/20 22:06 渡辺さん「もっとゆっくり流れて、減速しながら止まって」）。時間 T は先に決め（場面の
  // コマは字の数に比例、ほかは距離から）、動きは「減速の曲線」＋「指の速さとのつなぎ」の和：
  //   x(t) = x0 + D·(1 − (1 − k)^P) + (v − c0)·t·(1 − k)²、k = t/T、c0 = P·D/T（曲線の始めの速さ）
  //   - 第1項：始めがいちばん速く、あとは減速だけで T でぴたりと止まる。
  //   - 第2項：t = 0 で速さを指の速さ v にそろえ（離した瞬間の速さが途切れない）、T で 0（位置も速さも曲線に戻る）。
  //   - v は行き先の向きの成分だけ、c0 の 2.5 倍まで（それより速いと途中で戻る動きになるため。強く払えば先の区切りへ）。
  //   11/20 レビュー「指の速さを完全には引き継いでいない」への対応（前は P を速さで変えて近づけていた）。
  const glide = (to: number, v0 = 0) => {
    stop();
    const x0 = el.scrollTop;
    const D = to - x0;
    if (Math.abs(D) < 0.5) {
      el.scrollTop = to;
      report(to, true);
      return;
    }
    const T = o.reduced?.() ? 0.45 : travelSeconds(x0, to);
    const P = 2.2;
    const c0 = (P * D) / T;
    const toward = Math.sign(v0) === Math.sign(D);
    const v = toward ? Math.sign(D) * Math.min(Math.abs(v0), 2.5 * Math.abs(c0)) : 0;
    // 最初のコマから進める（rAF の時刻はコマの始まりなので、始めの時刻を半コマ前に取る）。
    let t0 = -1;
    target = to;
    const tick = (now: number) => {
      if (t0 < 0) t0 = now - 8;
      const k = Math.min(1, (now - t0) / 1000 / T);
      if (k >= 1) {
        el.scrollTop = to;
        raf = 0;
        target = null;
        report(to, true);
        return;
      }
      const t = k * T;
      const y = x0 + D * (1 - Math.pow(1 - k, P)) + (v - c0) * t * (1 - k) * (1 - k);
      el.scrollTop = y;
      report(y, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  /** ゆっくりのスクロールで離したとき：節目へは運ばず、離した速さのまま少し進んで減速して止まる。 */
  const coast = (v: number) => {
    stop();
    if (Math.abs(v) < 40) return;
    const x0 = el.scrollTop;
    const D = Math.max(-x0, Math.min(last() - x0, v * COAST_S));
    let t0 = -1;
    const tick = (now: number) => {
      if (t0 < 0) t0 = now - 8;
      const t = (now - t0) / 1000;
      const k = 1 - Math.exp(-t / COAST_S);
      if (k > 0.995) {
        el.scrollTop = x0 + D;
        raf = 0;
        report(x0 + D, true);
        return;
      }
      el.scrollTop = x0 + D * k;
      report(x0 + D * k, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  /** x0 から区切り to まで運ぶ秒数：通る区切りの間ごとの秒数（seconds）の和。途中から始めるときは残りの割合で。 */
  const byDistance = (d: number) =>
    Math.min(1.8, Math.max(1.1, 0.9 + Math.abs(d) / 2500));
  const travelSeconds = (x0: number, to: number) => {
    if (stops.indexOf(to) < 0 || !o.seconds) return byDistance(to - x0);
    let t = 0;
    for (let k = 1; k < stops.length; k++) {
      const a = stops[k - 1];
      const b = stops[k];
      const lo = Math.max(a, Math.min(x0, to));
      const hi = Math.min(b, Math.max(x0, to));
      if (hi <= lo || b <= a) continue;
      t += ((o.seconds(k) ?? byDistance(b - a)) * (hi - lo)) / (b - a);
    }
    return Math.min(7, Math.max(0.8, t));
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
  let startT = 0;
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
    startT = e.timeStamp;
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
    // 触れただけ（タップ）：動かさない（場面を押したときの「次のコマへ」は、押した側の処理）。
    if (!decided) return;
    // 離す直前 100ms の速さ（スクロールの向き、px/秒）。
    const end = samples[samples.length - 1];
    const first = samples.find((s) => end.t - s.t <= 100) ?? samples[0];
    const dt = Math.max(1, end.t - first.t);
    const stale = e.timeStamp - end.t > 100; // 指を止めてから離した
    const v = stale ? 0 : (-(end.y - first.y) / dt) * 1000;
    const top = el.scrollTop;
    const moved = top - startTop;
    if (top > last() + 1 && v >= 0) return; // 今夜の情報へ入った：そのまま
    // 短く払った（11/20 22:09 渡辺さん「短いストロークのときだけ節目で止める。ゆっくりスクロールしているときは発動しない」）：
    // 触れていた時間が短く、動かした距離も短く、離すときに勢いがある。それ以外は、指の動きのまま（節目へ運ばない）。
    const flick =
      e.timeStamp - startT < FLICK_MS &&
      Math.abs(moved) < FLICK_PX &&
      Math.abs(v) > FLICK_V;
    if (!flick) {
      coast(v);
      return;
    }
    const dir: 1 | -1 = v > 0 ? 1 : -1;
    // 届く距離から何個先か（最低 1、最大 MAX_STEP）。始めの区切りから数える。
    const near0 = stops[nearest(startTop)];
    // 区切りから払ったときはその区切りから数え、ゆっくり動かして途中に居たときは今いる所から数える。
    const origin = Math.abs(near0 - startTop) <= 2 ? near0 : startTop;
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
