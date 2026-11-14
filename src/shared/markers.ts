/**
 * The hand-off between `contour-deck/remark` and `contour-deck/rehype`.
 *
 * The remark plugin writes these marker elements; the rehype plugin consumes them and
 * removes every one, so none appears in the final HTML except `data-ct-notes` and
 * `data-ct-background`, which are already the contract's own attributes.
 */

/** hast property that names a marker (`data-ct-mark` in HTML). */
export const MARK = "dataCtMark";

/** hast property of a notes element (`data-ct-notes` in HTML). */
export const NOTES = "dataCtNotes";

/** hast property of a page background (`data-ct-background` in HTML), the contract's own like notes. */
export const BACKGROUND = "dataCtBackground";

/** Element that is a page's notes or its background: neither is page content. */
export const isAside = (properties: Record<string, unknown> | undefined): boolean =>
  !!properties && (NOTES in properties || BACKGROUND in properties);

export const MARK_BLOCK = "block";
export const MARK_SLIDE = "slide";
export const MARK_VERTICAL = "vertical";
export const MARK_BUILD = "build";
