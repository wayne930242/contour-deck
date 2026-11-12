import { describe, expect, it } from "vitest";
import { counts, fixture, outline, sourceSlides, toHast } from "./helpers.js";

const titles = (markdown: string, options = {}, data = {}) =>
  outline(toHast(markdown, options, data)).blocks.map(block => block.title);

describe("#### fallback rule", () => {
  const deck = `#### 一、問題\n\n## 甲\n\n---\n\n## 乙\n\n---\n\n#### 二、回答\n\n## 丙\n\n---\n\n#### 附錄 A｜補充\n\n## 丁`;

  it("starts a block at each slide that opens with a #### kicker", () => {
    const view = outline(toHast(deck));
    expect(view.blocks.map(block => [block.title, block.slides.length])).toEqual([
      ["一、問題", 2],
      ["二、回答", 1],
      ["附錄 A｜補充", 1],
    ]);
  });

  it("gives a 附錄 block data-kind=appendix and a short label", () => {
    const [one, two, appendix] = outline(toHast(deck)).blocks;
    expect([one.short, one.kind]).toEqual(["一", undefined]);
    expect([two.short, two.kind]).toEqual(["二", undefined]);
    expect([appendix.short, appendix.kind]).toEqual(["A", "appendix"]);
  });

  it("does not treat a #### that is not the first element, or a ### or #####, as a kicker", () => {
    const view = outline(toHast(`## 甲\n\n#### 不是引言\n\n---\n\n### 乙\n\n---\n\n##### 丙`));
    expect(view.blocks).toHaveLength(1);
  });

  it("puts slides before the first kicker in a block titled by the deck", () => {
    expect(titles(`## 序\n\n---\n\n#### 一、問題\n\n## 甲`, { title: "全場" })).toEqual(["全場", "一、問題"]);
  });

  it("does not use a short label longer than 3 characters", () => {
    const [block] = outline(toHast(`#### 第十二章、長標題\n\n## 甲`)).blocks;
    expect(block.short).toBeUndefined();
  });
});

describe("no markers", () => {
  it("is one block titled by the deck title, else by the first slide", () => {
    const markdown = `## 甲\n\n---\n\n## 乙`;
    expect(titles(markdown, { title: "全場" })).toEqual(["全場"]);
    expect(titles(markdown, {}, { astro: { frontmatter: { title: "Frontmatter title" } } })).toEqual(["Frontmatter title"]);
    expect(titles(markdown)).toEqual(["甲"]);
    expect(counts(outline(toHast(markdown)))).toEqual({ blocks: 1, slides: 2, pages: 2 });
  });

  it("is one block for slide-templates-demo: 25 slides, 25 pages", () => {
    const source = fixture("slide-templates-demo.md");
    const view = outline(toHast(source, { title: "簡報模板展示" }));
    // 22 horizontal slides; 第一章 splits into three slides, 關鍵數字 into two.
    expect(counts(view)).toEqual({ blocks: 1, slides: 25, pages: 25 });
    expect(view.blocks[0].slides.map(slide => [slide.legacy, slide.legacyV, slide.pages.length])).toEqual(
      sourceSlides(source).map(slide => [slide.h, slide.v, slide.pages])
    );
    expect(view.blocks[0]).toMatchObject({ title: "簡報模板展示", kind: undefined, short: undefined });
    expect(view.blocks[0].slides.map(slide => slide.id).slice(0, 3)).toEqual(["s-1-1", "s-1-2", "s-1-3"]);
  });
});

describe("::block", () => {
  const deck = [
    `::block{title="一、問題" minutes=5}`,
    `## 甲`,
    `---`,
    `## 乙`,
    `---`,
    `::block{title="附錄 A｜補充" kind=appendix short=補}`,
    `## 丙`,
  ].join("\n\n");

  it("starts a block with its title, minutes, kind and short", () => {
    const view = outline(toHast(deck));
    expect(view.blocks.map(block => [block.title, block.short, block.minutes, block.kind, block.slides.length])).toEqual([
      ["一、問題", "一", "5", undefined, 2],
      ["附錄 A｜補充", "補", undefined, "appendix", 1],
    ]);
  });

  it("keeps fractional minutes", () => {
    expect(outline(toHast(`::block{title="甲" minutes=1.5}\n\n## 甲`)).blocks[0].minutes).toBe("1.5");
  });

  it("takes a marker written alone between slides for the next slide", () => {
    const view = outline(toHast(`## 甲\n\n---\n\n::block{title="第二部分"}\n\n---\n\n## 乙`, { title: "全場" }));
    expect(view.blocks.map(block => [block.title, block.slides.map(slide => slide.title)])).toEqual([
      ["全場", ["甲"]],
      ["第二部分", ["乙"]],
    ]);
    expect(counts(view).slides).toBe(2);
  });

  it("turns the #### fallback off: a deck with ::block uses only ::block", () => {
    const view = outline(toHast(`::block{title="甲"}\n\n#### 一、問題\n\n## 甲\n\n---\n\n#### 二、回答\n\n## 乙`));
    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0].slides).toHaveLength(2);
  });

  it("does not count a marker-only slide in the legacy index", () => {
    const view = outline(toHast(`## 甲\n\n---\n\n::block{title="二"}\n\n---\n\n## 乙`));
    expect(view.blocks.flatMap(block => block.slides).map(slide => slide.legacy)).toEqual([0, 1]);
  });

  it("carries a block id", () => {
    expect(outline(toHast(`::block{title="甲" #part-one}\n\n## 甲`)).blocks[0].id).toBe("part-one");
  });

  it.each([
    ["a missing title", `::block\n\n## 甲`, /needs a title/],
    ["minutes that are not a number", `::block{title="甲" minutes=abc}\n\n## 甲`, /positive number/],
    ["zero minutes", `::block{title="甲" minutes=0}\n\n## 甲`, /positive number/],
    ["a kind with a space", `::block{title="甲" kind="a b"}\n\n## 甲`, /one token/],
    ["a short label over 3 characters", `::block{title="甲" short=abcd}\n\n## 甲`, /1 to 3/],
    ["an unknown attribute", `::block{title="甲" minute=5}\n\n## 甲`, /no attribute "minute"/],
    ["the container form", `:::block{title="甲"}\n## 甲\n:::`, /leaf directive/],
    ["two blocks with no slide between", `::block{title="甲"}\n\n---\n\n::block{title="乙"}\n\n---\n\n## 丙`, /no slide between/],
    ["a block with no slide after it", `## 甲\n\n---\n\n::block{title="乙"}`, /no slide after/],
    ["a block inside another element", `:::grid\n::block{title="甲"}\n:::\n\n## 乙`, /top level/],
  ])("fails fast on %s", (_name, markdown, message) => {
    expect(() => toHast(markdown)).toThrow(message);
  });
});

describe("h1 divider fallback (a deck with no #### kicker)", () => {
  const deck = [
    `# 序章\n\n正文`,
    `# :icon{name="Mountain"} 拆解\n\n:::summary\n講稿\n:::`,
    `## 甲`,
    `# 後勤`,
    `## 乙`,
  ].join("\n\n---\n\n");

  it("starts a block at a slide whose first page is just an h1, titled by it with icons stripped", () => {
    const view = outline(toHast(deck, { title: "全場" }));
    expect(view.blocks.map(block => [block.title, block.slides.map(slide => slide.title)])).toEqual([
      ["全場", ["序章"]],
      ["拆解", ["拆解", "甲"]],
      ["後勤", ["後勤", "乙"]],
    ]);
  });

  it("titles the opening block by the deck title, else the deck's first h1", () => {
    expect(titles(deck)[0]).toBe("序章");
  });

  it("does not split a deck whose h1 slides have content: it stays one block", () => {
    expect(titles(`# 甲\n\n正文\n\n---\n\n# 乙\n\n正文\n\n---\n\n# 丙\n\n::vertical\n\n## 丁`, { title: "全場" }).length).toBe(2);
    expect(titles(`# 甲\n\n正文\n\n---\n\n# 乙\n\n正文`, { title: "全場" })).toEqual(["全場"]);
  });

  it("marks a 附錄 divider as an appendix", () => {
    const [, appendix] = outline(toHast(`## 序\n\n---\n\n# 附錄 A｜補充\n\n---\n\n## 甲`)).blocks;
    expect([appendix.title, appendix.short, appendix.kind]).toEqual(["附錄 A｜補充", "A", "appendix"]);
  });

  it("yields to #### kickers and to ::block", () => {
    expect(titles(`#### 一、問題\n\n## 甲\n\n---\n\n# 拆解\n\n---\n\n## 乙`)).toEqual(["一、問題"]);
    expect(titles(`::block{title="整段"}\n\n## 甲\n\n---\n\n# 拆解\n\n---\n\n## 乙`)).toEqual(["整段"]);
  });
});

describe("slide or page inside a stack", () => {
  const slides = (markdown: string) =>
    outline(toHast(markdown)).blocks.flatMap(block => block.slides).map(slide => [slide.title, slide.pages.length, slide.legacy, slide.legacyV]);

  it("keeps children with the same ## as pages and starts a slide at a different ##", () => {
    expect(slides(`## 甲\n\n::vertical\n\n## 甲\n\n::vertical\n\n## 乙\n\n::vertical\n\n## 乙`)).toEqual([
      ["甲", 2, 0, 0],
      ["乙", 2, 0, 2],
    ]);
  });

  it("keeps a child without an ## as a page, h3-only included", () => {
    expect(slides(`## 甲\n\n::vertical\n\n正文\n\n::vertical\n\n### 小節\n\n::vertical\n\n## 乙`)).toEqual([
      ["甲", 3, 0, 0],
      ["乙", 1, 0, 3],
    ]);
  });

  it("starts a slide at the first ## after a first child that has none", () => {
    expect(slides(`# 拆解\n\n::vertical\n\n## 甲\n\n::vertical\n\n正文`)).toEqual([
      ["拆解", 1, 0, 0],
      ["甲", 2, 0, 1],
    ]);
  });

  it("always starts a new slide at ---, even with the same ##", () => {
    expect(slides(`## 甲\n\n---\n\n## 甲`)).toEqual([
      ["甲", 1, 0, 0],
      ["甲", 1, 1, 0],
    ]);
  });

  it("starts a slide at a ::block or ::slide inside a stack", () => {
    const view = outline(toHast(`## 甲\n\n::vertical\n\n::block{title="第二"}\n\n正文\n\n::vertical\n\n::slide{#own}\n\n更多`));
    expect(view.blocks.map(block => [block.title, block.slides.map(slide => slide.id)])).toEqual([
      ["甲", ["s-1-1"]],
      ["第二", ["s-2-1", "own"]],
    ]);
    expect(view.blocks[1].slides.map(slide => [slide.legacy, slide.legacyV])).toEqual([[0, 1], [0, 2]]);
  });
});
