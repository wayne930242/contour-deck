/**
 * The reader of `structure: "headings"`: the deck's outline is the Markdown's own.
 *
 * - A top-level `---` starts a block.
 * - A top-level `##` starts a slide. What stands before a block's first `##` is the block's first
 *   slide (a title, a `# 拆解` divider), unless it is nothing but a `####` kicker, notes,
 *   `::block`/`::slide`, and HTML comments: those open the first `##` slide.
 * - A top-level `###` starts a further page of the slide, unless it stands right under the `##`
 *   with no content between them (notes, `::block`/`::slide`, and HTML comments are not content):
 *   then both head the first page.
 * - A block is titled by the first `#` or `####` before its first `##` or `###`; the heading stays
 *   where it is. `::block{…}` anywhere at the block's top level overrides what it names.
 * - Headings inside other elements, `####` and deeper, and a `#` after the first `##` are content.
 */
import { MARK_BLOCK, MARK_SLIDE, MARK_VERTICAL, NOTES } from "../shared/markers.js";
import { NO_VERTICAL, type DeckFile } from "../shared/structure.js";
import { blockMarkOf, isRule, leadTitle, ORIGIN, splitAt, type BlockMark, type Group, type SlideDraft } from "./draft.js";
import { isBlank, isElement, markOf, plainText, type Element, type HastNode } from "./hast.js";
import { kindOf, shortOf, slideTitle } from "./titles.js";

interface BlockDraft {
  mark?: BlockMark;
  /** Text of the heading that titles the block, when it has one. */
  heading?: string;
  slides: SlideDraft[];
}

/**
 * What the current page holds so far, while the next heading still joins it instead of breaking:
 * `"opening"` is nothing or just a kicker (a `##` or `###` joins), `"title"` is the slide's `##`
 * and whatever opened with it (a `###` joins). Notes, `::block`/`::slide`, and HTML comments never count.
 */
type Bare = "opening" | "title" | undefined;

/** An HTML comment: a `comment` node (after rehype-raw), or a `raw` node of nothing but comments. */
const isComment = (node: HastNode): boolean =>
  node.type === "comment" || (node.type === "raw" && /^\s*(<!--(?:(?!-->)[\s\S])*-->\s*)+$/.test(node.value ?? ""));

/** A slide's pages without their speaker notes, which never reach the audience. */
const visibleOf = (slide: SlideDraft): HastNode[][] =>
  slide.pages.map(page => page.filter(node => !(isElement(node) && NOTES in node.properties)));

function readBlock(nodes: HastNode[], file: DeckFile): BlockDraft | undefined {
  let slide: SlideDraft = { pages: [[]] };
  const slides = [slide];
  const idMarkers = new Map<SlideDraft, Element>();
  let bare: Bare = "opening";
  let kicker = false;
  /** No `##` or `###` yet: the part of the block its title heading stands in. */
  let opening = true;
  let heading: string | undefined;
  let blockMarker: Element | undefined;
  /** The slide holds more than headings. */
  let body = false;
  /** A `::slide` written after the slide's body, with nothing after it yet. */
  let trailing: Element | undefined;

  for (const node of nodes) {
    if (!isElement(node)) {
      if (isComment(node)) slide.pages[slide.pages.length - 1].push(node);
      else if (!isBlank(node)) {
        slide.pages[slide.pages.length - 1].push(node);
        bare = trailing = undefined;
        body = true;
      }
      continue;
    }

    const mark = markOf(node);
    if (mark === MARK_VERTICAL) file.fail(NO_VERTICAL, node, ORIGIN);
    if (mark === MARK_BLOCK) {
      if (blockMarker) file.fail("a block holds two ::block directives", node, ORIGIN);
      blockMarker = node;
      continue;
    }
    if (mark === MARK_SLIDE) {
      if (idMarkers.has(slide)) file.fail("a slide holds two ::slide directives", node, ORIGIN);
      idMarkers.set(slide, node);
      slide.id = String(node.properties.id);
      trailing = body ? node : undefined;
      continue;
    }

    if (node.tagName === "h2") {
      if (bare === "opening") {
        slide.pages[0].push(node);
      } else {
        if (trailing) {
          file.fail(
            `::slide{#${slide.id}} stands between a slide's content and the next ##: write it under the heading of its own slide`,
            trailing,
            ORIGIN
          );
        }
        slide = { pages: [[node]] };
        slides.push(slide);
        body = false;
      }
      bare = "title";
      opening = false;
    } else if (node.tagName === "h3") {
      if (bare) slide.pages[slide.pages.length - 1].push(node);
      else slide.pages.push([node]);
      bare = undefined;
      opening = false;
    } else {
      slide.pages[slide.pages.length - 1].push(node);
      if (NOTES in node.properties) continue;
      if (opening && (node.tagName === "h1" || node.tagName === "h4")) heading ??= plainText(node) || undefined;
      if (bare === "opening" && node.tagName === "h4" && !kicker) kicker = true;
      else bare = undefined;
      body ||= !/^h[1-6]$/.test(node.tagName);
    }
    trailing = undefined;
  }

  // Only the opening can be left empty: every other slide starts with its `##`.
  if (!slides[0].pages[0].some(node => !isComment(node))) {
    const marker = idMarkers.get(slides[0]);
    if (marker) file.fail("::slide without any content in its slide", marker, ORIGIN);
    slides.shift();
  }
  if (!slides.length) {
    if (blockMarker) file.fail("::block stands in a block with no slide", blockMarker, ORIGIN);
    return undefined;
  }
  return { mark: blockMarker && blockMarkOf(blockMarker), heading, slides };
}

/**
 * Reads the blocks out of the flow. A block with a title of its own (`::block` title, else its
 * heading) derives its label and the 附錄 kind from it unless `::block` gives them. A block
 * without one derives nothing: in a deck of several blocks it takes its first slide's title, and
 * the only block takes the deck's title, else the deck's first `h1`, else its first slide's title.
 */
export function readHeadings(flow: HastNode[], deckTitle: string | undefined, file: DeckFile): Group[] {
  const blocks = splitAt(flow, isRule, () => true)
    .map(nodes => readBlock(nodes, file))
    .filter(block => block !== undefined);
  const drafts = blocks.flatMap(block => block.slides);

  return blocks.map(({ mark = {}, heading, slides }) => {
    const own = mark.title ?? heading;
    const spec = own
      ? { ...mark, title: own, short: mark.short ?? shortOf(own), kind: mark.kind ?? kindOf(own) }
      : {
          ...mark,
          title:
            (blocks.length > 1 && slideTitle(visibleOf(slides[0]), "")) || leadTitle(deckTitle, drafts, slides[0]),
        };
    return { spec, slides };
  });
}
