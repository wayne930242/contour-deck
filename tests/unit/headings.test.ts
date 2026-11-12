import { describe, expect, it } from "vitest";
import type { DeckOptions } from "../../src/rehype/index.js";
import { structureOf } from "../../src/shared/structure.js";
import { counts, fixture, outline, toHast, toHtml } from "./helpers.js";

const view = (markdown: string, options: DeckOptions = {}, data = {}) =>
  outline(toHast(markdown, { structure: "headings", ...options }, data));

const slidesOf = (markdown: string, options: DeckOptions = {}) => view(markdown, options).blocks.flatMap(block => block.slides);

/** Three blocks: a title slide, a block with a kicker and a three-page slide, an appendix. */
const deck = [
  `# 輪廓優先的簡報`,
  `副標`,
  `:::summary\n開場講稿\n:::`,
  `---`,
  `#### 一、規則`,
  `## 引言`,
  `正文`,
  `## 兩種步驟`,
  `:::build\n- 甲\n- 乙\n:::`,
  `:::summary\n步驟講稿\n:::`,
  `### 第二頁`,
  `更多`,
  `:::summary\n第二頁講稿\n:::`,
  `### 第三頁`,
  `結尾`,
  `---`,
  `#### 附錄 A｜名詞`,
  `## 區塊`,
  `定義`,
].join("\n\n");

describe("structure: headings", () => {
  it("starts a block at ---, a slide at ##, and a page at ###", () => {
    const blocks = view(deck).blocks;
    expect(counts(view(deck))).toEqual({ blocks: 3, slides: 4, pages: 6 });
    expect(blocks.map(block => block.slides.map(slide => [slide.title, slide.pages.length]))).toEqual([
      [["輪廓優先的簡報", 1]],
      [["引言", 1], ["兩種步驟", 3]],
      [["區塊", 1]],
    ]);
    expect(blocks.flatMap(block => block.slides).map(slide => slide.id)).toEqual(["s-1-1", "s-2-1", "s-2-2", "s-3-1"]);
  });

  it("titles a block by the first # or #### of its opening, and keeps that heading in the slide", () => {
    const blocks = view(deck, { title: "全場" }).blocks;
    expect(blocks.map(block => block.title)).toEqual(["輪廓優先的簡報", "一、規則", "附錄 A｜名詞"]);
    expect(blocks.map(block => block.slides[0].pages[0].content)).toEqual([
      ["h1", "p"],
      ["h4", "h2", "p"],
      ["h4", "h2", "p"],
    ]);
    // Whichever of the two comes first; a #### under a ### is a heading of that page, not the block's.
    const title = (markdown: string) => view(markdown, { title: "全場" }).blocks[0].title;
    expect(title(`#### 示範｜十分鐘\n\n# 輪廓優先的簡報\n\n## 甲`)).toBe("示範｜十分鐘");
    expect(title(`# 輪廓優先的簡報\n\n#### 副標\n\n## 甲`)).toBe("輪廓優先的簡報");
    expect(title(`### 一\n\n#### 註\n\n## 甲`)).toBe("全場");
  });

  it("labels the blocks and marks a 附錄 title as an appendix", () => {
    expect(view(deck).blocks.map(block => [block.short, block.kind])).toEqual([
      [undefined, undefined],
      ["一", undefined],
      ["A", "appendix"],
    ]);
  });

  it("titles a block with neither heading by the deck title, without a label or a kind", () => {
    const blocks = view(`## 甲\n\n---\n\n## 乙\n\n#### 頁內小標`, { title: "附錄的寫法" }).blocks;
    expect(blocks.map(block => [block.title, block.short, block.kind])).toEqual([
      ["附錄的寫法", undefined, undefined],
      ["附錄的寫法", undefined, undefined],
    ]);
    // Without a deck title: the deck's first h1, else the block's first slide, as in the default mode.
    expect(view(`## 甲\n\n---\n\n## 乙`).blocks.map(block => block.title)).toEqual(["甲", "乙"]);
  });

  it("makes the content before the first ## the block's first slide, titled by the slide title rule", () => {
    const titles = (markdown: string) => slidesOf(markdown).map(slide => [slide.title, slide.pages[0].content]);
    expect(titles(`# 拆解\n\n## 甲`)).toEqual([["拆解", ["h1"]], ["甲", ["h2"]]]);
    expect(titles(`只有一段文字\n\n## 甲`)).toEqual([["只有一段文字", ["p"]], ["甲", ["h2"]]]);
    expect(titles(`#### 引言\n\n說明\n\n## 甲`)).toEqual([["引言", ["h4", "p"]], ["甲", ["h2"]]]);
  });

  it("keeps an opening that is only a kicker, notes, or directives with the first ## slide", () => {
    const [block] = view(`::block{minutes=5}\n\n::slide{#first}\n\n#### 一、問題\n\n:::summary\n講稿\n:::\n\n## 甲\n\n正文`).blocks;
    expect([block.title, block.minutes, block.slides.length]).toEqual(["一、問題", "5", 1]);
    expect(block.slides[0]).toMatchObject({ id: "first", title: "甲" });
    expect(block.slides[0].pages).toMatchObject([{ content: ["h4", "h2", "p"], notes: ["講稿"] }]);
  });

  it("puts a ### right under the ## on the first page, and starts a page at every later ###", () => {
    const pages = (markdown: string) => slidesOf(markdown).map(slide => slide.pages.map(page => page.content));
    expect(pages(`## 甲\n\n### 一\n\n正文\n\n### 二\n\n正文`)).toEqual([[["h2", "h3", "p"], ["h3", "p"]]]);
    expect(pages(`## 甲\n\n前言\n\n### 一\n\n### 二`)).toEqual([[["h2", "p"], ["h3"], ["h3"]]]);
    // A slide never gets an empty first page: notes between the two headings do not count as content.
    expect(pages(`## 甲\n\n:::summary\n講稿\n:::\n\n### 一\n\n正文`)).toEqual([[["h2", "h3", "p"]]]);
  });

  it("reads ### before any ## as pages of the block's first slide", () => {
    const [slide, next] = slidesOf(`### 一\n\n正文\n\n### 二\n\n## 甲`);
    expect([slide.title, slide.pages.map(page => page.content)]).toEqual(["一", [["h3", "p"], ["h3"]]]);
    expect(next.title).toBe("甲");
    expect(slidesOf(`# 封面\n\n### 第二頁`)[0].pages.map(page => page.content)).toEqual([["h1"], ["h3"]]);
  });

  it("treats #### and deeper, and a # after the first ##, as page content", () => {
    const blocks = view(`## 甲\n\n#### 小標\n\n##### 更小\n\n# 大字\n\n## 乙`, { title: "全場" }).blocks;
    expect(blocks.map(block => block.title)).toEqual(["全場"]);
    expect(blocks[0].slides.map(slide => slide.pages.map(page => page.content))).toEqual([[["h2", "h4", "h5", "h1"]], [["h2"]]]);
  });

  it("reads only top-level headings and ---", () => {
    const markdown = `## 甲\n\n> ## 引文裡的標題\n>\n> ---\n\n:::grid\n### 格子裡的標題\n:::`;
    expect(counts(view(markdown))).toEqual({ blocks: 1, slides: 1, pages: 1 });
  });

  it("keeps :::build steps and :::summary notes on the page they were written on", () => {
    const [, rules] = view(deck).blocks;
    expect(rules.slides[1].pages.map(page => [page.steps, page.notes])).toEqual([
      [["甲", "乙"], ["步驟講稿"]],
      [[], ["第二頁講稿"]],
      [[], []],
    ]);
    expect(rules.slides[1].pages[0].stepMs).toEqual([1600, 1600]);
    expect(rules.slides[1].pages.map(page => page.ms)).toEqual([3400, 3500, 3500]);
    expect(view(deck).blocks[0].slides[0].pages[0].notes).toEqual(["開場講稿"]);
  });

  it("lets ::block override the title, label, minutes, kind and id of the block it stands in", () => {
    const markdown = [
      `::block{minutes=5}\n\n#### 一、問題\n\n## 甲`,
      `::block{title="附錄 B｜格式" short=格 #fmt}\n\n#### 被蓋掉的引言\n\n## 乙`,
      `## 丙\n\n::block{kind=appendix minutes=2}`,
      `::block{kind=main}\n\n#### 附錄不是附錄\n\n## 丁`,
    ].join("\n\n---\n\n");
    expect(
      view(markdown, { title: "全場" }).blocks.map(block => [block.title, block.short, block.minutes, block.kind, block.id])
    ).toEqual([
      ["一、問題", "一", "5", undefined, undefined],
      ["附錄 B｜格式", "格", undefined, "appendix", "fmt"],
      ["全場", undefined, "2", "appendix", undefined],
      ["附錄不是附錄", undefined, undefined, "main", undefined],
    ]);
  });

  it("does not start a block at ::block: only --- does", () => {
    const blocks = view(`## 甲\n\n::block{minutes=3}\n\n## 乙`).blocks;
    expect(blocks.map(block => [block.minutes, block.slides.length])).toEqual([["3", 2]]);
    expect(blocks[0].slides.map(slide => slide.pages.map(page => page.content))).toEqual([[["h2"]], [["h2"]]]);
  });

  it("gives ::slide{#id} to the slide it stands in", () => {
    const slides = slidesOf(`# 封面\n\n::slide{#cover}\n\n## 甲\n\n## 乙\n\n::slide{#second}\n\n正文\n\n### 第二頁\n\n## 丙\n\n正文\n\n### 第二頁\n\n::slide{#third}`);
    expect(slides.map(slide => [slide.id, slide.pages.length])).toEqual([["cover", 1], ["s-1-2", 1], ["second", 2], ["third", 2]]);
    // Under a heading-only slide it is that slide's, though a ## follows.
    expect(slidesOf(`## 甲\n\n### 一\n\n::slide{#a}\n\n## 乙`).map(slide => slide.id)).toEqual(["a", "s-1-2"]);
  });

  it("writes no data-legacy", () => {
    expect(slidesOf(deck).map(slide => [slide.legacy, slide.legacyV])).toEqual(Array(4).fill([undefined, undefined]));
    expect(toHtml(deck, { structure: "headings" })).not.toContain("data-legacy");
  });

  it("skips a --- group without content", () => {
    expect(view(`## 甲\n\n---\n\n---\n\n## 乙\n\n---`, { title: "全場" }).blocks.map(block => block.slides.length)).toEqual([1, 1]);
  });

  it("builds the same deck as the default mode from the same content", () => {
    const slides = `#### 一、規則\n\n## 甲\n\n正文\n\n::vertical\n\n### 第二頁\n\n更多\n\n---\n\n## 乙\n\n:::build\n- 一\n- 二\n:::\n\n---\n\n#### 附錄 A｜名詞\n\n## 丙\n\n:::summary\n講稿\n:::`;
    const headings = `#### 一、規則\n\n## 甲\n\n正文\n\n### 第二頁\n\n更多\n\n## 乙\n\n:::build\n- 一\n- 二\n:::\n\n---\n\n#### 附錄 A｜名詞\n\n## 丙\n\n:::summary\n講稿\n:::`;
    const withoutLegacy = (html: string) => html.replace(/ data-legacy(-v)?="\d+"/g, "");
    expect(toHtml(headings, { structure: "headings" })).toBe(withoutLegacy(toHtml(slides)));
    expect(counts(view(headings))).toEqual({ blocks: 2, slides: 3, pages: 4 });
  });

  it.each([
    ["::vertical", `## 甲\n\n::vertical\n\n正文`, /::vertical .*"headings".* ### heading/],
    ["::vertical inside another element", `## 甲\n\n:::grid\n::vertical\n:::`, /::vertical .* ### heading/],
    ["two ::block in one block", `::block{minutes=5}\n\n## 甲\n\n::block{minutes=3}`, /two ::block/],
    ["a ::block in a block without content", `## 甲\n\n---\n\n::block{minutes=5}`, /::block .*no slide/],
    ["an empty ::block title", `::block{title=" "}\n\n## 甲`, /title is empty/],
    ["two ::slide in one slide", `## 甲\n\n::slide{#a}\n\n### 第二頁\n\n::slide{#b}`, /two ::slide/],
    ["a ::slide without content", `## 甲\n\n---\n\n::slide{#a}`, /::slide without any content/],
    ["a ::slide between a slide's content and the next ##", `## 甲\n\n正文\n\n::slide{#yi}\n\n## 乙`, /::slide\{#yi\} .*under the heading/],
    ["a ::block inside another element", `## 甲\n\n:::grid\n::block{minutes=5}\n:::`, /top level/],
    ["a ::block with an unknown attribute", `::block{minute=5}\n\n## 甲`, /no attribute "minute"/],
  ])("fails fast on %s", (_name, markdown, message) => {
    expect(() => view(markdown)).toThrow(message);
  });
});

describe("structure option", () => {
  const frontmatter = (structure?: unknown) => ({ astro: { frontmatter: { slideOptions: { structure } } } });
  const fromFile: DeckOptions["structure"] = file =>
    (file.data as ReturnType<typeof frontmatter>).astro?.frontmatter.slideOptions.structure as never;
  const markdown = `::block{minutes=5}\n\n## 甲\n\n## 乙\n\n正文\n\n### 第二頁`;

  it("is slides by default: ## and ### split nothing, and ::block needs its title", () => {
    expect(counts(outline(toHast(`## 甲\n\n## 乙\n\n### 第二頁`)))).toEqual({ blocks: 1, slides: 1, pages: 1 });
    expect(() => toHast(markdown)).toThrow(/needs a title/);
    expect(() => toHast(markdown, { structure: "slides" })).toThrow(/needs a title/);
  });

  it("leaves the default output as it was when slides is written out", () => {
    const source = fixture("kicker-deck.md");
    const title = "輪廓優先的簡報";
    expect(toHtml(source, { title, structure: "slides" })).toBe(toHtml(source, { title }));
    expect(`${toHtml(source, { title, structure: () => undefined })}\n`).toBe(fixture("kicker.html"));
  });

  it("takes a function of the file, read by both plugins", () => {
    const options = { structure: fromFile };
    // remark accepts the title-less ::block and rehype splits at ## and ###: both saw "headings".
    expect(counts(outline(toHast(markdown, options, frontmatter("headings"))))).toEqual({ blocks: 1, slides: 2, pages: 3 });
    expect(() => toHast(markdown, options, frontmatter("slides"))).toThrow(/needs a title/);
    expect(() => toHast(markdown, options, frontmatter())).toThrow(/needs a title/);
    expect(() => toHast(markdown, options, {})).toThrow(/needs a title/);
  });

  it("fails on a value that is neither, in each plugin", () => {
    const message = /structure must be "slides" or "headings", got "heading"/;
    expect(() => toHast(`## 甲`, { structure: fromFile }, frontmatter("heading"))).toThrow(message);
    expect(() => toHast(`## 甲`, { structure: fromFile }, frontmatter("heading"), {})).toThrow(message);
    expect(() => toHast(`## 甲`, {}, {}, { structure: "heading" as never })).toThrow(message);
  });

  it("fails when the two plugins were given different structures", () => {
    // rehype alone in headings mode meets the page break remark still wrote.
    expect(() => toHast(`## 甲\n\n::vertical\n\n正文`, { structure: "headings" }, {}, {})).toThrow(/::vertical .* ### heading/);
    // remark alone in headings mode lets a title-less ::block through to a rehype that needs the title.
    expect(() => toHast(markdown, {}, {}, { structure: "headings" })).toThrow(/same structure/);
  });

  it("resolves through structureOf", () => {
    const file = { data: frontmatter("headings"), fail: (reason: string): never => { throw new Error(reason); } };
    expect(structureOf(undefined, file, "test")).toBe("slides");
    expect(structureOf("headings", file, "test")).toBe("headings");
    expect(structureOf(fromFile, file, "test")).toBe("headings");
    expect(structureOf(() => null, file, "test")).toBe("slides");
    expect(() => structureOf(() => 3 as never, file, "test")).toThrow(/got 3/);
  });
});
