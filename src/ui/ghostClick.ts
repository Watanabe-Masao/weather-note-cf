// A tap's click comes after the finger lifts, aimed at whatever is under the finger by then (iOS).
// When the tap itself moved what was there — a sheet lowered or closed on pointerup — that click
// lands on the page behind and picks a day or an hour there. Right after such a move, clicks are
// swallowed for a moment.

const GUARD_MS = 350;
let until = 0;

const stop = (e: Event) => {
  if (performance.now() > until) return;
  e.stopPropagation();
  e.preventDefault();
};

let installed = false;

/** Swallow the click that follows the pointer or touch that just moved a sheet. */
export function swallowGhostClick(ms = GUARD_MS): void {
  if (!installed) {
    window.addEventListener("click", stop, true);
    installed = true;
  }
  until = performance.now() + ms;
}
