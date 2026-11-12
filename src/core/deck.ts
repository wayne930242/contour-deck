/** createDeck: builds the shell around a contract deck and wires the stage, the outline, and the input. */
import { clamp, h } from "./dom.js";
import { createWheelGate } from "./gestures.js";
import { defaultLabels } from "./labels.js";
import { fitPos, formatAt, parseAt, posOf, readModel } from "./model.js";
import type { PageNode, Pos, SlideNode } from "./model.js";
import { neighbourBlock } from "./navigator.js";
import { buildScript, notesHtml } from "./notes.js";
import { buildOverview } from "./overview.js";
import { buildRail } from "./rail.js";
import { isTall, nextStop, pageIndexAt, pageProgress, pageStops } from "./stops.js";
import { finished, zoomOverview, zoomStage } from "./transitions.js";
import type { Deck, DeckChange, DeckOptions, DeckState, Mode } from "./types.js";

const ON = "data-ct-on";
const OPEN_MS = 520;
const CLOSE_MS = 480;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function createDeck(root: HTMLElement, options: DeckOptions = {}): Deck {
  const labels = { ...defaultLabels, ...options.labels };
  const deckTitle = root.dataset.title || document.title;
  const blocks = readModel(root, deckTitle);
  const kinds = blocks.map(block => block.kind);
  const skip = options.linear?.skip ?? ["appendix"];
  const useUrl = options.url !== false;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => motion.matches;
  const smooth = (): ScrollBehavior => (reduced() ? "auto" : "smooth");
  const abort = new AbortController();
  const { signal } = abort;
  const listeners = { change: new Set<(change: DeckChange) => void>(), exit: new Set<() => void>() };

  let mode: Mode = "overview";
  let pos: Pos = { b: 0, s: 0, p: 0 };
  let busy = false;
  let alive = true;
  /** The page that has received `ct:enter` and not yet `ct:leave`. */
  let current: { page: PageNode; at: Pos } | null = null;
  let lastChange = "";
  let lastUrl = "";
  let frame = 0;
  let idle = 0;
  /** A slide change the deck itself started and whose scroll has not arrived yet. */
  let pending: { s: number; top: () => number; left: number; still: number } | null = null;
  let wakeLock: Promise<WakeLockSentinel | void> | null = null;

  /* ---- shell: bar, outline, stage, notes panel, notes view ---- */
  const app = h("div", "ct-app");
  const bar = app.appendChild(h("header", "ct-bar"));
  const button = (action: string, text: string, label = "") => {
    const el = h("button", "ct-btn", text, { "data-ct-act": action });
    if (label) el.setAttribute("aria-label", label);
    return el;
  };
  const titleEl = h("span", "ct-title");
  const rail = buildRail(blocks, labels);
  const threeDButton = button("3d", labels.threeD);
  const notesButton = button("notes", labels.notes);
  bar.append(button("overview", labels.overview), titleEl, rail.el, threeDButton, button("script", labels.script), notesButton, button("exit", "✕", labels.exit));
  const viewport = app.appendChild(h("main", "ct-vp"));
  const overview = buildOverview(blocks, labels);
  const stage = h("div", "ct-stage", "", { tabindex: -1 });
  const pager = h("div", "ct-pager", "", { "aria-hidden": "true" });
  const controls = h("div", "ct-ctl");
  controls.append(button("prev", "◂", labels.prev), button("next", "▸", labels.next));
  const panel = h("aside", "ct-notes", "", { "aria-label": labels.notes });
  const panelPos = panel.appendChild(h("h2"));
  const panelBody = panel.appendChild(h("div", "ct-nb"));
  const script = buildScript(blocks, labels);
  viewport.append(overview.el, stage, panel, script.el);
  const live = app.appendChild(h("div", "ct-live", "", { "aria-live": "polite" }));

  // The shell takes the deck's place in the document and the deck itself moves onto the stage: same nodes, no copy.
  const anchor = document.createComment("contour-deck");
  root.replaceWith(anchor);
  stage.append(root, pager, controls);
  anchor.after(app);
  document.documentElement.setAttribute("data-ct-open", "");
  if (options.paging === "free") app.dataset.ctPaging = "free";

  /* ---- reading the current position ---- */
  const slideAt = (at: Pos = pos) => blocks[at.b].slides[at.s];
  const pageAt = (at: Pos = pos) => slideAt(at).pages[at.p];
  const boxes = (slide: SlideNode) => slide.pages.map(page => ({ top: page.el.offsetTop, height: page.el.offsetHeight }));
  const stopsOf = (slide: SlideNode) => pageStops(boxes(slide), slide.el.clientHeight);
  const shown = (page: PageNode) => page.steps.filter(step => step.hasAttribute(ON)).length;
  const reveal = (pages: PageNode[], on: boolean) => pages.forEach(page => page.steps.forEach(step => step.toggleAttribute(ON, on)));

  function label(): string {
    const block = blocks[pos.b];
    const count = slideAt().pages.length;
    return `${block.short} · ${pos.s + 1}/${block.slides.length}${count > 1 ? ` · ${labels.page(pos.p + 1, count)}` : ""}`;
  }

  const snapshot = (): DeckState => ({ mode, block: pos.b + 1, slide: pos.s + 1, page: pos.p + 1, step: shown(pageAt()) });

  /* ---- rendering ---- */
  function setCurrent(page: PageNode | null) {
    if (page === (current?.page ?? null)) return;
    const fire = (type: string, target: { page: PageNode; at: Pos }) => {
      target.page.el.toggleAttribute("data-ct-current", type === "ct:enter");
      const detail = { block: target.at.b + 1, slide: target.at.s + 1, page: target.at.p + 1 };
      target.page.el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
    };
    if (current) fire("ct:leave", current);
    current = page && { page, at: pos };
    if (current) fire("ct:enter", current);
  }

  function writeUrl(clear = false) {
    if (!useUrl) return;
    const url = new URL(location.href);
    url.searchParams.delete("view");
    url.searchParams.delete("at");
    if (!clear) {
      url.searchParams.set("view", mode === "notes" ? "notes" : "deck");
      if (mode === "stage") url.searchParams.set("at", formatAt(pos));
    }
    if (url.href === lastUrl) return;
    lastUrl = url.href;
    try {
      history.replaceState(history.state, "", url);
    } catch {
      // Some browsers refuse replaceState on file:// or rate-limit it; the deck works without the URL.
    }
  }

  /** The part of the picture that follows vertical scrolling: the page marks. */
  function renderScroll() {
    const slide = slideAt();
    const y = slide.el.scrollTop;
    const height = slide.el.clientHeight;
    const pages = boxes(slide);
    Array.from(pager.children).forEach((mark, p) => {
      mark.toggleAttribute("data-on", p === pos.p);
      if (p === pos.p) (mark as HTMLElement).style.setProperty("--f", String(pageProgress(pages[p], y, height)));
    });
  }

  function render() {
    const slide = slideAt();
    const page = pageAt();
    app.dataset.ctMode = mode;
    overview.el.inert = mode !== "overview";
    stage.inert = mode !== "stage";
    // The title first: its width moves the rail, and the marker is placed by layout offsets.
    titleEl.textContent = mode === "stage" ? blocks[pos.b].title : deckTitle;
    rail.mark(pos);
    overview.ring(pos.b, pos.s);

    const height = slide.el.clientHeight || 1;
    const pages = boxes(slide);
    pager.replaceChildren(
      ...(pages.length > 1 || isTall(pages[0], height)
        ? pages.map(box => {
            const mark = h("i");
            mark.style.height = `${Math.round(clamp((14 * box.height) / height, 14, 46))}px`;
            return mark;
          })
        : [])
    );
    renderScroll();

    panelPos.textContent = label();
    panelBody.innerHTML = notesHtml(page);
    if (!panelBody.childNodes.length) panelBody.append(h("p", "", labels.noNotes));

    setCurrent(mode === "stage" ? page : null);
    if (mode === "notes") wakeLock ??= navigator.wakeLock?.request("screen").catch(() => {}) ?? null;
    else if (wakeLock) {
      void wakeLock.then(lock => lock?.release());
      wakeLock = null;
    }
    writeUrl();

    const state = snapshot();
    const key = JSON.stringify(state);
    if (key === lastChange) return;
    lastChange = key;
    live.textContent = mode === "stage" ? `${blocks[pos.b].title} ${label()}` : "";
    const change = { ...state, at: formatAt(pos) };
    listeners.change.forEach(listener => listener(change));
  }

  /* ---- the stage: scroll position is the source of truth for slide and page ---- */

  /** Puts a block on the stage at a slide and page (or at the slide's end), without animation. */
  function place(at: Pos, end = false) {
    pending = null;
    blocks.forEach((block, b) => block.el.toggleAttribute("data-ct-active", b === at.b));
    const block = blocks[at.b];
    const slide = block.slides[at.s];
    block.el.scrollLeft = at.s * block.el.clientWidth;
    block.slides.forEach((other, s) => {
      reveal(other.pages, s < at.s || (s === at.s && end));
      if (s !== at.s) other.el.scrollTop = 0;
    });
    if (!end) reveal(slide.pages.slice(0, at.p), true);
    slide.el.scrollTop = end ? slide.el.scrollHeight : slide.pages[at.p].el.offsetTop;
    pos = { b: at.b, s: at.s, p: end ? slide.pages.length - 1 : at.p };
  }

  /** Scroll events are read once a frame; a move that starts from the position reads it first, so it never acts on a stale one. */
  function readScroll() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (busy || mode !== "stage") return;
    const block = blocks[pos.b];
    const s = clamp(Math.round(block.el.scrollLeft / (block.el.clientWidth || 1)), 0, block.slides.length - 1);
    const slide = block.slides[s];
    if (pending) {
      // On the way to a slide the deck chose, the slides passed over are not positions.
      if (s !== pending.s) return;
      // Arrived: the slide shows the page it was sent to, even if the browser dropped the early scroll.
      const top = pending.top();
      pending = null;
      if (Math.abs(slide.el.scrollTop - top) > 1) slide.el.scrollTop = top;
    }
    const p = pageIndexAt(boxes(slide), slide.el.scrollTop, slide.el.clientHeight);
    if (s === pos.s && p === pos.p) return renderScroll();
    pos = { b: pos.b, s, p };
    render();
  }

  /**
   * Scrolling has paused. Slides off screen are put in order: later ones wait unrevealed at their top,
   * earlier ones stay revealed. A pause is not always the end: under load a smooth scroll starts late or
   * goes quiet mid-way, so while the deck's own slide change is under way nothing is reset.
   */
  function settle() {
    if (busy || mode !== "stage") return;
    const block = blocks[pos.b];
    if (pending) {
      const left = block.el.scrollLeft;
      pending.still = left === pending.left ? pending.still + 1 : 0;
      pending.left = left;
      if (pending.still < 3) return void (idle = window.setTimeout(settle, 160));
      // It stopped short of the slide it was sent to: the reader took over.
      pending = null;
      readScroll();
    }
    block.slides.forEach((slide, s) => {
      if (s > pos.s) slide.el.scrollTop = 0;
      if (s !== pos.s) reveal(slide.pages, s < pos.s);
    });
  }

  root.addEventListener(
    "scroll",
    () => {
      frame ||= requestAnimationFrame(readScroll);
      clearTimeout(idle);
      idle = window.setTimeout(settle, 160);
    },
    { capture: true, signal }
  );

  /* ---- moves ---- */

  /** One stop down or up inside the current slide; false at its end. */
  function stepV(direction: 1 | -1): boolean {
    const slide = slideAt();
    const target = nextStop(stopsOf(slide), slide.el.scrollTop, direction);
    if (target === undefined) return false;
    slide.el.scrollTo({ top: target, behavior: smooth() });
    return true;
  }

  function slideTo(s: number, end = false, p = 0) {
    const block = blocks[pos.b];
    const target = block.slides[s];
    if (s === pos.s) return target.el.scrollTo({ top: target.pages[p].el.offsetTop, behavior: smooth() });
    reveal(target.pages, s < pos.s || end);
    if (!end && s > pos.s) reveal(target.pages.slice(0, p), true);
    const top = () => (end ? target.el.scrollHeight - target.el.clientHeight : target.pages[p].el.offsetTop);
    target.el.scrollTop = top();
    pending = { s, top, left: block.el.scrollLeft, still: 0 };
    block.el.scrollTo({ left: s * block.el.clientWidth, behavior: smooth() });
    clearTimeout(idle);
    idle = window.setTimeout(settle, 160);
  }

  function slideBy(direction: 1 | -1, end = false) {
    readScroll();
    const s = pos.s + direction;
    if (blocks[pos.b].slides[s]) return slideTo(s, end);
    const b = neighbourBlock(kinds, pos.b, direction, skip);
    if (b >= 0) void fly({ b, s: direction > 0 ? 0 : blocks[b].slides.length - 1, p: 0 }, direction < 0 && end);
  }

  function next() {
    if (busy || mode === "notes") return;
    if (mode === "overview") return void open(pos);
    readScroll();
    const slide = slideAt();
    const step = pageAt().steps.find(item => !item.hasAttribute(ON));
    if (!step) return void (stepV(1) || slideBy(1));
    step.setAttribute(ON, "");
    const below = step.getBoundingClientRect().bottom - slide.el.getBoundingClientRect().bottom;
    if (below > -8) slide.el.scrollBy({ top: below + 32, behavior: smooth() });
    render();
  }

  function prev() {
    if (busy || mode !== "stage") return;
    readScroll();
    const step = pageAt().steps.findLast(item => item.hasAttribute(ON));
    if (!step) return void (stepV(-1) || slideBy(-1, true));
    step.removeAttribute(ON);
    render();
  }

  /* ---- transitions between the outline and the stage ---- */
  const setBusy = (on: boolean) => {
    busy = on;
    app.toggleAttribute("data-ct-busy", on);
  };
  const thumbRect = (at: Pos) => {
    const face = overview.faces[at.b][at.s];
    face.scrollIntoView({ block: "nearest" });
    return face.getBoundingClientRect();
  };
  const cancel = (animations: Animation[]) => animations.forEach(animation => animation.cancel());

  /** Outline to stage: the stage grows out of the slide's thumbnail. */
  async function open(at: Pos) {
    setBusy(true);
    place(at);
    overview.ring(at.b, at.s, true);
    const thumb = thumbRect(at);
    const animations = [...zoomStage(stage, root, thumb, "in", OPEN_MS, reduced()), zoomOverview(overview.el, thumb, "out", OPEN_MS, reduced())];
    await finished(animations);
    if (!alive) return;
    mode = "stage";
    render();
    setBusy(false);
    cancel(animations);
    stage.focus({ preventScroll: true });
  }

  /** Stage to outline: the stage shrinks back into its thumbnail. */
  async function close() {
    setBusy(true);
    overview.ring(pos.b, pos.s, true);
    const thumb = thumbRect(pos);
    const animations = [...zoomStage(stage, root, thumb, "out", CLOSE_MS, reduced()), zoomOverview(overview.el, thumb, "in", CLOSE_MS, reduced())];
    await finished(animations);
    if (!alive) return;
    mode = "overview";
    render();
    setBusy(false);
    cancel(animations);
    overview.thumbs[pos.b][pos.s].focus({ preventScroll: true });
  }

  /** Block change: pull back to the outline, let the ring and the rail marker travel, dive into the new block. */
  async function fly(at: Pos, end = false) {
    setBusy(true);
    overview.ring(pos.b, pos.s, true);
    const out = zoomStage(stage, root, thumbRect(pos), "out", 360, reduced());
    await finished(out);
    if (!alive) return;
    stage.style.opacity = "0";
    cancel(out);
    place(at, end);
    const thumb = thumbRect(pos);
    render();
    await wait(reduced() ? 80 : 400);
    if (!alive) return;
    const into = zoomStage(stage, root, thumb, "in", 460, reduced());
    stage.style.opacity = "";
    await finished(into);
    if (!alive) return;
    setBusy(false);
    cancel(into);
    stage.focus({ preventScroll: true });
    render();
  }

  async function goTo(target: Pos | null) {
    const at = target && fitPos(blocks, target);
    if (!at || busy) return;
    if (mode === "overview") return open(at);
    if (mode === "notes") {
      place(at);
      mode = "stage";
      render();
      return stage.focus({ preventScroll: true });
    }
    if (at.b !== pos.b) return fly(at);
    slideTo(at.s, false, at.p);
  }

  async function toOverview() {
    if (busy || mode === "overview") return;
    readScroll();
    if (mode === "stage") return close();
    mode = "overview";
    render();
  }

  function toScript() {
    if (busy) return;
    readScroll();
    mode = "notes";
    render();
    script.show(pos);
    focusLayer();
  }

  /** Puts the focus on the layer in front: the stage, the current thumbnail, or the notes script. */
  function focusLayer() {
    const target = mode === "stage" ? stage : mode === "notes" ? script.el : overview.thumbs[pos.b][pos.s];
    target.focus({ preventScroll: true });
  }

  function resolve(at: string): Pos | null {
    const numeric = parseAt(at);
    if (numeric) return fitPos(blocks, numeric);
    const target = document.getElementById(at);
    return target && root.contains(target) ? posOf(blocks, target) : null;
  }

  /* ---- input ---- */
  const press = (el: HTMLElement, on: boolean) => el.setAttribute("aria-pressed", String(on));
  const toggle3d = () => press(threeDButton, app.toggleAttribute("data-ct-3d"));

  /** The stage changed size: put the current slide and page back in view. */
  function align(p = pos.p) {
    if (busy) return;
    const block = blocks[pos.b];
    const slide = slideAt();
    pos = { ...pos, p: clamp(p, 0, slide.pages.length - 1) };
    pending = null;
    block.el.scrollLeft = pos.s * block.el.clientWidth;
    slide.el.scrollTop = slide.pages[pos.p].el.offsetTop;
    render();
  }

  function toggleNotes() {
    readScroll();
    const p = pos.p;
    press(notesButton, app.toggleAttribute("data-ct-panel"));
    align(p);
  }

  /** Leaving is the host's move: it usually answers `exit` with `destroy()`. */
  const exit = () => busy || listeners.exit.forEach(listener => listener());
  const actions: Record<string, () => unknown> = { overview: toOverview, "3d": toggle3d, script: toScript, notes: toggleNotes, prev, next, exit };

  app.addEventListener(
    "click",
    event => {
      const target = event.target as Element;
      const action = target.closest<HTMLElement>("[data-ct-act]")?.dataset.ctAct;
      if (action) return void actions[action]?.();
      const go = target.closest<HTMLElement>("[data-ct-go]")?.dataset.ctGo;
      if (!go) return;
      const [b, s, p] = go.split(",").map(Number);
      void goTo({ b, s, p });
    },
    { signal }
  );

  addEventListener(
    "resize",
    () => {
      const p = pos.p;
      requestAnimationFrame(() => alive && align(p));
    },
    { signal }
  );

  // The browser drops the screen wake lock when the page is hidden; the notes view asks again on return.
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden || !wakeLock) return;
      wakeLock = null;
      render();
    },
    { signal }
  );

  function focusThumb(step: number) {
    const all = overview.thumbs.flat();
    const focused = all.indexOf(document.activeElement as HTMLButtonElement);
    all[focused < 0 ? all.indexOf(overview.thumbs[pos.b][pos.s]) : clamp(focused + step, 0, all.length - 1)].focus();
  }

  document.addEventListener(
    "keydown",
    event => {
      const target = event.target as Element;
      if (event.metaKey || event.ctrlKey || event.altKey || busy || target.closest?.("input,textarea,select,[contenteditable]")) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const onControl = !!target.closest?.("button,a");
      const activates = key === " " || key === "Enter";
      let run: (() => unknown) | undefined;
      if (mode === "overview") {
        if (key === "3") run = toggle3d;
        else if (key === "Escape") run = exit;
        else if (key.startsWith("Arrow")) run = () => focusThumb(key === "ArrowRight" || key === "ArrowDown" ? 1 : -1);
        else if (key === "PageDown" || (activates && !onControl)) run = next;
      } else if (mode === "notes") {
        if (key === "Escape" || key === "o") run = toOverview;
      } else if (!(activates && onControl)) {
        const keys: Record<string, () => unknown> = {
          " ": event.shiftKey ? prev : next,
          Enter: next,
          PageDown: next,
          PageUp: prev,
          Backspace: prev,
          ArrowRight: () => slideBy(1),
          ArrowLeft: () => slideBy(-1),
          ArrowDown: () => stepV(1),
          ArrowUp: () => stepV(-1),
          Escape: toOverview,
          o: toOverview,
          n: toggleNotes,
          Home: () => slideTo(0),
          End: () => slideTo(blocks[pos.b].slides.length - 1),
        };
        run = keys[key];
      }
      if (!run) return;
      event.preventDefault();
      void run();
    },
    { signal }
  );

  // Wheel and trackpad: one gesture moves one stop. Touch scrolling stays native (CSS scroll snap).
  const wheelStep = createWheelGate();
  if (options.paging !== "free") {
    stage.addEventListener(
      "wheel",
      event => {
        if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return; // pinch, or a sideways swipe
        event.preventDefault();
        const step = wheelStep(event.deltaY * (event.deltaMode === 1 ? 16 : 1), performance.now(), busy);
        if (step) stepV(step);
      },
      { passive: false, signal }
    );
  }

  /* ---- start ---- */
  const params = new URLSearchParams(useUrl ? location.search : "");
  const startAt = resolve(options.at ?? params.get("at") ?? "");
  const startView = options.view ?? (params.get("view") === "notes" ? "notes" : "deck");
  place(startAt ?? pos);
  if (startView === "notes") mode = "notes";
  else if (startAt) mode = "stage";
  if (options.overview === "3d") toggle3d();
  render();
  if (mode === "notes") script.show(pos);
  // Focus moves into the shell, so the keys reach the deck and not the control that opened it.
  focusLayer();

  function destroy() {
    if (!alive) return;
    alive = false;
    abort.abort();
    cancelAnimationFrame(frame);
    clearTimeout(idle);
    setCurrent(null);
    void wakeLock?.then(lock => lock?.release());
    for (const block of blocks) {
      block.el.removeAttribute("data-ct-active");
      for (const slide of block.slides) reveal(slide.pages, false);
    }
    cancel(root.getAnimations());
    anchor.replaceWith(root);
    app.remove();
    document.documentElement.removeAttribute("data-ct-open");
    writeUrl(true);
  }

  return {
    overview: toOverview,
    open: at => goTo(resolve(at)),
    go: at => goTo(resolve(at)),
    next,
    prev,
    on(type: "change" | "exit", listener: ((change: DeckChange) => void) | (() => void)) {
      const set = listeners[type] as Set<typeof listener>;
      set.add(listener);
      return () => set.delete(listener);
    },
    get state() {
      return snapshot();
    },
    destroy,
  };
}
