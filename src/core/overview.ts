/** The outline: one panel per block, one schematic thumbnail per slide. */
import { h, offsetIn } from "./dom.js";
import type { BlockNode } from "./model.js";
import type { Labels } from "./types.js";

export interface Overview {
  el: HTMLElement;
  /** `faces[b][s]` is the front sheet of a thumbnail, the rectangle the stage zooms from. */
  faces: HTMLElement[][];
  thumbs: HTMLButtonElement[][];
  /** Moves the "you are here" ring onto a thumbnail. */
  ring(b: number, s: number, instant?: boolean): void;
}

const FIGURE = "figure,img,picture,svg,canvas,video,iframe";

function sketchType(el: HTMLElement): string {
  if (el.dataset.ctSk) return el.dataset.ctSk;
  if (el.matches("ul,ol")) return "list";
  if (el.matches("table") || (el.children.length === 1 && el.children[0].matches("table"))) return "table";
  if (el.matches("blockquote")) return "quote";
  if (el.matches(FIGURE)) return "figure";
  return el.tagName === "DIV" && el.children.length > 1 ? "grid" : "text";
}

/** Up to two marks that hint at what the page holds. */
function sketch(page: HTMLElement): HTMLElement {
  const box = h("span", "ct-sk");
  for (const el of page.children) {
    if (!(el instanceof HTMLElement) || el.matches("[data-ct-notes],h1,h2,h3,h4,h5,h6")) continue;
    const type = sketchType(el);
    const mark = h("i", `ct-g ct-g-${type}`);
    const cells = type === "nums" ? 2 : Math.min(el.children.length, 4);
    if (type === "list") mark.style.setProperty("--c", String(cells));
    if (type === "grid" || type === "flow" || type === "nums") for (let i = 0; i < cells; i++) mark.append(h("b"));
    box.append(mark);
    if (box.children.length === 2) break;
  }
  return box;
}

export function buildOverview(blocks: BlockNode[], labels: Labels): Overview {
  const el = h("div", "ct-ov");
  const plane = el.appendChild(h("div", "ct-plane"));
  const faces: HTMLElement[][] = [];
  const thumbs: HTMLButtonElement[][] = [];

  blocks.forEach((block, b) => {
    const tile = plane.appendChild(h("section", "ct-tile"));
    if (block.kind) tile.dataset.kind = block.kind;
    if (block.slides.length > 3) tile.dataset.wide = "";
    const pages = block.slides.reduce((sum, slide) => sum + slide.pages.length, 0);
    const meta = [labels.slides(block.slides.length)];
    if (pages > block.slides.length) meta.push(labels.pages(pages));
    if (block.minutes) meta.push(labels.minutes(block.minutes));
    const open = tile.appendChild(h("button", "ct-open", "", { "data-ct-go": `${b},0,0` }));
    open.append(h("span", "ct-tt", block.title));
    if (block.kind === "appendix") open.append(h("span", "ct-badge", labels.appendix));
    open.append(h("span", "ct-meta", meta.join(" · ")));

    const strip = tile.appendChild(h("ol", "ct-strip"));
    faces[b] = [];
    thumbs[b] = block.slides.map((slide, s) => {
      const count = slide.pages.length;
      const thumb = h("button", "ct-thumb", "", {
        "data-ct-go": `${b},${s},0`,
        "aria-label": labels.thumb(block.title, s + 1, slide.title, count),
      });
      thumb.style.setProperty("--n", String(count));
      // A slide with several pages is a stack of sheets, one per page.
      for (let k = count - 1; k > 0; k--) thumb.appendChild(h("span", "ct-layer")).style.setProperty("--k", String(k));
      const face = thumb.appendChild(h("span", "ct-face"));
      const number = face.appendChild(h("span", "ct-num"));
      number.append(h("span", "", `${block.short}.${s + 1}`));
      if (count > 1) number.append(h("span", "", labels.pages(count)));
      face.append(h("span", "ct-t", slide.title), sketch(slide.pages[0].el));
      strip.appendChild(h("li")).append(thumb);
      faces[b][s] = face;
      return thumb;
    });
  });

  const ringEl = plane.appendChild(h("div", "ct-ring", "", { "data-label": labels.here }));
  return {
    el,
    faces,
    thumbs,
    ring(b, s, instant) {
      const face = faces[b][s];
      const { x, y } = offsetIn(face, plane);
      const style = ringEl.style;
      if (instant) style.transition = "none";
      style.left = `${x}px`;
      style.top = `${y}px`;
      style.width = `${face.offsetWidth}px`;
      style.height = `${face.offsetHeight}px`;
      style.setProperty("--n", String(blocks[b].slides[s].pages.length));
      if (instant) {
        void ringEl.offsetWidth;
        style.transition = "";
      }
    },
  };
}
