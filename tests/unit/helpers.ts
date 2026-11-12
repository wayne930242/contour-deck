import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import rehypeStringify from "rehype-stringify";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { VFile } from "vfile";
import { remarkDeck, type RemarkDeckOptions } from "../../src/remark/index.js";
import { rehypeDeck, type DeckOptions } from "../../src/rehype/index.js";

/** Minimal stand-in for the blog's other directives: unknown containers fall back to a div. */
function remarkHostDirectives() {
  return (tree: { type: string; name?: string; children?: unknown[]; data?: object }): void => {
    const visit = (node: typeof tree): void => {
      if (node.type === "textDirective" && node.name === "icon") node.data = { hName: "span" };
      for (const child of node.children ?? []) visit(child as typeof tree);
    };
    visit(tree);
  };
}

/** `remark` defaults to the `structure` of the rehype options: the host gives both plugins the same one. */
function processor(options: DeckOptions, remark: RemarkDeckOptions = { structure: options.structure }) {
  return unified()
    .use(remarkParse)
    .use(remarkCjkFriendly)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkHostDirectives)
    .use(remarkDeck, remark)
    .use(remarkRehype)
    .use(rehypeDeck, options);
}

export interface Hast {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Hast[];
}

const stripFrontmatter = (markdown: string): string => markdown.replace(/^---\n[\s\S]*?\n---\n/, "");

export function toHast(
  markdown: string,
  options: DeckOptions = {},
  data: Record<string, unknown> = {},
  remark?: RemarkDeckOptions
): Hast {
  const run = processor(options, remark);
  const file = new VFile({ value: stripFrontmatter(markdown), data });
  return run.runSync(run.parse(file), file) as Hast;
}

export function toHtml(markdown: string, options: DeckOptions = {}, data: Record<string, unknown> = {}): string {
  const file = new VFile({ value: stripFrontmatter(markdown), data });
  return String(processor(options).use(rehypeStringify).processSync(file));
}

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

export const isEl = (node: Hast): node is Hast & { tagName: string; properties: Record<string, unknown>; children: Hast[] } =>
  node.type === "element";

export function textOf(node: Hast): string {
  return node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("");
}

export function descendants(node: Hast): Hast[] {
  return (node.children ?? []).flatMap(child => [child, ...descendants(child)]);
}

export function findAll(node: Hast, prop: string): Hast[] {
  return descendants(node).filter(child => child.properties && prop in child.properties);
}

export interface PageView {
  ms: unknown;
  steps: string[];
  stepMs: unknown[];
  notes: string[];
  content: string[];
}

export interface SlideView {
  id: unknown;
  title: unknown;
  legacy: unknown;
  legacyV: unknown;
  pages: PageView[];
}

export interface BlockView {
  title: unknown;
  short: unknown;
  minutes: unknown;
  kind: unknown;
  id: unknown;
  slides: SlideView[];
}

const elementChildren = (node: Hast): Hast[] => (node.children ?? []).filter(isEl);

/** The deck as plain data; throws when the nesting breaks the contract. */
export function outline(root: Hast): { title: unknown; blocks: BlockView[] } {
  const decks = findAll(root, "dataCtDeck");
  if (decks.length !== 1) throw new Error(`expected one deck, found ${decks.length}`);
  const [deck] = decks;
  const only = (node: Hast, prop: string, level: string): void => {
    for (const child of elementChildren(node)) {
      if (!(prop in (child.properties ?? {}))) throw new Error(`${level} holds <${child.tagName}> that is not a ${prop}`);
    }
  };
  only(deck, "dataCtBlock", "deck");
  return {
    title: deck.properties?.dataTitle,
    blocks: elementChildren(deck).map(block => {
      only(block, "dataCtSlide", "block");
      const p = block.properties ?? {};
      return {
        title: p.dataTitle,
        short: p.dataShort,
        minutes: p.dataMinutes,
        kind: p.dataKind,
        id: p.id,
        slides: elementChildren(block).map(slide => {
          only(slide, "dataCtPage", "slide");
          return {
            id: slide.properties?.id,
            title: slide.properties?.dataTitle,
            legacy: slide.properties?.dataLegacy,
            legacyV: slide.properties?.dataLegacyV,
            pages: elementChildren(slide).map(page => {
              const kids = elementChildren(page);
              const notes = kids.filter(kid => "dataCtNotes" in (kid.properties ?? {}));
              const steps = findAll(page, "dataCtStep");
              return {
                ms: page.properties?.dataMs,
                steps: steps.map(step => textOf(step).trim()),
                stepMs: steps.map(step => step.properties?.dataMs),
                notes: notes.map(note => textOf(note).trim()),
                content: kids.filter(kid => !notes.includes(kid)).map(kid => kid.tagName as string),
              };
            }),
          };
        }),
      };
    }),
  };
}

export const counts = (view: ReturnType<typeof outline>): { blocks: number; slides: number; pages: number } => {
  const slides = view.blocks.flatMap(block => block.slides);
  return { blocks: view.blocks.length, slides: slides.length, pages: slides.reduce((n, s) => n + s.pages.length, 0) };
};

export interface SourceSlide {
  /** Old reveal.js index of the first page of the slide. */
  h: number;
  v: number;
  pages: number;
}

/**
 * The slide/page structure of a deck read straight from its source lines, without Markdown or
 * hast: `---` starts a horizontal slide, `::vertical` a vertical child, and a child starts a new
 * slide when it has an `## ` heading that differs from the slide's own. An independent check on
 * the plugins' reading of the same rule.
 */
export function sourceSlides(markdown: string): SourceSlide[] {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  // Group the lines by `---`, children by `::vertical`; a fenced code block holds neither.
  const groups: string[][][] = [[[]]];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && line === "---") groups.push([[]]);
    else if (!fenced && line === "::vertical") groups[groups.length - 1].push([]);
    else groups[groups.length - 1].at(-1)!.push(line);
  }

  const slides: SourceSlide[] = [];
  let h = -1;
  for (const group of groups) {
    const children = group.map(lines => lines.join("\n")).filter(child => child.trim());
    let h2: string | undefined;
    let v = 0;
    let current: SourceSlide | undefined;
    for (const child of children) {
      const heading = /^## (.+)$/m.exec(child)?.[1].trim();
      if (!current || (heading !== undefined && heading !== h2)) {
        if (!current) h += 1;
        current = { h, v, pages: 1 };
        h2 = heading;
        slides.push(current);
      } else {
        current.pages += 1;
      }
      v += 1;
    }
  }
  return slides;
}
