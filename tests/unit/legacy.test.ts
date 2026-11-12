import { describe, expect, it } from "vitest";
import { legacyAt, parseLegacy, type LegacySlide } from "../../src/astro/legacy.js";
import { fixture, outline, toHast } from "./helpers.js";

/** The legacy table of a Markdown deck, as `readLegacy` reads it from the DOM. */
function table(markdown: string): LegacySlide[][] {
  return outline(toHast(markdown)).blocks.map(block =>
    block.slides.map(slide => ({ legacy: Number(slide.legacy), legacyV: Number(slide.legacyV), pages: slide.pages.length }))
  );
}

describe("parseLegacy", () => {
  it("reads h and h.v", () => {
    expect(parseLegacy("11")).toEqual({ h: 11, v: 0 });
    expect(parseLegacy("11.2")).toEqual({ h: 11, v: 2 });
  });

  it("rejects anything else", () => {
    expect(parseLegacy("")).toBeNull();
    expect(parseLegacy("a.b")).toBeNull();
    expect(parseLegacy("1.2.3")).toBeNull();
  });
});

describe("legacyAt", () => {
  // Old deck: 0 = cover; 1 = a stack of three (same h2, so one slide of three pages); 2 = a stack split into two slides.
  const deck = `# 封面\n\n---\n\n## 甲\n\n一\n\n::vertical\n\n## 甲\n\n二\n\n::vertical\n\n三\n\n---\n\n## 乙\n\n::vertical\n\n## 丙\n\n::vertical\n\n丙之二`;

  it("maps a horizontal index to the first page of its slide", () => {
    expect(legacyAt(table(deck), 0, 0)).toBe("1.1.1");
    expect(legacyAt(table(deck), 1, 0)).toBe("1.2.1");
  });

  it("maps a vertical index to the page inside the slide", () => {
    expect(legacyAt(table(deck), 1, 1)).toBe("1.2.2");
    expect(legacyAt(table(deck), 1, 2)).toBe("1.2.3");
  });

  it("follows a stack that was split into several slides", () => {
    expect(legacyAt(table(deck), 2, 0)).toBe("1.3.1");
    expect(legacyAt(table(deck), 2, 1)).toBe("1.4.1");
    expect(legacyAt(table(deck), 2, 2)).toBe("1.4.2");
  });

  it("lands on the last page when v runs past the old stack, and gives null for an unknown h", () => {
    expect(legacyAt(table(deck), 1, 9)).toBe("1.2.3");
    expect(legacyAt(table(deck), 7, 0)).toBeNull();
  });

  it("finds 「從步驟到頁」 of the kicker deck at its old link slide=5.1", () => {
    const markdown = fixture("kicker-deck.md");
    const blocks = outline(toHast(markdown)).blocks;
    const at = legacyAt(table(markdown), 5, 1)!;
    const [b, s, p] = at.split(".").map(Number);
    expect(blocks[b - 1].slides[s - 1].title).toBe("從步驟到頁");
    expect(p).toBe(1);
    // The first page of the same old stack is the slide before it.
    expect(legacyAt(table(markdown), 5, 0)).toBe("2.5.1");
  });
});
