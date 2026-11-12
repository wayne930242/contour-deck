/**
 * Turns the slide directives of the blog's Markdown into marker elements for
 * `contour-deck/rehype`. The host registers `remark-directive` before this plugin.
 *
 * | Markdown                                         | Becomes                                  |
 * | ------------------------------------------------ | ---------------------------------------- |
 * | `:::summary` … `:::`                             | `<aside data-ct-notes>`                  |
 * | `:::build` … `:::`                               | build marker (rehype marks the steps)    |
 * | `::vertical`                                     | page break marker                        |
 * | `::block{title="…" minutes=5 kind=appendix}`     | block marker                             |
 * | `::slide{#id}`                                   | marker that gives the slide its id       |
 *
 * A directive written in the wrong form (`::summary` for `:::summary`) is an error here,
 * not an empty box, and so is an unknown attribute.
 *
 * With `structure: "headings"` the pages come from `###` headings, so `::vertical` is an error,
 * and `::block` needs no `title`: the block has its heading.
 */
import { MARK, MARK_BLOCK, MARK_BUILD, MARK_SLIDE, MARK_VERTICAL, NOTES } from "../shared/markers.js";
import { NO_VERTICAL, structureOf, type DeckFile, type Structure, type StructureOption } from "../shared/structure.js";

export type { DeckFile, Structure, StructureOption };

interface MdNode {
  type: string;
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

export interface RemarkDeckOptions {
  /** Whether this file is a Contour deck. Default: every file. Pass the same test to `contour-deck/rehype`. */
  match?: (file: DeckFile) => boolean;
  /** `"slides"` (default) or `"headings"`, or a function of the file. Pass the same one to `contour-deck/rehype`. */
  structure?: StructureOption;
}

type Form = "container" | "leaf";

interface Directive {
  form: Form;
  attributes: readonly string[];
  hast(node: MdNode, attributes: Record<string, string>, file: DeckFile, structure: Structure): MdNode["data"];
}

const ORIGIN = "contour-deck:remark";

const DIRECTIVES: Record<string, Directive> = {
  summary: {
    form: "container",
    attributes: [],
    hast: () => ({ hName: "aside", hProperties: { [NOTES]: true } }),
  },
  build: {
    form: "container",
    attributes: [],
    hast: () => ({ hName: "div", hProperties: { [MARK]: MARK_BUILD } }),
  },
  vertical: {
    form: "leaf",
    attributes: [],
    hast(node, _attributes, file, structure) {
      if (structure === "headings") file.fail(NO_VERTICAL, node, ORIGIN);
      return { hName: "hr", hProperties: { [MARK]: MARK_VERTICAL } };
    },
  },
  slide: {
    form: "leaf",
    attributes: ["id"],
    hast(node, attributes, file) {
      if (!attributes.id) file.fail("::slide needs an id: ::slide{#dilemma}", node, ORIGIN);
      return { hName: "div", hProperties: { [MARK]: MARK_SLIDE, id: attributes.id } };
    },
  },
  block: {
    form: "leaf",
    attributes: ["title", "short", "minutes", "kind", "id"],
    hast(node, attributes, file, structure) {
      const title = attributes.title?.trim();
      if (structure === "slides") {
        if (!title) file.fail('::block needs a title: ::block{title="三、主要問題"}', node, ORIGIN);
      } else if (attributes.title !== undefined && !title) {
        file.fail("::block title is empty: leave it out to title the block by its heading", node, ORIGIN);
      }

      const properties: Record<string, unknown> = { [MARK]: MARK_BLOCK };
      if (title) properties.dataTitle = title;
      if (attributes.short !== undefined) {
        const short = attributes.short.trim();
        if (!short || [...short].length > 3) {
          file.fail(`::block short must be 1 to 3 characters, got "${attributes.short}"`, node, ORIGIN);
        }
        properties.dataShort = short;
      }
      if (attributes.minutes !== undefined) {
        const minutes = Number(attributes.minutes);
        if (!/^\d+(\.\d+)?$/.test(attributes.minutes) || !(minutes > 0)) {
          file.fail(`::block minutes must be a positive number, got "${attributes.minutes}"`, node, ORIGIN);
        }
        properties.dataMinutes = String(minutes);
      }
      if (attributes.kind !== undefined) {
        if (!/^\S+$/.test(attributes.kind)) {
          file.fail(`::block kind must be one token, got "${attributes.kind}"`, node, ORIGIN);
        }
        properties.dataKind = attributes.kind;
      }
      if (attributes.id) properties.id = attributes.id;
      return { hName: "div", hProperties: properties };
    },
  },
};

const FORM_OF_TYPE: Record<string, Form | "text"> = {
  containerDirective: "container",
  leafDirective: "leaf",
  textDirective: "text",
};

const EXAMPLE: Record<Form, (name: string) => string> = {
  container: name => `:::${name} … :::`,
  leaf: name => `::${name}`,
};

function apply(node: MdNode, file: DeckFile, structure: Structure): void {
  const directive = node.name ? DIRECTIVES[node.name] : undefined;
  if (!directive || !node.name) return;

  const form = FORM_OF_TYPE[node.type];
  if (form !== directive.form) {
    file.fail(
      `${node.name} is a ${directive.form} directive: write ${EXAMPLE[directive.form](node.name)}`,
      node,
      ORIGIN
    );
  }

  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    if (!directive.attributes.includes(key)) {
      const known = directive.attributes.length ? directive.attributes.join(", ") : "none";
      file.fail(`${node.name} has no attribute "${key}" (known: ${known})`, node, ORIGIN);
    }
    attributes[key] = value ?? "";
  }

  node.data = { ...node.data, ...directive.hast(node, attributes, file, structure) };
  if (directive.form === "leaf") node.children = [];
}

function visit(node: MdNode, file: DeckFile, structure: Structure): void {
  apply(node, file, structure);
  for (const child of node.children ?? []) visit(child, file, structure);
}

export function remarkDeck(options: RemarkDeckOptions = {}) {
  return (tree: MdNode, file: DeckFile): void => {
    if (options.match && !options.match(file)) return;
    visit(tree, file, structureOf(options.structure, file, ORIGIN));
  };
}
