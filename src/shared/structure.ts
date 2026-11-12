/**
 * How a deck's Markdown maps to blocks, slides, and pages. `contour-deck/remark` and
 * `contour-deck/rehype` take the same `structure` option and resolve it here, per file.
 *
 * - `"slides"` (default): `---` starts a slide, `::vertical` a page, and blocks come from `::block`,
 *   `####` kickers, or `#` dividers.
 * - `"headings"`: `---` starts a block, `##` a slide, `###` a page.
 */

/** The file both plugins receive: a `VFile`, as far as they use it. */
export interface DeckFile {
  data: object;
  fail(reason: string, place?: unknown, origin?: string): never;
}

export type Structure = "slides" | "headings";

/** A structure for every file, or a function that picks one per file (nothing means `"slides"`). */
export type StructureOption = Structure | ((file: DeckFile) => Structure | null | undefined);

/** The one message for `::vertical` under `"headings"`, whichever plugin meets it. */
export const NO_VERTICAL = '::vertical has no meaning with structure: "headings": start the next page with a ### heading';

/**
 * The structure of `file`. The value often comes from frontmatter, so anything other than the two
 * names is an error here, not a silent fallback to the default.
 */
export function structureOf(option: StructureOption | undefined, file: DeckFile, origin: string): Structure {
  const value: unknown = typeof option === "function" ? option(file) : option;
  if (value === undefined || value === null) return "slides";
  if (value === "slides" || value === "headings") return value;
  return file.fail(`structure must be "slides" or "headings", got ${JSON.stringify(value)}`, undefined, origin);
}

/** Where `remarkDeck` leaves the structure it read a file by, for `rehypeDeck` to compare. */
const RECORD = "contourDeckStructure";

export function recordStructure(file: DeckFile, structure: Structure): void {
  (file.data as Record<string, unknown>)[RECORD] = structure;
}

/** Fails when `remarkDeck` read the file by another structure than `rehypeDeck` is about to. */
export function checkStructure(file: DeckFile, structure: Structure, origin: string): void {
  const recorded = (file.data as Record<string, unknown>)[RECORD];
  if (recorded !== undefined && recorded !== structure) {
    file.fail(
      `remarkDeck ran with structure "${String(recorded)}" and rehypeDeck with "${structure}": give both the same structure option`,
      undefined,
      origin
    );
  }
}
