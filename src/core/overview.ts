/** The outline: one panel per block, one schematic thumbnail per slide; in 3D, one row per block on the depth desk. */
import { clamp, h, offsetIn } from "./dom.js";
import type { BlockNode } from "./model.js";
import type { Labels } from "./types.js";

export interface Overview {
  el: HTMLElement;
  /** `faces[b][s]` is the front sheet of a thumbnail, the rectangle the stage zooms from. */
  faces: HTMLElement[][];
  thumbs: HTMLButtonElement[][];
  /** Moves the "you are here" ring onto a thumbnail. */
  ring(b: number, s: number, instant?: boolean): void;
  /** Records that a slide has been on the stage: the outline shows it faded. */
  seen(b: number, s: number): void;
  /** Switches the depth desk on or off and fits its rows to the outline's size. */
  depth(on: boolean): void;
  /** The depth desk's camera: the row it stands at, fractional while it moves. Without an argument, reads it. */
  camera(at?: number): number;
  /** The block whose row is under `el`, or -1. */
  rowOf(el: Element): number;
  /** Scroll distance of one row on the depth desk. */
  readonly step: number;
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
  // In 3D the desk is the camera (sticky, clipped, with the perspective) and the plane the scene inside it;
  // the snap points under them give each row a stop of native scrolling.
  const desk = el.appendChild(h("div", "ct-desk"));
  const plane = desk.appendChild(h("div", "ct-plane"));
  const stops = el.appendChild(h("div", "ct-stops", "", { "aria-hidden": "true" }));
  const faces: HTMLElement[][] = [];
  const thumbs: HTMLButtonElement[][] = [];
  const tiles: HTMLElement[] = [];
  const visited = blocks.map(block => block.slides.map(() => false));
  let depth = false;
  let cam = 0;
  let front = -1;
  let here: HTMLElement | null = null;

  blocks.forEach((block, b) => {
    const tile = plane.appendChild(h("section", "ct-tile"));
    tile.style.setProperty("--i", String(b));
    tiles.push(tile);
    stops.append(h("i"));
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
  let ringAt: [number, number] = [0, 0];

  /** Rows the camera has passed slide out and take no pointer; the row in front shows its stacks in depth. */
  function setFront(row: number) {
    if (row === front) return;
    front = row;
    tiles.forEach((tile, b) => {
      tile.toggleAttribute("data-ct-front", depth && b === row);
      tile.toggleAttribute("data-ct-past", depth && b < row);
    });
  }

  /** In 3D a row taller than six tenths of the outline is scaled down; all rows hang from one line that leaves room for the tallest. */
  function fit() {
    if (!depth) return;
    const height = el.clientHeight;
    let tallest = 0;
    for (const tile of tiles) {
      const scale = Math.min(1, (height * 0.6) / (tile.offsetHeight || 1));
      tile.style.setProperty("--fit", scale.toFixed(3));
      tallest = Math.max(tallest, tile.offsetHeight * scale);
    }
    plane.style.setProperty("--ct-top", `${Math.round(clamp(height - tallest - 40, height * 0.36, height * 0.6))}px`);
  }

  const api: Overview = {
    el,
    faces,
    thumbs,
    get step() {
      return (stops.firstElementChild as HTMLElement).offsetHeight || 1;
    },
    depth(on) {
      depth = on;
      front = -1;
      if (on) fit();
      setFront(on ? clamp(Math.round(cam), 0, tiles.length - 1) : -1);
      api.ring(...ringAt, true);
    },
    camera(at) {
      if (at === undefined) return cam;
      cam = at;
      plane.style.setProperty("--ct-cam", String(+at.toFixed(4)));
      setFront(depth ? clamp(Math.round(at), 0, tiles.length - 1) : -1);
      return cam;
    },
    rowOf: target => tiles.findIndex(tile => tile.contains(target)),
    seen(b, s) {
      visited[b][s] = true;
      thumbs[b][s].setAttribute("data-ct-seen", "");
    },
    ring(b, s, instant) {
      ringAt = [b, s];
      // The current thumbnail stands out of the faded ones; a block is faded once all its slides were shown and it is not current.
      here?.removeAttribute("aria-current");
      here = thumbs[b][s];
      here.setAttribute("aria-current", "true");
      tiles.forEach((tile, i) => tile.toggleAttribute("data-ct-seen", i !== b && visited[i].every(Boolean)));
      const face = faces[b][s];
      // In 3D the ring rides in the row of its thumbnail, so it moves with that row.
      const host = depth ? tiles[b] : plane;
      if (ringEl.parentElement !== host) {
        host.append(ringEl);
        instant = true;
      }
      const { x, y } = offsetIn(face, host);
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
  return api;
}
