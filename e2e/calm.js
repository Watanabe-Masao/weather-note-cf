// Waits for the page to come to rest, instead of a fixed sleep (#182): no running (finite)
// animation, no request in flight, and nothing that scrolls or slides (strips, sheets, drums)
// moved for `quiet` ms — longer than the strip's settle (140 ms), so a glide that is about to
// be corrected is not taken for rest. Resolves with the ms it took; never later than `max`.
(() => {
  let inflight = 0;
  const f = window.fetch;
  window.fetch = function (...a) {
    inflight++;
    return f.apply(this, a).finally(() => inflight--);
  };
  const movers = ".strip, .sheet, .msheet, .sheet-body, .band-map, .drum-pane, .lt-chart, .compare-summary";
  const sig = () =>
    JSON.stringify(
      [...document.querySelectorAll(movers)].map((e) => {
        const r = e.getBoundingClientRect();
        return [e.scrollLeft | 0, e.scrollTop | 0, r.top | 0, r.left | 0, r.height | 0];
      }),
    );
  const running = () =>
    document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity).length;
  window.__calm = (max = 3000, quiet = 250) =>
    new Promise((res) => {
      const t0 = performance.now();
      let last = "";
      let since = t0;
      const tick = () => {
        const now = performance.now();
        const s = sig();
        if (s !== last || running() > 0 || inflight > 0) {
          if (s !== last) last = s;
          since = now;
        }
        if (now - since >= quiet || now - t0 >= max) return res(Math.round(now - t0));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
})();
