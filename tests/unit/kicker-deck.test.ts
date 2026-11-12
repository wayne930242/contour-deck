import { describe, expect, it } from "vitest";
import { counts, fixture, outline, sourceSlides, toHast, toHtml } from "./helpers.js";

const source = fixture("kicker-deck.md");

/**
 * A self-written deck with a #### kicker on the first slide of every block: the rules of the
 * #### fallback, 附錄 blocks, stacks that share a ##, the old h/v index, steps, and notes, on one fixture.
 */
describe("kicker deck", () => {
  const view = outline(toHast(source, { title: "輪廓優先的簡報" }));
  const slides = view.blocks.flatMap(block => block.slides);

  it("has 5 blocks, 11 slides and 13 pages, and agrees with a reading of the source lines", () => {
    expect(counts(view)).toEqual({ blocks: 5, slides: 11, pages: 13 });
    expect(view.blocks.map(block => block.slides.length)).toEqual([1, 6, 1, 2, 1]);
    const expected = sourceSlides(source);
    expect(expected).toHaveLength(11);
    expect(slides.map(slide => [slide.legacy, slide.legacyV, slide.pages.length])).toEqual(
      expected.map(slide => [slide.h, slide.v, slide.pages])
    );
  });

  it("starts a block at every #### kicker, titled by it", () => {
    expect(view.blocks.map(block => block.title)).toEqual([
      "示範｜十分鐘的演講",
      "一、規則",
      "二、收尾",
      "附錄 A｜名詞（書面）",
      "附錄 B｜格式（書面）",
    ]);
  });

  it("labels blocks and marks the 附錄 titles as appendices", () => {
    expect(view.blocks.map(block => block.short)).toEqual([undefined, "一", "二", "A", "B"]);
    expect(view.blocks.map(block => block.kind)).toEqual([undefined, undefined, undefined, "appendix", "appendix"]);
    expect(view.blocks.every(block => block.minutes === undefined)).toBe(true);
  });

  it("keeps children with the same ## as pages of one slide, and a different ## as a new slide", () => {
    const [, rules, , appendix] = view.blocks;
    // 數字範例 repeats its ##: one slide, two pages.
    expect(rules.slides[3]).toMatchObject({ title: "數字範例", legacy: 4, legacyV: 0 });
    expect(rules.slides[3].pages).toHaveLength(2);
    // 從步驟到頁 has its own ##: a slide of its own, though it follows 步驟表格 in the same stack.
    expect(rules.slides.slice(4).map(slide => [slide.title, slide.pages.length])).toEqual([
      ["步驟表格", 1],
      ["從步驟到頁", 1],
    ]);
    expect(appendix.slides[1]).toMatchObject({ title: "2. 投影片與頁", legacy: 8 });
    expect(appendix.slides[1].pages).toHaveLength(2);
  });

  it("maps the old h and v: a split stack shares h, and v counts the pages before it", () => {
    const [, rules] = view.blocks;
    expect(rules.slides[4]).toMatchObject({ legacy: 5, legacyV: 0 });
    expect(rules.slides[5]).toMatchObject({ legacy: 5, legacyV: 1 });
    expect(new Set(slides.map(slide => slide.id)).size).toBe(slides.length);
  });

  it("numbers slides by block and slide, and titles a slide by its own heading, not by the kicker", () => {
    expect(slides.map(slide => slide.id)).toEqual([
      "s-1-1", "s-2-1", "s-2-2", "s-2-3", "s-2-4", "s-2-5", "s-2-6", "s-3-1", "s-4-1", "s-4-2", "s-5-1",
    ]);
    expect(view.blocks[1].slides[0]).toMatchObject({ id: "s-2-1", title: "引言標記開出區塊" });
    expect(view.blocks[3].slides[0]).toMatchObject({ id: "s-4-1", title: "1. 區塊" });
    // The first slide has an h1: the h1, not the kicker, is its title.
    expect(slides[0].title).toBe("輪廓優先的簡報");
  });

  it("attaches each summary to the page that holds it", () => {
    const pages = slides.flatMap(slide => slide.pages);
    expect(pages.flatMap(page => page.notes)).toHaveLength(9);
    expect(slides[0].pages[0].notes[0]).toMatch(/^〔全場約 10 分鐘〕/);
    expect(view.blocks[1].slides[0].pages[0].notes[0]).toMatch(/^〔一、約 3 分鐘〕/);
    // 數字範例 is a two-page slide: a note sits before ::vertical, another after it.
    const twoPages = view.blocks[1].slides[3].pages;
    expect(twoPages.map(page => page.notes.length)).toEqual([1, 1]);
    expect(twoPages[0].notes[0]).not.toBe(twoPages[1].notes[0]);
    // The appendix has no notes at all.
    const appendixPages = view.blocks.slice(3).flatMap(block => block.slides).flatMap(slide => slide.pages);
    expect(appendixPages.flatMap(page => page.notes)).toEqual([]);
    expect(view.blocks[1].slides[0].pages[0].content).toEqual(["h4", "h2", "p"]);
  });

  it("marks :::build children as steps, one per list item or table row", () => {
    const withSteps = slides.flatMap(slide => slide.pages).filter(page => page.steps.length);
    expect(withSteps.map(page => page.steps.length)).toEqual([3, 2]);
    const list = view.blocks[1].slides[1].pages[0];
    expect(list.steps[0]).toBe("清單的每一個項目是一步。");
    expect(list.stepMs).toEqual(list.steps.map(() => expect.any(Number)));
    expect(view.blocks[1].slides[4].pages[0].steps.map(step => step.replace(/\s+/g, " "))).toEqual(["清單 一個項目", "表格 一列"]);
  });

  it("leaves no hand-off marker in the HTML and writes the old index", () => {
    const html = toHtml(source, { title: "輪廓優先的簡報" });
    expect(html).not.toContain("data-ct-mark");
    expect(html).not.toContain("slide-build");
    expect(html.startsWith('<div data-ct-deck data-title="輪廓優先的簡報">')).toBe(true);
    expect(html.match(/<section data-ct-slide /g)).toHaveLength(11);
    expect(html.match(/<section data-ct-page/g)).toHaveLength(13);
    expect(html.match(/<aside data-ct-notes/g)).toHaveLength(9);
    expect(html).toContain('id="s-2-6" data-title="從步驟到頁" data-legacy="5" data-legacy-v="1"');
    expect(html).toContain('data-kind="appendix"');
  });
});
