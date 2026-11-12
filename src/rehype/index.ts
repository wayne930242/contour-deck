/**
 * Assembles the deck of docs/CONTRACT.md from the hast of a slide post:
 * deck → block → slide → page, with notes, steps, reading times, legacy indexes and slide ids.
 *
 * - A top-level `<hr>` (`---`) starts a slide. Inside it, each `::vertical` child is a further page
 *   of the slide, unless its first `h2` differs from the slide's own: then it starts a new slide
 *   in the same block (a child without an `h2` is always a page).
 * - Blocks: `::block{…}` starts one. A deck with no `::block` starts a block at every slide that
 *   opens with a `####` kicker, titled by the kicker. A deck with neither uses section dividers:
 *   a slide whose first page is just an `h1` (`# 拆解`) starts a block titled by it. A title
 *   starting with 附錄 gets `data-kind="appendix"`. Without any of these the deck is one block.
 * - `<section>` inside page content is left alone: the contract reads data attributes only.
 *
 * Run it after `contour-deck/remark`, which writes the markers this plugin reads.
 */
import { MARK_BLOCK, MARK_SLIDE, MARK_VERTICAL } from "../shared/markers.js";
import {
  element,
  isBlank,
  isElement,
  markOf,
  plainText,
  walkElements,
  type Element,
  type HastNode,
} from "./hast.js";
import { buildPage } from "./page.js";
import { dividerOf, firstHeading, kickerOf, kindOf, shortOf, slideTitle } from "./titles.js";

export interface DeckOptions {
  /** Deck title for `data-title`. Default: the `title` frontmatter field under Astro, else none. */
  title?: string;
  /** Whether to build a deck for this file. Default: every file. */
  match?: (file: DeckFile) => boolean;
}

export interface DeckFile {
  data: object;
  fail(reason: string, place?: unknown, origin?: string): never;
}

const ORIGIN = "contour-deck:rehype";

interface BlockSpec {
  title: string;
  short?: string;
  minutes?: string;
  kind?: string;
  id?: string;
}

interface SlideDraft {
  pages: HastNode[][];
  id?: string;
  block?: BlockSpec;
  /** Text of the first `h2` of the slide's first page: the key of the slide/page rule. */
  h2?: string;
  /** Old reveal.js indexes of the slide's first page: `?slide=h.v`. */
  legacy: number;
  legacyV: number;
}

function isFootnotes(node: HastNode): boolean {
  return isElement(node) && node.tagName === "section" && node.properties.dataFootnotes !== undefined;
}

/** Splits at breaks matching `isSplit`, dropping the breaks and the groups `keep` rejects. */
function splitAt(
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

const isSlideBreak = (node: HastNode): boolean => isElement(node) && node.tagName === "hr" && markOf(node) === undefined;
const isPageBreak = (node: HastNode): boolean => markOf(node) === MARK_VERTICAL;
const hasContent = (group: HastNode[]): boolean => group.some(node => !isBlank(node));

function blockSpecOf(marker: Element): BlockSpec {
  const { dataTitle, dataShort, dataMinutes, dataKind, id } = marker.properties;
  return {
    title: String(dataTitle),
    short: dataShort === undefined ? undefined : String(dataShort),
    minutes: dataMinutes === undefined ? undefined : String(dataMinutes),
    kind: dataKind === undefined ? undefined : String(dataKind),
    id: typeof id === "string" ? id : undefined,
  };
}

/**
 * Reads the slides out of the flow. A `---` always starts a slide. Inside a `---` group each
 * `::vertical` child is a further page of the current slide, unless it starts a new slide:
 * it has an `h2` that differs from the slide's own `h2`, or it carries `::block` or `::slide`.
 * A child without an `h2` (only `h3`, or body text) is always a page.
 */
function readSlides(flow: HastNode[], file: DeckFile): SlideDraft[] {
  const drafts: SlideDraft[] = [];
  let pending: BlockSpec | undefined;
  let legacy = -1;

  for (const group of splitAt(flow, isSlideBreak, group => group.length > 0)) {
    let current: SlideDraft | undefined;
    let vertical = 0;

    for (const chunk of splitAt(group, isPageBreak, chunk => chunk.length > 0)) {
      const blocks = chunk.filter(node => markOf(node) === MARK_BLOCK) as Element[];
      const slides = chunk.filter(node => markOf(node) === MARK_SLIDE) as Element[];
      const rest = chunk.filter(node => !blocks.includes(node as Element) && !slides.includes(node as Element));
      if (blocks.length > 1) file.fail("a page holds two ::block directives", blocks[1], ORIGIN);
      if (slides.length > 1) file.fail("a page holds two ::slide directives", slides[1], ORIGIN);

      const spec = blocks[0] && blockSpecOf(blocks[0]);
      const twice = (): never =>
        file.fail(`::block "${spec?.title}" follows ::block "${pending?.title}" with no slide between`, blocks[0], ORIGIN);
      if (!hasContent(rest)) {
        if (slides.length) file.fail("::slide without any content in its slide", slides[0], ORIGIN);
        if (spec) {
          if (pending) twice();
          pending = spec;
        }
        continue;
      }
      if (spec && pending) twice();

      const block = spec ?? pending;
      const h2 = firstHeading(rest, 2);
      const startsSlide = !current || block || slides.length || (h2 !== undefined && h2 !== current.h2);
      if (startsSlide) {
        if (!current) legacy += 1;
        current = {
          pages: [rest],
          id: slides[0] && String(slides[0].properties.id),
          block,
          h2,
          legacy,
          legacyV: vertical,
        };
        drafts.push(current);
      } else {
        current!.pages.push(rest);
      }
      pending = undefined;
      vertical += 1;
    }
  }
  if (pending) file.fail(`::block "${pending.title}" has no slide after it`, undefined, ORIGIN);
  return drafts;
}

/** Fails on a block or slide marker that is not at the top level of a slide. */
function rejectNestedMarkers(drafts: SlideDraft[], file: DeckFile): void {
  for (const draft of drafts) {
    for (const page of draft.pages) {
      walkElements(page, node => {
        const mark = markOf(node);
        if (mark === MARK_BLOCK || mark === MARK_SLIDE) {
          file.fail(`::${mark} must stand at the top level of a slide, not inside another element`, node, ORIGIN);
        }
      });
    }
  }
}

interface Group {
  spec: BlockSpec;
  slides: SlideDraft[];
}

/**
 * Groups slides into blocks by the rules in the header. Where a block gets no title of its own
 * (slides before the first marker) it is titled by the deck title, else the deck's first `h1`,
 * else its first slide.
 */
function groupBlocks(drafts: SlideDraft[], deckTitle: string | undefined): Group[] {
  const explicit = drafts.some(draft => draft.block);
  const kickers = !explicit && drafts.some(draft => kickerOf(draft.pages[0]));
  const groups: Group[] = [];

  const heading = (draft: SlideDraft): string | undefined => {
    const node = kickers ? kickerOf(draft.pages[0]) : dividerOf(draft.pages[0]);
    return node && plainText(node);
  };

  for (const draft of drafts) {
    let spec = draft.block;
    if (!explicit) {
      const title = heading(draft);
      if (title) spec = { title, short: shortOf(title), kind: kindOf(title) };
    } else if (spec) {
      spec = { ...spec, short: spec.short ?? shortOf(spec.title) };
    }

    if (spec || !groups.length) {
      const lead = deckTitle || firstHeading(drafts.flatMap(item => item.pages.flat()), 1) || slideTitle(draft.pages, "Slides");
      groups.push({ spec: spec ?? { title: lead }, slides: [] });
    }
    groups[groups.length - 1].slides.push(draft);
  }
  return groups;
}

function ids(nodes: HastNode[]): Set<string> {
  const found = new Set<string>();
  walkElements(nodes, node => {
    if (typeof node.properties.id === "string") found.add(node.properties.id);
  });
  return found;
}

function assemble(drafts: SlideDraft[], deckTitle: string | undefined, file: DeckFile): Element[] {
  const taken = ids(drafts.flatMap(draft => draft.pages.flat()));
  const claim = (id: string, what: string): string => {
    if (taken.has(id)) file.fail(`${what} id "${id}" is already used in the document`, undefined, ORIGIN);
    taken.add(id);
    return id;
  };

  return groupBlocks(drafts, deckTitle).map(({ spec, slides }, blockIndex) => {
    const properties: Record<string, unknown> = { dataCtBlock: true, dataTitle: spec.title };
    if (spec.short) properties.dataShort = spec.short;
    if (spec.minutes) properties.dataMinutes = spec.minutes;
    if (spec.kind) properties.dataKind = spec.kind;
    if (spec.id) properties.id = claim(spec.id, "block");

    const sections = slides.map((draft, slideIndex) => {
      const ordinal = `${blockIndex + 1}-${slideIndex + 1}`;
      const id = draft.id ? claim(draft.id, "slide") : claim(`s-${ordinal}`, "slide");
      return element(
        "section",
        {
          dataCtSlide: true,
          id,
          dataTitle: slideTitle(draft.pages, `Slide ${ordinal.replace("-", ".")}`),
          dataLegacy: draft.legacy,
          dataLegacyV: draft.legacyV,
        },
        draft.pages.map(buildPage)
      );
    });
    return element("section", properties, sections);
  });
}

function frontmatterTitle(file: DeckFile): string | undefined {
  const { astro } = file.data as { astro?: { frontmatter?: { title?: unknown } } };
  const title = astro?.frontmatter?.title;
  return typeof title === "string" ? title : undefined;
}

export function rehypeDeck(options: DeckOptions = {}) {
  return (tree: HastNode, file: DeckFile): void => {
    if (options.match && !options.match(file)) return;
    const deckTitle = options.title ?? frontmatterTitle(file);

    const before: HastNode[] = [];
    const after: HastNode[] = [];
    const flow: HastNode[] = [];
    for (const node of tree.children ?? []) {
      if (node.type === "mdxjsEsm") before.push(node);
      else if (isFootnotes(node)) after.push(node);
      else flow.push(node);
    }

    const drafts = readSlides(flow, file);
    rejectNestedMarkers(drafts, file);
    const blocks = assemble(drafts, deckTitle, file);
    const deck = element("div", { dataCtDeck: true, ...(deckTitle ? { dataTitle: deckTitle } : {}) }, blocks);
    tree.children = [...before, deck, ...after];
  };
}
