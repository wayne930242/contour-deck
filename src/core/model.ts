/** The outline tree, read once from the contract HTML (docs/CONTRACT.md). */

export interface PageNode {
  el: HTMLElement;
  steps: HTMLElement[];
  notes: HTMLElement[];
}

export interface SlideNode {
  el: HTMLElement;
  title: string;
  pages: PageNode[];
}

export interface BlockNode {
  el: HTMLElement;
  title: string;
  short: string;
  kind: string;
  minutes: number;
  slides: SlideNode[];
}

/** A position with 0-based indexes. The public API and the URL use 1-based ordinals. */
export interface Pos {
  b: number;
  s: number;
  p: number;
}

const childrenWith = (el: Element, attribute: string) =>
  Array.from(el.children).filter((child): child is HTMLElement => child.hasAttribute(attribute));

function need<T>(list: T[], what: string): T[] {
  if (!list.length) throw new Error(`contour-deck: ${what} (see docs/CONTRACT.md)`);
  return list;
}

export function readModel(root: HTMLElement, deckTitle: string): BlockNode[] {
  return need(childrenWith(root, "data-ct-block"), "the deck has no [data-ct-block] child").map((el, b) => ({
    el,
    title: el.dataset.title || deckTitle,
    short: el.dataset.short || String(b + 1),
    kind: el.dataset.kind || "",
    minutes: Number(el.dataset.minutes) || 0,
    slides: need(childrenWith(el, "data-ct-slide"), `block ${b + 1} has no [data-ct-slide] child`).map((slide, s) => ({
      el: slide,
      title: slide.dataset.title || "",
      pages: need(childrenWith(slide, "data-ct-page"), `slide ${b + 1}.${s + 1} has no [data-ct-page] child`).map(page => ({
        el: page,
        steps: Array.from(page.querySelectorAll<HTMLElement>("[data-ct-step]")),
        notes: childrenWith(page, "data-ct-notes"),
      })),
    })),
  }));
}

/** `"4"`, `"4.4"`, or `"4.4.2"` (1-based) to a position; `null` when the text is not numeric. */
export function parseAt(at: string): Pos | null {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(at);
  if (!match) return null;
  return { b: Number(match[1]) - 1, s: Number(match[2] ?? 1) - 1, p: Number(match[3] ?? 1) - 1 };
}

export const formatAt = ({ b, s, p }: Pos) => `${b + 1}.${s + 1}.${p + 1}`;

/** A position that exists in `blocks`, or `null`: the block and slide must exist, the page is clamped. */
export function fitPos(blocks: { slides: { pages: unknown[] }[] }[], pos: Pos): Pos | null {
  const slide = blocks[pos.b]?.slides[pos.s];
  if (!slide || pos.p < 0) return null;
  return { b: pos.b, s: pos.s, p: Math.min(pos.p, slide.pages.length - 1) };
}

/** The position of the block, slide, or page that is, or contains, `target`. */
export function posOf(blocks: BlockNode[], target: Element): Pos | null {
  for (const [b, block] of blocks.entries()) {
    if (!block.el.contains(target)) continue;
    const s = Math.max(0, block.slides.findIndex(slide => slide.el.contains(target)));
    const p = Math.max(0, block.slides[s].pages.findIndex(page => page.el.contains(target)));
    return { b, s, p };
  }
  return null;
}
