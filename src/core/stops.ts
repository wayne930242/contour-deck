/** Where a vertical step may stop inside one slide. Pure geometry, no DOM. */

export interface Box {
  top: number;
  height: number;
}

/** A page counts as taller than the viewport only past this slack, in pixels. */
const SLACK = 8;

/** A tall page is walked in steps of this share of the viewport, so the last lines of one screen open the next. */
const STEP = 0.85;
/** An inner stop closer than this share of the viewport to the page's end is dropped. */
const MIN_LAST = 0.2;

/**
 * Every page top is a stop. A page taller than the viewport adds stops inside it and one flush with its bottom,
 * so a step first walks down the page and only then reaches the next one.
 */
export function pageStops(pages: Box[], viewport: number): number[] {
  const stops: number[] = [];
  for (const page of pages) {
    stops.push(page.top);
    if (!isTall(page, viewport)) continue;
    const end = page.top + page.height - viewport;
    for (let y = page.top + viewport * STEP; y < end - viewport * MIN_LAST; y += viewport * STEP) stops.push(Math.round(y));
    stops.push(end);
  }
  return stops;
}

/** The first stop past `y` in the direction of travel, or `undefined` at the end. */
export function nextStop(stops: number[], y: number, direction: 1 | -1): number | undefined {
  return direction > 0 ? stops.find(stop => stop > y + SLACK) : stops.findLast(stop => stop < y - SLACK);
}

/** The page under the reading line, 35% down the viewport. */
export function pageIndexAt(pages: Box[], y: number, viewport: number): number {
  const line = y + viewport * 0.35;
  return Math.max(0, pages.findLastIndex(page => page.top <= line));
}

/** How much of a tall page has been read, 0 to 1; 1 for a page that fits. */
export function pageProgress(page: Box, y: number, viewport: number): number {
  if (page.height - viewport <= SLACK) return 1;
  return Math.min(1, Math.max(0, (y - page.top + viewport) / page.height));
}

export const isTall = (page: Box, viewport: number) => page.height > viewport + SLACK;
