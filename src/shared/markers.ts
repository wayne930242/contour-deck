/**
 * The hand-off between `contour-deck/remark` and `contour-deck/rehype`.
 *
 * The remark plugin writes these marker elements; the rehype plugin consumes them and
 * removes every one, so none appears in the final HTML except `data-ct-notes`, which is
 * already the contract's own attribute.
 */

/** hast property that names a marker (`data-ct-mark` in HTML). */
export const MARK = "dataCtMark";

/** hast property of a notes element (`data-ct-notes` in HTML). */
export const NOTES = "dataCtNotes";

export const MARK_BLOCK = "block";
export const MARK_SLIDE = "slide";
export const MARK_VERTICAL = "vertical";
export const MARK_BUILD = "build";
