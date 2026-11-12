import { describe, expect, it } from "vitest";
import { createWheelGate } from "../../src/core/gestures.js";

describe("createWheelGate", () => {
  it("takes one step for a trackpad gesture and ignores its inertia tail", () => {
    const step = createWheelGate();
    const deltas = [40, 90, 120, 80, 50, 30, 18, 10, 6, 4, 3];
    const steps = deltas.map((delta, i) => step(delta, 1000 + i * 16));
    expect(steps.filter(Boolean)).toEqual([1]);
    expect(steps[0]).toBe(1);
  });

  it("takes a second step after a pause", () => {
    const step = createWheelGate();
    expect(step(120, 0)).toBe(1);
    expect(step(60, 16)).toBe(0);
    expect(step(120, 600)).toBe(1);
  });

  it("does not step again inside the lock, even for a fresh gesture", () => {
    const step = createWheelGate();
    expect(step(120, 0)).toBe(1);
    expect(step(120, 200)).toBe(0);
    expect(step(120, 430)).toBe(1);
  });

  it("reads a clearly larger delta in the middle of a tail as a new gesture", () => {
    const step = createWheelGate();
    expect(step(100, 0)).toBe(1);
    for (let t = 16; t < 480; t += 16) expect(step(8, t)).toBe(0);
    expect(step(90, 496)).toBe(1);
  });

  it("steps up for a negative delta", () => {
    expect(createWheelGate()(-120, 0)).toBe(-1);
  });

  it("ignores jitter under 3 pixels and anything while blocked", () => {
    const step = createWheelGate();
    expect(step(2, 0)).toBe(0);
    expect(step(120, 500, true)).toBe(0);
  });

  it("keeps ignoring an unbroken tail however long it runs", () => {
    const step = createWheelGate();
    expect(step(120, 0)).toBe(1);
    let size = 110;
    for (let t = 16; t < 2000; t += 16) {
      expect(step(size, t)).toBe(0);
      size = Math.max(3, size * 0.97);
    }
  });
});
