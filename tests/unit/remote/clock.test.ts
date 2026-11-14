import { describe, expect, it } from "vitest";
import { createClock, formatClock, plannedSeconds } from "../../../src/remote/clock.js";

describe("createClock", () => {
  it("reads zero until it starts, then never zero again", () => {
    const clock = createClock();
    expect(clock.running).toBe(false);
    clock.enter(3, 500);
    expect(clock.read(10_000)).toEqual({ elapsed: 0, blockElapsed: 0 });
    clock.start(1, 1000);
    // A guest takes `elapsed > 0` as "the clock is running", so the very first reading is 0.1.
    expect(clock.read(1000)).toEqual({ elapsed: 0.1, blockElapsed: 0 });
    expect(clock.read(13_340)).toEqual({ elapsed: 12.3, blockElapsed: 12.3 });
  });

  it("adds up the visits to a block", () => {
    const clock = createClock();
    clock.start(1, 0);
    clock.enter(2, 60_000);
    expect(clock.read(90_000)).toEqual({ elapsed: 90, blockElapsed: 30 });
    clock.enter(1, 100_000);
    // Back in block 1: its first minute plus the 20 s since.
    expect(clock.read(120_000)).toEqual({ elapsed: 120, blockElapsed: 80 });
    // A move inside the block changes nothing.
    clock.enter(1, 125_000);
    expect(clock.read(130_000).blockElapsed).toBe(90);
  });

  it("continues from a stored state and resets to idle", () => {
    const first = createClock();
    first.start(0, 1000);
    first.enter(2, 4000);
    const stored = JSON.parse(JSON.stringify(first.state));
    const second = createClock(stored);
    expect(second.read(9000)).toEqual({ elapsed: 8, blockElapsed: 5 });
    second.reset();
    expect(second.running).toBe(false);
    expect(second.read(20_000).elapsed).toBe(0);
  });
});

describe("plannedSeconds", () => {
  it("sums the minutes of the blocks the linear advance enters", () => {
    const blocks = [
      { minutes: 0, kind: "cover" },
      { minutes: 3, kind: "" },
      { minutes: 1.5, kind: "" },
      { minutes: 10, kind: "appendix" },
    ];
    expect(plannedSeconds(blocks, ["appendix"])).toBe(270);
    expect(plannedSeconds(blocks, [])).toBe(870);
    expect(plannedSeconds([{ minutes: 0, kind: "" }], [])).toBeNull();
  });

  it("leaves out the opening and the closing, whatever the skip list", () => {
    const blocks = [
      { minutes: 2, kind: "opening" },
      { minutes: 3, kind: "" },
      { minutes: 1, kind: "closing" },
    ];
    expect(plannedSeconds(blocks, [])).toBe(180);
    expect(plannedSeconds(blocks, ["appendix"])).toBe(180);
  });
});

describe("formatClock", () => {
  it("writes m:ss and h:mm:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(72.9)).toBe("1:12");
    expect(formatClock(720)).toBe("12:00");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-3)).toBe("0:00");
  });
});
