// Synthetic pointer flick on an element, with real timing inside the page (no round trips).
window.__flick = (sel, dy, ms, steps = 6) =>
  new Promise((done) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + 30, y0 = r.top + 10;
    const opts = (y) => ({ bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y });
    el.dispatchEvent(new PointerEvent("pointerdown", opts(y0)));
    let i = 0;
    const tick = () => {
      i++;
      const y = y0 + (dy * i) / steps;
      el.dispatchEvent(new PointerEvent("pointermove", opts(y)));
      if (i < steps) setTimeout(tick, ms / steps);
      else setTimeout(() => { el.dispatchEvent(new PointerEvent("pointerup", opts(y))); setTimeout(done, 700); }, 8);
    };
    setTimeout(tick, ms / steps);
  });
