/** One page: its background, its notes, its steps, its reading time. */
import { BACKGROUND, NOTES, MARK_BUILD } from "../shared/markers.js";
import type { DeckFile } from "../shared/structure.js";
import { ORIGIN } from "./draft.js";
import {
  element,
  hasClass,
  isBlank,
  isElement,
  markOf,
  textOf,
  type Element,
  type HastNode,
} from "./hast.js";
import { PAGE_MS, readingMs, STEP_MS } from "./reading.js";

const isNotes = (node: HastNode): boolean => isElement(node) && NOTES in node.properties;
const isBackground = (node: HastNode): boolean => isElement(node) && BACKGROUND in node.properties;

function isStep(node: HastNode): boolean {
  return isElement(node) && "dataCtStep" in node.properties;
}

/** Removes every element `is` matches, at any depth, into `taken` in document order. */
function take(children: HastNode[], is: (node: HastNode) => boolean, taken: Element[]): HastNode[] {
  return children.filter(node => {
    if (is(node)) {
      taken.push(node as Element);
      return false;
    }
    if (node.children) node.children = take(node.children, is, taken);
    return true;
  });
}

/** What a `:::build` reveals one at a time: list items, table body rows, or other blocks. */
function stepTargets(build: Element): Element[] {
  const targets: Element[] = [];
  for (const child of build.children) {
    if (!isElement(child)) continue;
    if (child.tagName === "ul" || child.tagName === "ol") {
      targets.push(...child.children.filter((item): item is Element => isElement(item) && item.tagName === "li"));
    } else if (child.tagName === "table" || hasClass(child, "table-scroll")) {
      const visit = (node: HastNode): void => {
        if (!isElement(node) || node.tagName === "thead") return;
        if (node.tagName === "tr") targets.push(node);
        else node.children.forEach(visit);
      };
      visit(child);
    } else {
      targets.push(child);
    }
  }
  return targets;
}

/** Marks the children of each build marker as steps and replaces the marker by its children. */
function applyBuilds(nodes: HastNode[]): HastNode[] {
  return nodes.flatMap(node => {
    if (!isElement(node)) return [node];
    node.children = applyBuilds(node.children);
    if (markOf(node) !== MARK_BUILD) return [node];
    for (const target of stepTargets(node)) {
      target.properties = {
        ...target.properties,
        dataCtStep: true,
        dataMs: readingMs(textOf(target), STEP_MS),
      };
    }
    return node.children;
  });
}

/** `--i: n` on each content child, the order of the entrance animation. */
function staggerIndex(content: HastNode[]): void {
  content.filter(isElement).forEach((node, order) => {
    const style = node.properties.style;
    node.properties.style =
      typeof style === "string" && style.trim() ? `--i: ${order}; ${style}` : `--i: ${order}`;
  });
}

/** The page: its background first, then the content, then the notes, wherever each was written in the page. */
export function buildPage(children: HastNode[], file: DeckFile): Element {
  const notes: Element[] = [];
  const backgrounds: Element[] = [];
  const rest = take(take(children, isNotes, notes), isBackground, backgrounds);
  const hidden: Element[] = [];
  take(notes, isBackground, hidden);
  if (hidden.length) file.fail("::background inside :::summary: write it outside the notes, on the page", hidden[0], ORIGIN);
  if (backgrounds.length > 1) file.fail("a page holds two ::background directives", backgrounds[1], ORIGIN);
  const content = applyBuilds(rest).filter(node => !isBlank(node));
  staggerIndex(content);

  const withoutSteps = content.map(node => textOf(node, isStep)).join("");
  return element("section", { dataCtPage: true, dataMs: readingMs(withoutSteps, PAGE_MS) }, [
    ...backgrounds,
    ...content,
    ...notes,
  ]);
}
