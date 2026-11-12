/** The few hast shapes the plugin touches; hast itself is not a dependency. */
import { MARK } from "../shared/markers.js";

export interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface Element extends HastNode {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

export function isElement(node: HastNode): node is Element {
  return node.type === "element";
}

export function element(
  tagName: string,
  properties: Record<string, unknown>,
  children: HastNode[]
): Element {
  return { type: "element", tagName, properties, children };
}

export function classesOf(node: Element): string[] {
  const value = node.properties.className;
  if (Array.isArray(value)) return value.map(String);
  return typeof value === "string" ? value.split(/\s+/) : [];
}

export function hasClass(node: HastNode, name: string): boolean {
  return isElement(node) && classesOf(node).includes(name);
}

export function isBlank(node: HastNode): boolean {
  return node.type === "text" && !(node.value ?? "").trim();
}

/** The marker the remark plugin put on `node`, if any. */
export function markOf(node: HastNode): string | undefined {
  if (!isElement(node)) return undefined;
  const mark = node.properties[MARK];
  return typeof mark === "string" ? mark : undefined;
}

/** Plain text of `node`; subtrees for which `skip` is true count as empty. */
export function textOf(node: HastNode, skip?: (node: HastNode) => boolean): string {
  if (node.type === "text") return node.value ?? "";
  if (skip?.(node)) return "";
  return (node.children ?? []).map(child => textOf(child, skip)).join("");
}

/** Text as a title: whitespace collapsed and trimmed. */
export function plainText(node: HastNode): string {
  return textOf(node).replace(/\s+/g, " ").trim();
}

/** Calls `visit` for every element under `nodes`, in document order. */
export function walkElements(nodes: HastNode[], visit: (node: Element) => void): void {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    visit(node);
    walkElements(node.children, visit);
  }
}
