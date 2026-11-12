/** What the two readers (`---` slides in index.ts, headings.ts) share and hand to the assembler. */
import { isBlank, isElement, markOf, type Element, type HastNode } from "./hast.js";
import { firstHeading, slideTitle } from "./titles.js";

export const ORIGIN = "contour-deck:rehype";

/** A `::block` as written: under `structure: "headings"` it may come without a title. */
export interface BlockMark {
  title?: string;
  short?: string;
  minutes?: string;
  kind?: string;
  id?: string;
}

export interface BlockSpec extends BlockMark {
  title: string;
}

export interface SlideDraft {
  pages: HastNode[][];
  id?: string;
  block?: BlockSpec;
  /** Text of the first `h2` of the slide's first page: the key of the slide/page rule. */
  h2?: string;
  /** Old reveal.js indexes of the slide's first page: `?slide=h.v`. The headings reader has none. */
  legacy?: number;
  legacyV?: number;
}

export interface Group {
  spec: BlockSpec;
  slides: SlideDraft[];
}

/** Splits at breaks matching `isSplit`, dropping the breaks and the groups `keep` rejects. */
export function splitAt(
  nodes: HastNode[],
  isSplit: (node: HastNode) => boolean,
  keep: (group: HastNode[]) => boolean
): HastNode[][] {
  const groups: HastNode[][] = [[]];
  for (const node of nodes) {
    if (isSplit(node)) groups.push([]);
    else groups[groups.length - 1].push(node);
  }
  return groups.filter(keep);
}

/** A `---` of the author's, not the `<hr>` of a `::vertical` marker. */
export const isRule = (node: HastNode): boolean => isElement(node) && node.tagName === "hr" && markOf(node) === undefined;
export const hasContent = (group: HastNode[]): boolean => group.some(node => !isBlank(node));

export function blockMarkOf(marker: Element): BlockMark {
  const text = (value: unknown): string | undefined => (value === undefined ? undefined : String(value));
  const { dataTitle, dataShort, dataMinutes, dataKind, id } = marker.properties;
  return {
    title: text(dataTitle),
    short: text(dataShort),
    minutes: text(dataMinutes),
    kind: text(dataKind),
    id: typeof id === "string" ? id : undefined,
  };
}

/**
 * The title of a block that has none of its own: the deck title, else the deck's first `h1`,
 * else the title of the block's first slide.
 */
export function leadTitle(deckTitle: string | undefined, drafts: SlideDraft[], first: SlideDraft): string {
  return deckTitle || firstHeading(drafts.flatMap(item => item.pages.flat()), 1) || slideTitle(first.pages, "Slides");
}
