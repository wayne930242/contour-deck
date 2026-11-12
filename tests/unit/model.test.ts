import { describe, expect, it } from "vitest";
import { fitPos, formatAt, parseAt } from "../../src/core/model.js";
import { neighbourBlock } from "../../src/core/navigator.js";

describe("parseAt and formatAt", () => {
  it("reads 1-based block, slide, and page ordinals", () => {
    expect(parseAt("4.4.2")).toEqual({ b: 3, s: 3, p: 1 });
    expect(parseAt("4.4")).toEqual({ b: 3, s: 3, p: 0 });
    expect(parseAt("4")).toEqual({ b: 3, s: 0, p: 0 });
  });

  it("returns null for anything that is not numeric, so it can be tried as an element id", () => {
    for (const text of ["", "dilemma", "s-4-4", "4.", "4.4.2.1", "4.x", "-1.2"]) expect(parseAt(text)).toBeNull();
  });

  it("writes what it reads", () => {
    expect(formatAt({ b: 3, s: 3, p: 1 })).toBe("4.4.2");
    expect(parseAt(formatAt({ b: 0, s: 0, p: 0 }))).toEqual({ b: 0, s: 0, p: 0 });
  });
});

describe("fitPos", () => {
  const blocks = [{ slides: [{ pages: [1] }, { pages: [1, 2] }] }, { slides: [{ pages: [1] }] }];

  it("accepts a position that exists and clamps a page past the end", () => {
    expect(fitPos(blocks, { b: 0, s: 1, p: 1 })).toEqual({ b: 0, s: 1, p: 1 });
    expect(fitPos(blocks, { b: 0, s: 1, p: 9 })).toEqual({ b: 0, s: 1, p: 1 });
  });

  it("rejects a block or slide that does not exist, including 0 in the URL", () => {
    expect(fitPos(blocks, { b: 2, s: 0, p: 0 })).toBeNull();
    expect(fitPos(blocks, { b: 1, s: 1, p: 0 })).toBeNull();
    expect(fitPos(blocks, parseAt("0.1")!)).toBeNull();
    expect(fitPos(blocks, parseAt("1.0")!)).toBeNull();
    expect(fitPos(blocks, parseAt("1.1.0")!)).toBeNull();
  });
});

describe("neighbourBlock", () => {
  const kinds = ["cover", "", "", "appendix", "appendix"];
  const skip = ["appendix"];

  it("moves to the adjacent block inside the main part", () => {
    expect(neighbourBlock(kinds, 0, 1, skip)).toBe(1);
    expect(neighbourBlock(kinds, 2, -1, skip)).toBe(1);
  });

  it("stops at the end of the main part: an appendix is never entered forwards", () => {
    expect(neighbourBlock(kinds, 2, 1, skip)).toBe(-1);
    expect(neighbourBlock(kinds, 3, 1, skip)).toBe(-1);
  });

  it("leaves an appendix backwards into the last main block", () => {
    expect(neighbourBlock(kinds, 3, -1, skip)).toBe(2);
    expect(neighbourBlock(kinds, 4, -1, skip)).toBe(2);
  });

  it("skips over a skipped block in the middle and walks everything when nothing is skipped", () => {
    expect(neighbourBlock(["", "appendix", ""], 0, 1, skip)).toBe(2);
    expect(neighbourBlock(kinds, 2, 1, [])).toBe(3);
    expect(neighbourBlock(kinds, 0, -1, skip)).toBe(-1);
  });
});
