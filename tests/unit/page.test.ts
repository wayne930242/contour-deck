import { describe, expect, it } from "vitest";
import { unified } from "unified";
import { VFile } from "vfile";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { rehypeDeck } from "../../src/rehype/index.js";
import { remarkDeck } from "../../src/remark/index.js";
import { findAll, isEl, outline, toHast, toHtml, type Hast } from "./helpers.js";

const pages = (markdown: string) => outline(toHast(markdown)).blocks.flatMap(block => block.slides).flatMap(slide => slide.pages);

describe("steps", () => {
  it("marks list items, with the blog's fragment reading time", () => {
    const [page] = pages(`## 標題\n\n:::build\n- 一二三四五\n- 甲\n:::`);
    expect(page.steps).toEqual(["一二三四五", "甲"]);
    // 1500 + 100 per character, rounded to 100, at least 1500.
    expect(page.stepMs).toEqual([2000, 1600]);
  });

  it("marks body rows of a table and skips the header", () => {
    const [page] = pages(`:::build\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n:::`);
    expect(page.steps.map(row => row.replace(/\s+/g, " "))).toEqual(["1 2", "3 4"]);
  });

  it("marks other blocks as one step each", () => {
    const [page] = pages(`:::build\n第一段\n\n第二段\n\n> 引文\n:::`);
    expect(page.steps).toEqual(["第一段", "第二段", "引文"]);
  });

  it("caps a step at 12000 ms", () => {
    const [page] = pages(`:::build\n- ${"字".repeat(500)}\n:::`);
    expect(page.stepMs).toEqual([12000]);
  });

  it("replaces the build wrapper by its children and keeps every step visible without scripts", () => {
    const html = toHtml(`:::build\n- 一\n- 二\n:::`);
    expect(html).toMatch(/<ul style="--i: 0">\s*<li data-ct-step data-ms="1600">一<\/li>/);
    expect(html).not.toContain("data-ct-mark");
    expect(html).not.toContain("hidden");
  });

  it("never puts a step inside notes", () => {
    const root = toHast(`:::build\n- 一\n\n:::summary\n講稿\n:::\n- 二\n:::`);
    for (const notes of findAll(root, "dataCtNotes")) expect(findAll(notes, "dataCtStep")).toEqual([]);
    expect(pages(`:::build\n- 一\n- 二\n:::\n\n:::summary\n講稿\n:::`)[0].steps).toEqual(["一", "二"]);
  });
});

describe("notes", () => {
  it("becomes <aside data-ct-notes> as an element child of the page, after the content", () => {
    const [page] = pages(`## 標題\n\n內文\n\n:::summary\n講稿一\n:::\n\n:::summary\n講稿二\n:::`);
    expect(page.content).toEqual(["h2", "p"]);
    expect(page.notes).toEqual(["講稿一", "講稿二"]);
    expect(toHtml(`內文\n\n:::summary\n講稿\n:::`)).toContain('<aside data-ct-notes><p>講稿</p></aside></section>');
  });

  it("moves a summary nested in another element up to the page", () => {
    const [page] = pages(`:::grid\n左\n\n:::summary\n深處的講稿\n:::\n:::`);
    expect(page.notes).toEqual(["深處的講稿"]);
  });

  it("belongs to the page that holds it", () => {
    const result = pages(`甲\n\n:::summary\n一\n:::\n\n::vertical\n\n乙\n\n:::summary\n二\n:::\n\n---\n\n丙`);
    expect(result.map(page => page.notes)).toEqual([["一"], ["二"], []]);
  });

  it("does not count notes in the reading time of a page", () => {
    const [bare] = pages(`十個字十個字十個字十個`);
    const [noted] = pages(`十個字十個字十個字十個\n\n:::summary\n${"很長的講稿".repeat(50)}\n:::`);
    expect(noted.ms).toBe(bare.ms);
  });
});

describe("pages", () => {
  it("::vertical starts the next page of the same slide; --- starts a slide", () => {
    const view = outline(toHast(`甲\n\n::vertical\n\n乙\n\n---\n\n丙`));
    expect(view.blocks[0].slides.map(slide => slide.pages.length)).toEqual([2, 1]);
  });

  it("reads a page's time without its steps, with the blog's slide budget", () => {
    const [page] = pages(`${"字".repeat(10)}\n\n:::build\n- ${"字".repeat(100)}\n:::`);
    // 3000 + 100 per character of the 10 outside the steps.
    expect(page.ms).toBe(4000);
    expect(pages(`短`)[0].ms).toBe(3100);
    expect(pages(`${"字".repeat(500)}`)[0].ms).toBe(20000);
  });

  it("numbers the content children for the entrance animation (--i)", () => {
    const html = toHtml(`## 標題\n\n內文\n\n:::summary\n講稿\n:::`);
    expect(html).toContain('<h2 style="--i: 0">');
    expect(html).toContain('<p style="--i: 1">');
    expect(html).not.toMatch(/<aside[^>]*style/);
  });

  it("leaves <section> in content alone", () => {
    const section: Hast = {
      type: "element",
      tagName: "section",
      properties: { className: ["infographic"] },
      children: [{ type: "text", value: "資訊圖" }],
    };
    const tree: Hast = { type: "root", children: [section] };
    const file = new VFile();
    unified().use(rehypeDeck).runSync(tree as never, file);
    const [page] = findAll(tree, "dataCtPage");
    const inner = (page.children ?? []).filter(isEl);
    expect(inner).toHaveLength(1);
    expect(inner[0].tagName).toBe("section");
    expect(inner[0].properties.dataCtSlide).toBeUndefined();
    expect(inner[0].properties.className).toEqual(["infographic"]);
    expect(findAll(tree, "dataCtPage")).toHaveLength(1);
  });
});

describe("outside the deck", () => {
  it("keeps footnotes and ESM nodes out of the deck", () => {
    const tree: Hast = {
      type: "root",
      children: [
        { type: "mdxjsEsm", value: "import x from 'x'" },
        { type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "內文" }] },
        { type: "element", tagName: "section", properties: { dataFootnotes: true }, children: [] },
      ],
    };
    unified().use(rehypeDeck).runSync(tree as never, new VFile());
    expect((tree.children ?? []).map(node => node.type === "element" ? (node.properties?.dataCtDeck ? "deck" : node.tagName) : node.type)).toEqual(["mdxjsEsm", "deck", "section"]);
  });

  it("skips a file that match rejects", () => {
    expect(toHtml(`甲\n\n---\n\n乙`, { match: () => false })).toContain("<hr>");
    expect(toHtml(`甲`, { match: () => true })).toContain("data-ct-deck");
  });

  it("leaves the directives of a file the remark match rejects to the host", () => {
    const directives = (match: boolean) => {
      const run = unified().use(remarkParse).use(remarkDirective).use(remarkDeck, { match: () => match });
      const tree = run.runSync(run.parse(`:::summary\n講稿\n:::\n\n::vertical`)) as unknown as { children: { data?: { hName?: string } }[] };
      return tree.children.map(node => node.data?.hName);
    };
    expect(directives(true)).toEqual(["aside", "hr"]);
    expect(directives(false)).toEqual([undefined, undefined]);
    // A directive in the wrong form is the host's business too when the file is not a deck.
    const run = unified().use(remarkParse).use(remarkDirective).use(remarkDeck, { match: () => false });
    expect(() => run.runSync(run.parse(`::summary`))).not.toThrow();
  });
});

describe("ids", () => {
  it("uses the author's id for a slide, s-<block>-<slide> otherwise", () => {
    const view = outline(toHast(`::block{title="甲"}\n\n## 一\n\n---\n\n::slide{#dilemma}\n\n## 二\n\n---\n\n## 三`));
    expect(view.blocks[0].slides.map(slide => slide.id)).toEqual(["s-1-1", "dilemma", "s-1-3"]);
  });

  it("fails on an id that content already uses", () => {
    const tree: Hast = {
      type: "root",
      children: [{ type: "element", tagName: "p", properties: { id: "s-1-1" }, children: [{ type: "text", value: "甲" }] }],
    };
    expect(() => unified().use(rehypeDeck).runSync(tree as never, new VFile())).toThrow(/already used/);
  });

  it("fails on a duplicate slide id, an id that another slide generates, and a ::slide with no id", () => {
    expect(() => toHast(`::slide{#a}\n\n甲\n\n---\n\n::slide{#a}\n\n乙`)).toThrow(/already used/);
    expect(() => toHast(`::slide{#s-1-2}\n\n甲\n\n---\n\n乙`)).toThrow(/already used/);
    expect(() => toHast(`::slide\n\n甲`)).toThrow(/needs an id/);
  });
});

describe("directive forms", () => {
  it.each([
    ["::summary", `::summary\n\n## 甲`, /container directive/],
    ["::build", `::build`, /container directive/],
    [":::vertical", `:::vertical\n:::`, /leaf directive/],
    ["an attribute on summary", `:::summary{title="x"}\n甲\n:::`, /no attribute "title"/],
  ])("fails on %s", (_name, markdown, message) => {
    expect(() => toHast(markdown)).toThrow(message);
  });
});
