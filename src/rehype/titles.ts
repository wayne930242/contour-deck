/** Titles and short labels the plugin derives when the author gives none. */
import { isAside } from "../shared/markers.js";
import { isElement, isEnglishParagraph, plainText, walkElements, type Element, type HastNode } from "./hast.js";

const SNIPPET_CHARS = 40;

/** The element children of a page, not counting its notes, its background, and a paragraph that is only an English line. */
function contentElements(page: HastNode[]): Element[] {
  return page.filter(isElement).filter(node => !isAside(node.properties) && !isEnglishParagraph(node));
}

/** `#### 三、主要問題` style kicker: the first content element of the page is an `h4`. */
export function kickerOf(page: HastNode[]): Element | undefined {
  const [first] = contentElements(page);
  return first?.tagName === "h4" ? first : undefined;
}

/** A section divider: the page holds an `h1` and nothing else, such as `# 拆解`. */
export function dividerOf(page: HastNode[]): Element | undefined {
  const content = contentElements(page);
  return content.length === 1 && content[0].tagName === "h1" ? content[0] : undefined;
}

/** The first heading of `level` (1–6) in `nodes`, as plain text. */
export function firstHeading(nodes: HastNode[], level: number): string | undefined {
  let found: string | undefined;
  walkElements(nodes, node => {
    if (found === undefined && node.tagName === `h${level}`) found = plainText(node);
  });
  return found || undefined;
}

/**
 * A slide's title: its first `h1`–`h3` heading (the kicker is an `h4`, so it never wins over the
 * slide's own heading), else its first heading of any level, else a text snippet, else `fallback`.
 */
export function slideTitle(pages: HastNode[][], fallback: string): string {
  const headings: Element[] = [];
  for (const page of pages) {
    walkElements(page, node => {
      if (/^h[1-6]$/.test(node.tagName)) headings.push(node);
    });
  }
  const preferred = headings.find(node => Number(node.tagName[1]) <= 3) ?? headings[0];
  const heading = preferred && plainText(preferred);
  if (heading) return heading;

  const text = plainText({ type: "root", children: pages.flat() });
  if (!text) return fallback;
  const chars = [...text];
  return chars.length > SNIPPET_CHARS ? `${chars.slice(0, SNIPPET_CHARS).join("")}…` : text;
}

const NUMERAL = /^([一二三四五六七八九十百零〇]+|\d+)\s*[、.．]/;
const APPENDIX = /^附錄\s*(\S+?)\s*[｜|:：、]/;

/**
 * The locator label of a block title: `三、主要問題` gives `三`, `附錄 A｜…` gives `A`.
 * Undefined when the title has no such lead, or the lead is longer than 3 characters.
 */
export function shortOf(title: string): string | undefined {
  const lead = NUMERAL.exec(title)?.[1] ?? APPENDIX.exec(title)?.[1];
  return lead && [...lead].length <= 3 ? lead : undefined;
}

/** Under the `####` fallback rule, a block titled `附錄 …` is an appendix. */
export function kindOf(title: string): string | undefined {
  return title.startsWith("附錄") ? "appendix" : undefined;
}
