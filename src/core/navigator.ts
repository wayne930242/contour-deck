/** Which block a move across the block boundary lands in. */

/**
 * The nearest block in `direction` whose kind is not skipped, or -1.
 * With `skip = ["appendix"]` the main part ends at its last block, and an appendix is left backwards only.
 */
export function neighbourBlock(kinds: string[], from: number, direction: 1 | -1, skip: string[]): number {
  for (let b = from + direction; b >= 0 && b < kinds.length; b += direction) {
    if (!skip.includes(kinds[b])) return b;
  }
  return -1;
}

/** Kinds of the blocks around the talk: the title pages before the outline, the thank-you after the last block. */
export const FRAME_KINDS = ["opening", "closing"];

/**
 * The blocks the outline and the rail draw, `first` to `last`: all but an `opening` first block and a
 * `closing` last block (the build allows them only there).
 */
export function mainRange(kinds: string[]): { first: number; last: number } {
  const first = kinds[0] === "opening" && kinds.length > 1 ? 1 : 0;
  const last = kinds.length - 1 > first && kinds[kinds.length - 1] === "closing" ? kinds.length - 2 : kinds.length - 1;
  return { first, last };
}
