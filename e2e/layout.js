// Layout checks run in the page by e2e.py: text that runs out of its box, and text that lies on
// other text. Only what is on screen is looked at; text inside a scroller is judged against the
// scroller's visible part, and a box that clips its text on purpose (… ellipsis) is listed apart.
(() => {
  const onScreen = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const hidden = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity < 0.05) return true;
    }
    return false;
  };
  const name = (el) => `${(el.getAttribute("class") || el.tagName.toLowerCase()).split(" ").slice(0, 3).join(".")}「${el.textContent.trim().slice(0, 12)}」`;
  const clips = (cs) => /hidden|clip|auto|scroll/.test(cs.overflowX) || cs.textOverflow === "ellipsis";

  const opaque = (el) => {
    const cs = getComputedStyle(el);
    const m = cs.backgroundColor.match(/[\d.]+/g);
    return (m && (m[3] === undefined ? 1 : +m[3]) > 0.5) || (cs.backgroundImage !== "none" && !cs.backgroundImage.includes("url"));
  };
  // Both texts show at (x, y): the lower one is not under a painted face (a pinned column, a sheet).
  function bothSeen(a, b, x, y) {
    const stack = document.elementsFromPoint(x, y);
    const at = (el) => stack.findIndex((s) => s === el || el.contains(s));
    const ia = at(a), ib = at(b);
    if (ia < 0 || ib < 0) return false;
    const lower = ia > ib ? a : b;
    return !stack.slice(0, Math.max(ia, ib)).some((s) => !s.contains(lower) && !lower.contains(s) && opaque(s));
  }

  window.__layoutIssues = function () {
    const runs = []; // one per text node: its rects and its element
    const out = { overflow: [], overlap: [], clipped: [] };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? 1 : 2) });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest("[aria-hidden=true] svg, script, style, title") || hidden(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1 && onScreen(r));
      if (!rects.length) continue;
      runs.push({ el, rects });
      if (el.closest("svg")) continue;
      // Runs out of its own box: past the element's right or left edge.
      const box = el.getBoundingClientRect();
      const past = Math.max(...rects.map((r) => r.right - box.right), ...rects.map((r) => box.left - r.left));
      const cs = getComputedStyle(el);
      if (past > 1.5) (clips(cs) ? out.clipped : out.overflow).push(`${name(el)} +${past.toFixed(1)}px`);
      // Cut short by its own box (… ellipsis, or hidden overflow): the box is narrower than its text.
      else if (clips(cs) && cs.overflowX !== "auto" && cs.overflowX !== "scroll" && el.scrollWidth > el.clientWidth + 1) out.clipped.push(`${name(el)} −${el.scrollWidth - el.clientWidth}px`);
    }
    // Text on text: two runs of different elements whose rects cross by more than a sliver.
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i], b = runs[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        let hit = false;
        for (const p of a.rects) for (const q of b.rects) {
          const w = Math.min(p.right, q.right) - Math.max(p.left, q.left);
          const h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
          if (w > 2 && h > 3 && bothSeen(a.el, b.el, Math.max(p.left, q.left) + w / 2, Math.max(p.top, q.top) + h / 2)) hit = true;
        }
        if (hit) { const ra = a.rects[0], rb = b.rects[0]; out.overlap.push(`${name(a.el)} × ${name(b.el)} @${Math.round(ra.left)},${Math.round(ra.top)}–${Math.round(ra.right)} / ${Math.round(rb.left)},${Math.round(rb.top)}–${Math.round(rb.right)}`); }
      }
    }
    for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].slice(0, 8);
    return out;
  };
})();
