/**
 * Old reveal.js links (`?view=slides&slide=h.v`) to a Contour position, read from the
 * `data-legacy` and `data-legacy-v` attributes of docs/CONTRACT.md.
 */

/** One slide as the old deck knew it: its horizontal index, the vertical index of its first page, its page count. */
export interface LegacySlide {
  legacy: number;
  legacyV: number;
  pages: number;
}

/** `"11"` or `"11.2"` to the old indexes; `null` when the text is not an old slide parameter. */
export function parseLegacy(slide: string): { h: number; v: number } | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(slide.trim());
  return match ? { h: Number(match[1]), v: Number(match[2] ?? 0) } : null;
}

/**
 * The `?at=` value (1-based `b.s.p`) of the old slide `h.v`. `blocks[b][s]` describes slide `s` of block `b`.
 * A `v` past the end of the old stack lands on its last page; an `h` the deck never had gives `null`.
 */
export function legacyAt(blocks: LegacySlide[][], h: number, v: number): string | null {
  let found: { b: number; s: number; slide: LegacySlide } | undefined;
  for (const [b, slides] of blocks.entries()) {
    for (const [s, slide] of slides.entries()) {
      if (slide.legacy !== h) continue;
      // Slides split from one old stack share `h`; the one that holds `v` starts at or before it.
      if (!found || (slide.legacyV <= v && slide.legacyV >= found.slide.legacyV)) found = { b, s, slide };
    }
  }
  if (!found) return null;
  const page = Math.min(Math.max(v - found.slide.legacyV, 0), found.slide.pages - 1);
  return `${found.b + 1}.${found.s + 1}.${page + 1}`;
}

/** Reads the legacy table of a deck element. Slides without `data-legacy` never match. */
export function readLegacy(root: Element): LegacySlide[][] {
  const childrenWith = (el: Element, attribute: string) => Array.from(el.children).filter(child => child.hasAttribute(attribute));
  const index = (el: Element, attribute: string, missing: number) => {
    const value = el.getAttribute(attribute);
    return value !== null && /^\d+$/.test(value) ? Number(value) : missing;
  };
  return childrenWith(root, "data-ct-block").map(block =>
    childrenWith(block, "data-ct-slide").map(slide => ({
      legacy: index(slide, "data-legacy", -1),
      legacyV: index(slide, "data-legacy-v", 0),
      pages: childrenWith(slide, "data-ct-page").length,
    }))
  );
}
