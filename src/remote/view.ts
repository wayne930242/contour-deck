/** What the phone and the presenter window share: reading the deck of their own page, and drawing pages small. */
import { h } from "../core/dom.js";
import { defaultLabels } from "../core/labels.js";
import { fitPos, parseAt, readModel } from "../core/model.js";
import type { BlockNode, PageNode, Pos } from "../core/model.js";
import { neighbourBlock } from "../core/navigator.js";
import { pageTitle } from "../core/notes.js";
import { formatClock } from "./clock.js";
import type { RemoteLabels } from "./labels.js";
import type { StateMessage } from "./protocol.js";

export interface Outline {
  blocks: BlockNode[];
  skip: string[];
}

export const readOutline = (root: HTMLElement, skip = ["appendix"]): Outline => ({
  blocks: readModel(root, root.dataset.title || document.title),
  skip,
});

/** The position a `state` names, if this page has it: both sides load the same page, but one may be stale. */
export function statePos({ blocks }: Outline, state: StateMessage): Pos | null {
  const parsed = parseAt(state.at);
  return parsed && fitPos(blocks, parsed);
}

export const pageAt = ({ blocks }: Outline, pos: Pos): PageNode => blocks[pos.b].slides[pos.s].pages[pos.p];

/** `三 · 4/6 · 頁 2/2 · 要點 1/4`, as DESIGN.md writes the position on the phone. */
export function positionLabel({ blocks }: Outline, pos: Pos, state: StateMessage): string {
  const block = blocks[pos.b];
  const pages = block.slides[pos.s].pages.length;
  return [
    block.short,
    `${pos.s + 1}/${block.slides.length}`,
    pages > 1 ? defaultLabels.page(pos.p + 1, pages) : "",
    state.steps ? defaultLabels.steps(state.step, state.steps) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export interface UpNext {
  kind: "step" | "page" | "slide" | "end";
  text: string;
  /** The page the next advance shows, and how many of its steps are revealed then. */
  pos: Pos;
  step: number;
}

const clip = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 80);

/** What the next advance does: one more step, the page below, the next slide, or nothing. */
export function upNext(outline: Outline, pos: Pos, step: number): UpNext {
  const { blocks, skip } = outline;
  const slide = blocks[pos.b].slides[pos.s];
  const page = slide.pages[pos.p];
  if (step < page.steps.length) return { kind: "step", text: clip(page.steps[step].textContent ?? ""), pos, step: step + 1 };
  if (pos.p + 1 < slide.pages.length) {
    const below = { ...pos, p: pos.p + 1 };
    return { kind: "page", text: pageTitle(slide.pages[below.p]) || slide.title, pos: below, step: 0 };
  }
  const nextBlock = neighbourBlock(blocks.map(block => block.kind), pos.b, 1, skip);
  const next = pos.s + 1 < blocks[pos.b].slides.length ? { b: pos.b, s: pos.s + 1, p: 0 } : nextBlock >= 0 ? { b: nextBlock, s: 0, p: 0 } : null;
  if (!next) return { kind: "end", text: "", pos, step };
  return { kind: "slide", text: blocks[next.b].slides[next.s].title, pos: next, step: 0 };
}

export interface Preview {
  el: HTMLElement;
  /** Draws a page with its first `steps` steps revealed; `null` empties the sheet. */
  show(page: PageNode | null, steps: number): void;
  destroy(): void;
}

/** Width of the sheet a page is laid out on before it is scaled to the box. */
const SHEET = 1280;

/**
 * A page of this document drawn small: a copy laid out by the stage's own rules on a 1280 px wide sheet,
 * then scaled to the box. A guide, not a mirror: it does not know how far the real page is scrolled.
 */
export function createPreview(root: HTMLElement): Preview {
  const el = h("div", "ct-pv");
  const sheet = el.appendChild(h("div", "ct-stage", "", { "aria-hidden": "true" }));
  const wrap = sheet.appendChild(h("div", `ct-pvw ${root.className}`.trim()));
  sheet.inert = true;
  const observer = new ResizeObserver(() => el.style.setProperty("--ct-k", String(el.clientWidth / SHEET)));
  observer.observe(el);
  let drawn: PageNode | null = null;
  return {
    el,
    show(page, steps) {
      if (page !== drawn) {
        drawn = page;
        const copy = page?.el.cloneNode(true) as HTMLElement | undefined;
        // A copy must not repeat ids, play media, or run frames a second time.
        copy?.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
        copy?.querySelectorAll("iframe,video,audio,script,[data-ct-notes]").forEach(node => node.remove());
        copy?.removeAttribute("id");
        wrap.replaceChildren(...(copy ? [copy] : []));
      }
      wrap.querySelectorAll("[data-ct-step]").forEach((node, i) => node.toggleAttribute("data-ct-on", i < steps));
    },
    destroy: () => observer.disconnect(),
  };
}

export interface Timers {
  /** Whole-talk time, `3:12 / 12:00`. */
  time: HTMLElement;
  /** Block title and block time. */
  block: HTMLElement;
  /** Redraws from the last state; call it on every state and every half second. */
  draw(state: StateMessage | null, receivedAt: number): void;
}

/** The two clocks. Between states they run on the local clock: a state every 15 s is enough to stay in step. */
export function createTimers(labels: RemoteLabels): Timers {
  const time = h("b", "ct-rmt-time", "0:00");
  const block = h("div", "ct-rmt-blk");
  const title = block.appendChild(h("span"));
  const spent = block.appendChild(h("b"));
  return {
    time,
    block,
    draw(state, receivedAt) {
      if (!state) return;
      // `elapsed` is 0 until the talk starts and never 0 after, so it also says whether the clock runs.
      const since = state.elapsed > 0 ? (performance.now() - receivedAt) / 1000 : 0;
      const elapsed = state.elapsed + since;
      time.textContent = formatClock(elapsed) + (state.total ? ` / ${formatClock(state.total)}` : "");
      time.toggleAttribute("data-over", !!state.total && elapsed > state.total);
      const budget = state.blockMinutes ? state.blockMinutes * 60 : 0;
      const inBlock = state.blockElapsed + since;
      title.textContent = `${labels.block}　${state.block}`;
      spent.textContent = formatClock(inBlock) + (budget ? ` / ${formatClock(budget)}` : "");
      spent.toggleAttribute("data-over", !!budget && inBlock > budget);
    },
  };
}

/** Keeps the screen awake while a view is open; the browser drops the lock when the page hides, so it is asked again. */
export function keepAwake(signal: AbortSignal): void {
  let lock: Promise<WakeLockSentinel | void> | null = null;
  const ask = () => {
    if (!document.hidden && !signal.aborted) lock = navigator.wakeLock?.request("screen").catch(() => {}) ?? null;
  };
  document.addEventListener("visibilitychange", ask, { signal });
  signal.addEventListener("abort", () => void lock?.then(held => held?.release()));
  ask();
}
