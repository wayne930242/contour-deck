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
