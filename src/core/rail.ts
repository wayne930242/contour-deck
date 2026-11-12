/** The locator rail: the whole deck as a mini-map, one column per slide, one pip per page. */
import { h, offsetIn } from "./dom.js";
import type { BlockNode, Pos } from "./model.js";
import type { Labels } from "./types.js";

export interface Rail {
  el: HTMLElement;
  /** Slides the marker onto the pip of a position. */
  mark(pos: Pos): void;
}

export function buildRail(blocks: BlockNode[], labels: Labels): Rail {
  const el = h("nav", "ct-rail", "", { "aria-label": labels.rail });
  const groups: HTMLElement[] = [];
  const pips = blocks.map((block, b) => {
    const group = el.appendChild(h("div", "ct-rg"));
    if (block.kind) group.dataset.kind = block.kind;
    groups.push(group);
    group.append(h("button", "ct-rl", block.short, { "data-ct-go": `${b},0,0`, title: block.title }));
    return block.slides.map((slide, s) => {
      const column = group.appendChild(
        h("button", "ct-rc", "", { "data-ct-go": `${b},${s},0`, title: slide.title, "aria-label": `${block.title}：${slide.title}` })
      );
      return slide.pages.map((_, p) => column.appendChild(h("i", "", "", { "data-ct-go": `${b},${s},${p}` })));
    });
  });
  const marker = el.appendChild(h("span", "ct-rm"));
  return {
    el,
    mark({ b, s, p }) {
      groups.forEach((group, i) => group.toggleAttribute("data-cur", i === b));
      const { x, y } = offsetIn(pips[b][s][p], el);
      marker.style.transform = `translate(${x}px,${y}px)`;
    },
  };
}
