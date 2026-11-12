/** Reading time for autoplay: the blog's formula (`rehype-slides.ts`), unchanged. */

export interface Budget {
  base: number;
  perChar: number;
  min: number;
  max: number;
}

export const PAGE_MS: Budget = { base: 3000, perChar: 100, min: 3000, max: 20000 };
export const STEP_MS: Budget = { base: 1500, perChar: 100, min: 1500, max: 12000 };

/** Whole milliseconds to read `text`, whitespace not counted, rounded to 100. */
export function readingMs(text: string, budget: Budget): number {
  const chars = text.replace(/\s+/g, "").length;
  const ms = budget.base + chars * budget.perChar;
  return Math.round(Math.min(budget.max, Math.max(budget.min, ms)) / 100) * 100;
}
