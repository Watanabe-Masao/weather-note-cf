import { describe, expect, it } from "vitest";
import { moveDuration, project, releaseTarget, rubberBand, softClamp, VelocityTracker } from "../../src/ui/sheetMotion";

const H = { min: 64, mid: 260, max: 690 };

describe("sheet motion", () => {
  it("settles on the nearest height after a slow release", () => {
    expect(releaseTarget(300, 0, H)).toBe("mid");
    expect(releaseTarget(500, 0, H)).toBe("max");
    expect(releaseTarget(120, 0, H)).toBe("min");
  });

  it("moves at least one step on a flick, in its direction", () => {
    // 70 px up from the middle, released quickly: the next height up
    expect(releaseTarget(330, 1.1, H)).toBe("max");
    // a quick flick down from the top: back to the middle, not past it
    expect(releaseTarget(650, -0.8, H)).toBe("mid");
    // a fast flick from the top carries on to the bottom
    expect(releaseTarget(600, -6, H)).toBe("min");
    // a flick up from the top stays at the top
    expect(releaseTarget(690, 2, H)).toBe("max");
  });

  it("projects like a decelerating glide and rubber-bands past the ends", () => {
    expect(project(100, 1)).toBeCloseTo(199, 0);
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(1000)).toBeLessThan(120);
    expect(rubberBand(40)).toBeLessThan(40);
    expect(softClamp(800, 64, 690)).toBeGreaterThan(690);
    expect(softClamp(800, 64, 690)).toBeLessThan(800);
    expect(softClamp(300, 64, 690)).toBe(300);
  });

  it("measures recent velocity and forgets a finger that stopped", () => {
    const v = new VelocityTracker();
    v.reset(0, 0);
    v.add(20, 10);
    v.add(40, 20);
    expect(v.velocity(25)).toBeCloseTo(2, 5);
    expect(v.velocity(200)).toBe(0);
  });

  it("takes longer for longer moves, within bounds", () => {
    expect(moveDuration(10)).toBe(220);
    expect(moveDuration(-400)).toBe(460);
    expect(moveDuration(150)).toBeGreaterThan(moveDuration(50));
  });
});
