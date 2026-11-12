/** Speaker notes: the panel beside the stage, and the notes view (a scrolling script for a phone). */
import { h } from "./dom.js";
import type { BlockNode, PageNode, Pos } from "./model.js";
import type { Labels } from "./types.js";

export const notesHtml = (page: PageNode) => page.notes.map(note => note.innerHTML).join("");

export function pageTitle(page: PageNode): string {
  return page.el.querySelector("h1,h2,h3")?.textContent?.trim() ?? "";
}

export interface Script {
  el: HTMLElement;
  /** Scrolls the entry of a position to the top. */
  show(pos: Pos): void;
}

/** Every page in order with its notes; the heading of an entry opens that page on the stage. */
export function buildScript(blocks: BlockNode[], labels: Labels): Script {
  const el = h("div", "ct-script", "", { tabindex: -1 });
  const entries = new Map<string, HTMLElement>();
  blocks.forEach((block, b) => {
    const section = el.appendChild(h("section", "ct-sb"));
    const head = section.appendChild(h("h2", "ct-sbh", block.title));
    if (block.kind === "appendix") head.append(h("span", "ct-badge", labels.appendix));
    if (block.minutes) head.append(h("span", "ct-meta", labels.minutes(block.minutes)));
    block.slides.forEach((slide, s) => {
      slide.pages.forEach((page, p) => {
        const entry = section.appendChild(h("article", "ct-se"));
        const count = slide.pages.length;
        const open = entry.appendChild(h("button", "ct-sh", "", { "data-ct-go": `${b},${s},${p}` }));
        open.append(
          h("span", "ct-meta", `${block.short}.${s + 1}${count > 1 ? ` · ${labels.page(p + 1, count)}` : ""}`),
          h("b", "", pageTitle(page) || slide.title)
        );
        const body = entry.appendChild(h("div", "ct-sn"));
        body.innerHTML = notesHtml(page);
        entries.set(`${b},${s},${p}`, entry);
      });
    });
  });
  return {
    el,
    show: ({ b, s, p }) => entries.get(`${b},${s},${p}`)?.scrollIntoView(),
  };
}
