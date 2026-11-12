import { describe, expect, it } from "vitest";
import { isTall, nextStop, pageIndexAt, pageProgress, pageStops } from "../../src/core/stops.js";

const VIEWPORT = 760;

describe("pageStops", () => {
  it("stops at every page top when the pages fit the viewport", () => {
    const pages = [
      { top: 0, height: 760 },
      { top: 760, height: 760 },
      { top: 1520, height: 760 },
    ];
    expect(pageStops(pages, VIEWPORT)).toEqual([0, 760, 1520]);
  });

  it("adds a stop at the end of a page taller than the viewport (the prototype's 三.4)", () => {
    // Viewport 760, second page 1016 high: its end is at 760 + 1016 - 760.
    const pages = [
      { top: 0, height: 760 },
      { top: 760, height: 1016 },
    ];
    expect(pageStops(pages, VIEWPORT)).toEqual([0, 760, 1016]);
  });

  it("walks a very tall page in steps of 85% of the viewport, ending flush with its bottom", () => {
    const pages = [{ top: 0, height: 2400 }];
    // 646 and 1292 are 85% steps; 1640 is the end. 1938 is skipped: it would land past the end.
    expect(pageStops(pages, VIEWPORT)).toEqual([0, 646, 1292, 1640]);
  });

  it("drops an inner stop that would land within 20% of the viewport from the end", () => {
    // End at 700; an 85% step lands at 646, only 54 px short of it.
    expect(pageStops([{ top: 0, height: 1460 }], VIEWPORT)).toEqual([0, 700]);
  });

  it("treats a page a few pixels over the viewport as fitting", () => {
    expect(pageStops([{ top: 0, height: 766 }], VIEWPORT)).toEqual([0]);
    expect(isTall({ top: 0, height: 766 }, VIEWPORT)).toBe(false);
    expect(isTall({ top: 0, height: 780 }, VIEWPORT)).toBe(true);
  });

  it("keeps the next page's top as a stop after a tall page", () => {
    const pages = [
      { top: 0, height: 1016 },
      { top: 1016, height: 760 },
    ];
    expect(pageStops(pages, VIEWPORT)).toEqual([0, 256, 1016]);
  });
});

describe("nextStop", () => {
  const stops = [0, 760, 1016];

  it("moves one stop at a time in each direction", () => {
    expect(nextStop(stops, 0, 1)).toBe(760);
    expect(nextStop(stops, 760, 1)).toBe(1016);
    expect(nextStop(stops, 1016, -1)).toBe(760);
    expect(nextStop(stops, 760, -1)).toBe(0);
  });

  it("returns undefined at either end", () => {
    expect(nextStop(stops, 1016, 1)).toBeUndefined();
    expect(nextStop(stops, 0, -1)).toBeUndefined();
  });

  it("ignores a stop within a few pixels of the current position", () => {
    expect(nextStop(stops, 757, 1)).toBe(1016);
    expect(nextStop(stops, 763, -1)).toBe(0);
  });

  it("from between two stops goes to the nearer one in the direction of travel", () => {
    expect(nextStop(stops, 400, 1)).toBe(760);
    expect(nextStop(stops, 400, -1)).toBe(0);
  });
});

describe("pageIndexAt and pageProgress", () => {
  const pages = [
    { top: 0, height: 760 },
    { top: 760, height: 1016 },
  ];

  it("names the page under the reading line, 35% down the viewport", () => {
    expect(pageIndexAt(pages, 0, VIEWPORT)).toBe(0);
    expect(pageIndexAt(pages, 400, VIEWPORT)).toBe(0);
    expect(pageIndexAt(pages, 500, VIEWPORT)).toBe(1);
    expect(pageIndexAt(pages, 1016, VIEWPORT)).toBe(1);
  });

  it("reports how far a tall page has been read", () => {
    expect(pageProgress(pages[0], 0, VIEWPORT)).toBe(1);
    expect(pageProgress(pages[1], 760, VIEWPORT)).toBeCloseTo(760 / 1016);
    expect(pageProgress(pages[1], 1016, VIEWPORT)).toBe(1);
  });
});
