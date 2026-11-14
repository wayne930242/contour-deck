import { describe, expect, it } from "vitest";
import { mainRange } from "../../src/core/navigator.js";
import { outline, toHast } from "./helpers.js";

const kinds = (markdown: string, structure: "slides" | "headings" = "headings") =>
  outline(toHast(markdown, { structure })).blocks.map(block => [block.title, block.kind]);

describe("::block kind=opening and kind=closing", () => {
  it("in headings mode, marks the first and the last block and keeps their titles from their headings", () => {
    const markdown = [
      "::block{kind=opening}\n\n#### 會議\n\n# 斷頭神論\n\n## 為什麼？\n\n甲",
      "#### 引言\n\n## 一\n\n乙",
      "::block{kind=closing}\n\n#### 全文\n\n## 銘謝聆聽\n\n丙",
    ].join("\n\n---\n\n");
    expect(kinds(markdown)).toEqual([
      ["會議", "opening"],
      ["引言", undefined],
      ["全文", "closing"],
    ]);
  });

  it("in slides mode, takes them on the first and the last ::block", () => {
    const markdown =
      '::block{title="開場" kind=opening}\n\n## 封面\n\n---\n\n::block{title="正文"}\n\n## 一\n\n---\n\n::block{title="結尾" kind=closing}\n\n## 謝謝';
    expect(kinds(markdown, "slides")).toEqual([
      ["開場", "opening"],
      ["正文", undefined],
      ["結尾", "closing"],
    ]);
  });

  it.each([
    ["an opening that is not the first block", "#### 一\n\n## a\n\n---\n\n::block{kind=opening}\n\n#### 二\n\n## b", 'kind=opening must be the first block, but "二" is block 2'],
    ["two openings", "::block{kind=opening}\n\n#### 一\n\n## a\n\n---\n\n::block{kind=opening}\n\n#### 二\n\n## b\n\n---\n\n#### 三\n\n## c", "kind=opening must be the first block"],
    ["a closing that is not the last block", "#### 一\n\n## a\n\n---\n\n::block{kind=closing}\n\n#### 二\n\n## b\n\n---\n\n#### 三\n\n## c", 'kind=closing must be the last block, but "二" is block 2 of 3'],
    ["an opening and a closing with nothing between", "::block{kind=opening}\n\n#### 一\n\n## a\n\n---\n\n::block{kind=closing}\n\n#### 二\n\n## b", "need at least one other block between them"],
    ["an opening alone", "::block{kind=opening}\n\n#### 一\n\n## a", "need at least one other block"],
  ])("fails fast on %s", (_name, markdown, message) => {
    expect(() => toHast(markdown, { structure: "headings" })).toThrow(message);
  });

  it("mainRange leaves out an opening first block and a closing last block only", () => {
    expect(mainRange(["opening", "", "", "closing"])).toEqual({ first: 1, last: 2 });
    expect(mainRange(["", "appendix", "closing"])).toEqual({ first: 0, last: 1 });
    expect(mainRange(["opening", ""])).toEqual({ first: 1, last: 1 });
    expect(mainRange(["", "cover"])).toEqual({ first: 0, last: 1 });
    expect(mainRange(["opening"])).toEqual({ first: 0, last: 0 });
  });
});
