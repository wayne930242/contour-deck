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
 * | `::background{image="…" dim=0.6}`                | `<div data-ct-background>` (see below)   |
 *
 * A directive written in the wrong form (`::summary` for `:::summary`) is an error here,
 * not an empty box, and so is an unknown attribute.
 *
 * `::background` takes exactly one source, `image`, `video` (a file), or `youtube` (an id or a
 * watch, youtu.be, embed, or shorts URL, written out as the id), and `poster`, `start`, `end`,
 * `dim`, `position`, `credit` (plain text, shown small in a bottom corner). The element holds the still (the image, else the poster) as an `<img>`;
 * the core plays the video over it on the stage.
 *
 * With `structure: "headings"` the pages come from `###` headings, so `::vertical` is an error,
 * and `::block` needs no `title`: the block has its heading.
 */
import { BACKGROUND, MARK, MARK_BLOCK, MARK_BUILD, MARK_SLIDE, MARK_VERTICAL, NOTES } from "../shared/markers.js";
import { NO_VERTICAL, recordStructure, structureOf, type DeckFile, type Structure, type StructureOption } from "../shared/structure.js";

export type { DeckFile, Structure, StructureOption };

interface MdNode {
  type: string;
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown>; hChildren?: unknown[] };
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

const SECONDS = /^\d+(\.\d+)?$/;
const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_HOSTS = /^(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)$/;

/** The 11-character id of a YouTube id or URL, or `undefined`. */
export function youtubeId(value: string): string | undefined {
  const text = value.trim();
  if (YOUTUBE_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (!YOUTUBE_HOSTS.test(url.hostname)) return undefined;
  const id = url.hostname.endsWith("youtu.be")
    ? url.pathname.slice(1)
    : (url.searchParams.get("v") ?? /^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1]);
  return id && YOUTUBE_ID.test(id) ? id : undefined;
}

function background(node: MdNode, attributes: Record<string, string>, file: DeckFile): MdNode["data"] {
  const fail = (reason: string): never => file.fail(`::background ${reason}`, node, ORIGIN);
  const sources = (["image", "video", "youtube"] as const).filter(name => attributes[name] !== undefined);
  if (sources.length !== 1) {
    fail(
      sources.length
        ? `takes one source, got ${sources.join(" and ")}`
        : 'needs a source: image="…", video="…", or youtube="…"'
    );
  }
  const [source] = sources;
  const url = (name: string): string | undefined => {
    if (attributes[name] === undefined) return undefined;
    const value = attributes[name].trim();
    if (!value) fail(`${name} is empty`);
    return value;
  };

  const properties: Record<string, unknown> = { [BACKGROUND]: true };
  const style: string[] = [];
  if (source === "youtube") {
    const id = youtubeId(attributes.youtube);
    if (!id) fail(`youtube must be an 11-character video id or a YouTube URL, got "${attributes.youtube}"`);
    properties.dataYoutube = id;
  } else if (source === "video") {
    properties.dataVideo = url("video");
  }
  if (source === "image") {
    for (const name of ["poster", "start", "end"]) {
      if (attributes[name] !== undefined) fail(`${name} is for video and youtube, not image`);
    }
  }

  const seconds = (name: string): number | undefined => {
    const value = attributes[name];
    if (value === undefined) return undefined;
    if (!SECONDS.test(value)) fail(`${name} must be seconds, a number of 0 or more, got "${value}"`);
    return Number(value);
  };
  const start = seconds("start");
  const end = seconds("end");
  if (end !== undefined && !(end > (start ?? 0))) fail(`end (${end}) must be after start (${start ?? 0})`);
  if (start) properties.dataStart = String(start);
  if (end !== undefined) properties.dataEnd = String(end);

  if (attributes.dim !== undefined) {
    const dim = Number(attributes.dim);
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(attributes.dim) || !(dim >= 0 && dim <= 1)) {
      fail(`dim must be a number from 0 to 1, got "${attributes.dim}"`);
    }
    style.push(`--ct-dim: ${dim}`);
  }
  if (attributes.position !== undefined) {
    const position = attributes.position.trim();
    if (!/^[a-z0-9.%\s-]+$/i.test(position)) fail(`position must be an object-position such as "center" or "50% 20%", got "${attributes.position}"`);
    style.push(`--ct-position: ${position}`);
  }
  if (style.length) properties.style = style.join("; ");

  const still = source === "image" ? url("image") : url("poster");
  const children: unknown[] = still
    ? [{ type: "element", tagName: "img", properties: { src: still, alt: "", decoding: "async" }, children: [] }]
    : [];
  if (attributes.credit !== undefined) {
    const credit = attributes.credit.replace(/\s+/g, " ").trim();
    if (!credit) fail("credit is empty");
    children.push({ type: "element", tagName: "small", properties: { dataCtCredit: true }, children: [{ type: "text", value: credit }] });
  }
  return { hName: "div", hProperties: properties, hChildren: children };
}

const DIRECTIVES: Record<string, Directive> = {
  background: {
    form: "leaf",
    attributes: ["image", "video", "youtube", "poster", "start", "end", "dim", "position", "credit"],
    hast: (node, attributes, file) => background(node, attributes, file),
  },
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
    const structure = structureOf(options.structure, file, ORIGIN);
    recordStructure(file, structure);
    visit(tree, file, structure);
  };
}
