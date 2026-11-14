import { describe, expect, it } from "vitest";
import { outline, toHast, toHtml } from "./helpers.js";

const headings = (markdown: string) => outline(toHast(markdown, { structure: "headings" }));

describe(":en[…]", () => {
  it("writes the English line as span.en with lang, keeping its inline Markdown", () => {
    const html = toHtml("- 中文 :en[An *English* line with `code` and [a link](https://example.com)]");
    expect(html).toContain(
      '<span class="en" lang="en">An <em>English</em> line with <code>code</code> and <a href="https://example.com">a link</a></span>'
    );
    expect(html).not.toContain(":en[");
  });

  it("works in table cells, header and body, and inside :::build steps", () => {
    const html = toHtml(":::build\n| 遊戲 :en[Game] | 限制 :en[Limits] |\n| --- | --- |\n| 星海 :en[StarCraft] | 鏡頭 :en[Camera] |\n:::");
    expect(html.match(/<span class="en" lang="en">/g)).toHaveLength(4);
    expect(html).toMatch(/<tr data-ct-step[^>]*>\s*<td>星海 <span class="en" lang="en">StarCraft<\/span><\/td>/);
    const steps = toHtml(":::build\n- 一 :en[One]\n- 二 :en[Two]\n:::");
    expect(steps).toMatch(/<li data-ct-step[^>]*>一 <span class="en" lang="en">One<\/span><\/li>/);
  });

  it.each([
    ["the leaf form", "::en[English]", "en is a text directive: write :en[…]"],
    ["the container form", ":::en\nEnglish\n:::", "en is a text directive: write :en[…]"],
    ["an attribute", ":en[English]{lang=fr}", 'en has no attribute "lang" (known: none)'],
  ])("fails fast on %s", (_name, markdown, message) => {
    expect(() => toHast(markdown)).toThrow(message);
  });

  it("in headings mode, an English paragraph under a heading belongs to it, not to the page's content", () => {
    // `### 小標` right under `## 標題` and its English line still heads the first page, as it would without the line.
    const view = headings("## 標題\n\n:en[Title]\n\n### 小標\n\n:en[Subtitle]\n\n內文\n\n### 第二頁\n\n乙");
    expect(view.blocks[0].slides).toHaveLength(1);
    expect(view.blocks[0].slides[0].title).toBe("標題");
    expect(view.blocks[0].slides[0].pages.map(page => page.content)).toEqual([["h2", "p", "h3", "p", "p"], ["h3", "p"]]);
  });

  it("in headings mode, a kicker with its English line still opens the first ## slide", () => {
    const view = headings("#### 引言\n\n:en[Introduction]\n\n## 第一張\n\n內文");
    expect(view.blocks[0].title).toBe("引言");
    expect(view.blocks[0].slides).toHaveLength(1);
    expect(view.blocks[0].slides[0].title).toBe("第一張");
  });

  it("marks a paragraph of nothing but :en for the stylesheet, and not one with Chinese before it", () => {
    const html = toHtml("## 標題\n\n:en[Title]\n\n中文 :en[English]");
    expect(html).toMatch(/<p[^>]* data-ct-en><span class="en" lang="en">Title<\/span><\/p>/);
    expect(html).toMatch(/<p style="--i: 2">中文 <span class="en" lang="en">English<\/span><\/p>/);
  });

  it("a paragraph with Chinese and English stays content", () => {
    const view = headings("## 標題\n\n中文 :en[English]\n\n### 小標\n\n乙");
    expect(view.blocks[0].slides[0].pages).toHaveLength(2);
  });
});
