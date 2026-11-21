// 満月の物語の「ページ送り」（11/20 20:17 渡辺さん「慣性スクロール・スナップ改善」）。
// 物語の部分（本の表紙 → 見開き → 場面の一コマずつ → 締めくくり → 今夜の情報の頭）だけ、指の動きをこちらで受け持つ：
//   - 指が触れている間は、指と一緒に 1:1 で動かす（ブラウザの慣性は使わない）。
//   - 短く払ったときだけ、指の速さと向きから行き先の区切りを決める（ゆっくりのスクロールは、指のまま・惰性だけ）。軽く払えば向きの次の区切り、強く払えば、その勢いで届く
//     区切り（ただし一度に最大 MAX_STEP 個まで。意図しない飛び越しを防ぐ）。
//   - 行き先へは、指を離した速さを引き継いで、減速だけでゆっくり止まる（1.1〜1.8 秒、行き過ぎない）。
//     requestAnimationFrame で動かすので、端末のリフレッシュレート（120Hz の iPhone も）に合わせて描く。
//   - 動いている間に指が触れたら、その場で止めて指に返す（そのタップでは次へ進めない）。
//   - 朗読の速さで運ぶのは、次の区切りへ一つ進むときだけ。戻る・飛ぶ・とばすは 1.1〜1.8 秒。
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
  /** この位置（px）より上は区切りへ運ばない（物語の本編の前）。 */
  freeBefore?: () => number;
  /** 動きを減らす設定（速く、短く運ぶ）。 */
  reduced?: () => boolean;
  /**
   * 通り道の節目（px）。前へ運ぶとき、この手前は距離から決めた短い時間で通り、節目から先を朗読の速さで運ぶ
   * （11/21 レビュー：見開きから1ページ目へ、本の中を朗読の速さで運んでいたので、文が出るまで約10秒かかっていた）。
   */
  waypoint?: () => number | undefined;
};

const MAX_STEP = 3;
/** 指を離した速さから「届く距離」を見積もる（iOS のスクロールの減速と同じ考え：距離 ≒ 速さ × 0.5 秒）。 */
const PROJECT_S = 0.5;
/** 軽く払った、とみなす速さ（px/秒）。 */
const FLICK_V = 120;
/** 短く払った、とみなす触れていた時間（ms）と、動かした距離（px）。これより長い・遠いのは、ゆっくりのスクロール。 */
const FLICK_MS = 280;
const FLICK_PX = 140;
/**
 * 強く払った、とみなす速さ（px/秒）。これより速く離したら、触れていた時間・距離が長くても払った扱い（11/21 レビュー：
 * 約200px すばやく払うと「ゆっくりのスクロール」になり、場面の途中で止まって文が出かけのまま固まっていた）。
 */
const FLING_V = 900;
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

  // 朗読するように運ぶ（11/20 23:14 渡辺さん「朗読するように再生」、22:06「ゆっくり、減速しながら止まる」）。
  // 時間 T は先に決め（場面のコマはその文を読む秒数、ほかは距離から）、速さは「台形」：
  //   1. はじめ a 秒で、指を離した速さ v0 から一定の速さ vc へ（離した瞬間の速さが途切れない）。
  //   2. 一定の速さ vc で進む（文の字は朗読の時刻に合わせて現れるので、一定の速さだと読む速さどおりに出る）。
  //   3. おわり b 秒で、なめらかに減速して止まる（速さ vc·(1 − u/b)²、止まる直前ほどゆっくり）。行き過ぎない。
  //   v0 は行き先の向きの成分だけ、平均の速さの 2 倍まで（それより速いと vc が小さくなりすぎるため）。
  const glide = (to: number, v0 = 0) => {
    stop();
    const x0 = el.scrollTop;
    // 節目をまたいで前へ一つ進むとき：節目までは短く、節目から先は朗読の速さ（節目で速さが途切れないよう、節目での
    // 速さを後半の一定の速さに合わせ、後半はその速さを引き継ぐ）。
    const w = o.waypoint?.();
    if (!o.reduced?.() && w !== undefined && x0 < w - 4 && to > w + 4 && o.seconds) {
      const T2 = travelSeconds(w, to);
      const D2 = to - w;
      const vc2 = D2 / Math.max(0.5, T2 - 0.5 - (2 * Math.min(1.1, T2 * 0.35)) / 3);
      const D1 = w - x0;
      const T1 = byDistance(D1);
      const s0 = Math.max(0, v0) * T1;
      const s1 = vc2 * T1;
      // エルミートの曲線（始めの速さ v0、終わりの速さ vc2）。
      const pos1 = (k: number) => {
        const k2 = k * k;
        const k3 = k2 * k;
        return x0 + (k3 - 2 * k2 + k) * s0 + (-2 * k3 + 3 * k2) * D1 + (k3 - k2) * s1;
      };
      let t0 = -1;
      target = to;
      const tick = (now: number) => {
        if (t0 < 0) t0 = now - 8;
        const k = (now - t0) / 1000 / T1;
        if (k >= 1) {
          el.scrollTop = w;
          raf = 0;
          glideFrom(w, to, vc2);
          return;
        }
        const y = pos1(k);
        el.scrollTop = y;
        report(y, false);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return;
    }
    glideFrom(x0, to, v0);
  };
  const glideFrom = (x0: number, to: number, v0: number) => {
    const D = to - x0;
    if (Math.abs(D) < 0.5) {
      el.scrollTop = to;
      report(to, true);
      return;
    }
    const T = o.reduced?.() ? 0.45 : travelSeconds(x0, to);
    const a = Math.min(0.5, T * 0.2);
    const b = Math.min(1.1, T * 0.35);
    const toward = Math.sign(v0) === Math.sign(D);
    const vs = toward ? Math.sign(D) * Math.min(Math.abs(v0), (2 * Math.abs(D)) / T) : 0;
    const vc = (D - (vs * a) / 2) / (T - a / 2 - (2 * b) / 3);
    const xa = x0 + ((vs + vc) * a) / 2;
    const xb = xa + vc * (T - a - b);
    const pos = (t: number) => {
      if (t < a) return x0 + vs * t + ((vc - vs) * t * t) / (2 * a);
      if (t < T - b) return xa + vc * (t - a);
      const u = Math.min(b, t - (T - b));
      return xb + ((vc * b) / 3) * (1 - Math.pow(1 - u / b, 3));
    };
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
      const y = pos(k * T);
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
  // 朗読の速さで運ぶのは「今の区切りから、次の区切りへ一つ進む」ときだけ（11/21 レビュー：とばす・ドットで約40秒、
  // 1ページ戻るのに約18秒かかっていた）。戻る・二つ以上先へ・とばすは、距離から（1.1〜1.8 秒）。
  const travelSeconds = (x0: number, to: number) => {
    if (stops.indexOf(to) < 0 || !o.seconds) return byDistance(to - x0);
    const next = stops.find((s) => s > x0 + 2);
    if (to <= x0 || to !== next) return byDistance(to - x0);
    let t = 0;
    for (let k = 1; k < stops.length; k++) {
      const a = stops[k - 1];
      const b = stops[k];
      const lo = Math.max(a, Math.min(x0, to));
      const hi = Math.min(b, Math.max(x0, to));
      if (hi <= lo || b <= a) continue;
      t += ((o.seconds(k) ?? byDistance(b - a)) * (hi - lo)) / (b - a);
    }
    return Math.min(40, Math.max(0.8, t)); // 長い文は朗読の時間どおり（数十秒になることもある）
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

  // 動いている途中に触れて止めたとき、続くクリック（場面を押すと次のコマへ）は捨てる（11/21 レビュー：止めたつもりが
  // また動きだしていた）。
  const swallowClick = () => {
    const eat = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    el.addEventListener("click", eat, { capture: true, once: true });
    window.setTimeout(() => el.removeEventListener("click", eat, { capture: true }), 600);
  };
  let stoppedByTouch = false;
  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const wasMoving = raf !== 0;
    stoppedByTouch = wasMoving;
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
    // 触れただけ（タップ）：動かさない（場面を押したときの「次のコマへ」は、押した側の処理）。動いている途中で触れて
    // 止めたのなら、そのタップでは進めない。
    if (!decided) {
      if (stoppedByTouch) swallowClick();
      return;
    }
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
    // 物語の本編（場面）より前（本の表紙・見開き・場面へ入る空）は区切りへ運ばない（11/20 23:13 渡辺さん「本編が始まる
    // 前までは スナップしない」）。指のまま、離したら少しの惰性だけ。
    const free = o.freeBefore ? Math.max(startTop, top) < o.freeBefore() : false;
    const flick =
      !free &&
      ((e.timeStamp - startT < FLICK_MS && Math.abs(moved) < FLICK_PX && Math.abs(v) > FLICK_V) ||
        Math.abs(v) > FLING_V);
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
