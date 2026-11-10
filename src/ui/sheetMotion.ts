// Shared motion for the sheets: how a drag feels and where a release lands.
//
// - Velocity is measured over the last ~80 ms of the drag, so a flick counts even if the finger
//   slows right before lifting.
// - A release is projected forward as if the sheet kept gliding and slowed down (like iOS scroll
//   views), and the nearest height to that projected point wins: a short quick flick moves one step.
// - Past the ends the sheet follows the finger with growing resistance (rubber band).

import { MOTION } from "../design/tokens";

/** iOS-like sheet curve: fast start, long soft landing (design token). */
export const SHEET_EASE = MOTION.ease.sheet;

/** Duration for a move of `distance` px: short moves are quick, long ones never drag on. */
export function moveDuration(distance: number): number {
  return Math.round(Math.min(MOTION.settleMax, Math.max(MOTION.settleMin, 180 + Math.abs(distance) * 0.9)));
}

/** Where a release at `position` with `velocity` (px/ms, same direction as position) would come to rest. */
export function project(position: number, velocity: number, deceleration = 0.99): number {
  return position + (velocity * deceleration) / (1 - deceleration);
}

/** Rubber band: `overshoot` px past an end becomes less and less movement, never more than `limit`. */
export function rubberBand(overshoot: number, limit = 120): number {
  if (overshoot <= 0) return overshoot;
  return limit * (1 - 1 / (overshoot / limit + 1));
}

/** Clamp `value` into [min, max] with rubber banding outside. */
export function softClamp(value: number, min: number, max: number): number {
  if (value > max) return max + rubberBand(value - max);
  if (value < min) return min - rubberBand(min - value);
  return value;
}

/** Speed (px/ms) above which a release is a flick: it always moves on in its direction. */
export const FLICK = 0.4;

/**
 * Where a release settles: the detent nearest to where it would glide to, but a flick always
 * reaches at least the next detent in its direction (a short quick flick moves one step).
 * `velocity` is positive when the height grows (finger moving up).
 */
export function releaseTarget<T extends string>(height: number, velocity: number, heights: Record<T, number>): T {
  const keys = (Object.keys(heights) as T[]).sort((a, b) => heights[a] - heights[b]);
  const goal = project(height, velocity);
  let target = keys.reduce((best, d) => (Math.abs(heights[d] - goal) < Math.abs(heights[best] - goal) ? d : best));
  if (velocity > FLICK) {
    const next = keys.find((d) => heights[d] > height + 1);
    if (next && heights[target] < heights[next]) target = next;
  } else if (velocity < -FLICK) {
    const next = [...keys].reverse().find((d) => heights[d] < height - 1);
    if (next && heights[target] > heights[next]) target = next;
  }
  return target;
}

/** Follows the pointer and reports its recent velocity. */
export class VelocityTracker {
  private samples: { t: number; v: number }[] = [];
  constructor(private window = 80) {}

  reset(value: number, t = performance.now()) {
    this.samples = [{ t, v: value }];
  }

  add(value: number, t = performance.now()) {
    this.samples.push({ t, v: value });
    const from = t - this.window;
    while (this.samples.length > 2 && this.samples[0].t < from) this.samples.shift();
  }

  /** px/ms over the recent window; 0 when there is too little to tell. */
  velocity(t = performance.now()): number {
    const s = this.samples;
    if (s.length < 2) return 0;
    const last = s[s.length - 1];
    // A finger that stopped before lifting has no velocity left.
    if (t - last.t > 100) return 0;
    const first = s[0];
    const dt = last.t - first.t;
    return dt > 0 ? (last.v - first.v) / dt : 0;
  }
}

export const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** Keep receiving a pointer's moves outside the element; never fatal (some pointers cannot be captured). */
export function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // The drag still follows while the pointer stays over the element.
  }
}
