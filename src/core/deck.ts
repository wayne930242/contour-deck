/** createDeck: builds the shell around a contract deck and wires the stage, the outline, and the input. */
import { createBackgrounds } from "./background.js";
import { clamp, h } from "./dom.js";
import { createWheelGate } from "./gestures.js";
import { defaultLabels } from "./labels.js";
import { fitPos, formatAt, parseAt, posOf, readModel } from "./model.js";
import type { PageNode, Pos, SlideNode } from "./model.js";
import { mainRange, neighbourBlock } from "./navigator.js";
import { buildScript, notesHtml } from "./notes.js";
import { buildOverview } from "./overview.js";
import { buildRail } from "./rail.js";
import { isTall, nextStop, pageIndexAt, pageProgress, pageStops } from "./stops.js";
import { finished, liftStage, riseOverview, zoomOverview, zoomStage } from "./transitions.js";
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
  // An opening first block and a closing last block stand outside the outline and the rail: `first` to `last` is the talk's map.
  const { first, last } = mainRange(kinds);
  const framed = (b: number) => b < first || b > last;
  /** Where the outline stands when the stage leaves a framing block: the talk's first slide, or from the closing the last slide ← goes back to. */
  const mapped = (at: Pos): Pos => {
    if (at.b < first) return { b: first, s: 0, p: 0 };
    if (at.b <= last) return at;
    const b = Math.max(first, neighbourBlock(kinds, at.b, -1, skip));
    return { b, s: blocks[b].slides.length - 1, p: 0 };
  };
  const useUrl = options.url !== false;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => motion.matches;
  const smooth = (): ScrollBehavior => (reduced() ? "auto" : "smooth");
  const backgrounds = createBackgrounds(reduced);
  const abort = new AbortController();
  const { signal } = abort;
  const listeners = { change: new Set<(change: DeckChange) => void>(), exit: new Set<() => void>(), destroy: new Set<() => void>() };

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
  /** The depth desk: the row the camera is headed for, and the camera move under way. */
  let aim = first;
  let move = 0;
  let endMove: (() => void) | null = null;

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
  bar.append(button("overview", labels.overview), titleEl, rail.el, threeDButton, button("script", labels.script), notesButton);
  if (options.remote) bar.append(button("remote", labels.remote));
  bar.append(button("exit", "✕", labels.exit));
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
    backgrounds.show(page?.el ?? null);
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
    if (mode === "stage") overview.seen(pos.b, pos.s);
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
    // Past the opening's last slide the talk begins on the outline.
    if (direction > 0 && pos.b < first) return void leave(mapped(pos));
    const b = neighbourBlock(kinds, pos.b, direction, skip);
    if (b < 0) return;
    const at = { b, s: direction > 0 ? 0 : blocks[b].slides.length - 1, p: 0 };
    void (framed(b) || framed(pos.b) ? cut(at, direction < 0 && end) : fly(at, direction < 0 && end));
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

  /** The arrow keys: reveal or hide the current page's steps first, then move to the next or previous slide. */
  function stepOrSlide(direction: 1 | -1) {
    readScroll();
    const steps = pageAt().steps;
    const pending = direction > 0 ? steps.some(item => !item.hasAttribute(ON)) : steps.some(item => item.hasAttribute(ON));
    if (pending) return direction > 0 ? next() : prev();
    slideBy(direction);
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
  /** While a transition runs the stage and the outline both show; `cut`: a move between two slides, which keeps the outline hidden. */
  const setBusy = (on: boolean, cut = false) => {
    busy = on;
    app.toggleAttribute("data-ct-busy", on);
    app.toggleAttribute("data-ct-cut", on && cut);
  };
  const thumbRect = (at: Pos) => {
    const face = overview.faces[at.b][at.s];
    if (!depthOn()) {
      face.scrollIntoView({ block: "nearest" });
      return face.getBoundingClientRect();
    }
    // On the depth desk the block's row comes to the front at once, and the rectangle is read where its sheets end up.
    front(at.b, true);
    const plane = face.closest<HTMLElement>(".ct-plane")!;
    plane.setAttribute("data-ct-still", "");
    const rect = face.getBoundingClientRect();
    plane.removeAttribute("data-ct-still");
    return rect;
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
    let thumb: DOMRect;
    if (depthOn()) {
      // On the depth desk the camera moves forward to the new block's row, then the stage grows out of it.
      render();
      await front(pos.b);
      if (!alive) return;
      thumb = thumbRect(pos);
      await wait(reduced() ? 80 : 160);
    } else {
      thumb = thumbRect(pos);
      render();
      await wait(reduced() ? 80 : 400);
    }
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

  /*
   * The opening and the closing have no thumbnail to zoom from or into: the stage lifts in out of a slight
   * scale-down and sinks back into one, and the outline rises in behind it or drops away.
   */
  const LIFT_IN_MS = 420;
  const SINK_MS = 260;

  /** Stage to stage where either block is the opening or the closing: the stage sinks away, then lifts in on the new slide. */
  async function cut(at: Pos, end = false) {
    setBusy(true, true);
    const out = liftStage(stage, "out", SINK_MS, reduced());
    await finished([out]);
    if (!alive) return;
    place(at, end);
    render();
    const into = liftStage(stage, "in", LIFT_IN_MS, reduced());
    out.cancel();
    await finished([into]);
    if (!alive) return;
    into.cancel();
    setBusy(false);
    stage.focus({ preventScroll: true });
    render();
  }

  /** From the opening or the closing to the outline: the stage sinks while the outline rises in, focus on the talk's thumbnail at `at`. */
  async function leave(at: Pos) {
    setBusy(true);
    overview.ring(at.b, at.s, true);
    if (depthOn()) front(at.b, true);
    const animations = [liftStage(stage, "out", SINK_MS, reduced()), riseOverview(overview.el, "in", LIFT_IN_MS, reduced())];
    await finished(animations);
    if (!alive) return;
    place(at);
    mode = "overview";
    render();
    setBusy(false);
    cancel(animations);
    overview.thumbs[pos.b][pos.s].focus({ preventScroll: true });
  }

  /** From the outline to the opening or the closing: the outline drops away while the stage lifts in. */
  async function enter(at: Pos) {
    place(at);
    setBusy(true);
    const animations = [riseOverview(overview.el, "out", SINK_MS, reduced()), liftStage(stage, "in", LIFT_IN_MS, reduced())];
    await finished(animations);
    if (!alive) return;
    mode = "stage";
    render();
    setBusy(false);
    cancel(animations);
    stage.focus({ preventScroll: true });
  }

  async function goTo(target: Pos | null) {
    const at = target && fitPos(blocks, target);
    if (!at || busy) return;
    if (mode === "overview") return framed(at.b) ? enter(at) : open(at);
    if (mode === "notes") {
      place(at);
      mode = "stage";
      render();
      return stage.focus({ preventScroll: true });
    }
    if (at.b !== pos.b) return framed(at.b) || framed(pos.b) ? cut(at) : fly(at);
    slideTo(at.s, false, at.p);
  }

  async function toOverview() {
    if (busy || mode === "overview") return;
    readScroll();
    if (mode === "stage") return framed(pos.b) ? leave(mapped(pos)) : close();
    if (framed(pos.b)) place(mapped(pos));
    mode = "overview";
    if (depthOn()) front(pos.b, true);
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
  const depthOn = () => app.hasAttribute("data-ct-3d");

  function toggle3d() {
    const on = app.toggleAttribute("data-ct-3d");
    press(threeDButton, on);
    stopMove();
    overview.depth(on);
    if (on) front(pos.b, true);
    else {
      overview.el.scrollTop = 0;
      overview.faces[pos.b][pos.s].scrollIntoView({ block: "nearest" });
    }
  }

  function stopMove() {
    cancelAnimationFrame(move);
    move = 0;
    endMove?.();
    endMove = null;
  }

  /** Brings a block's row to the front of the depth desk: the camera glides there, or jumps under reduced motion. */
  function front(b: number, instant = reduced()): Promise<void> {
    b = clamp(b, first, last);
    if (move && aim === b && !instant) return Promise.resolve();
    stopMove();
    aim = b;
    const ov = overview.el;
    const from = overview.camera();
    // The camera counts rows; an opening block has none, so block `first` stands at row 0.
    const row = b - first;
    if (instant || from === row) {
      overview.camera(row);
      ov.scrollTop = row * overview.step;
      return Promise.resolve();
    }
    const started = performance.now();
    const ms = clamp(240 + 80 * Math.abs(row - from), 240, 640);
    return new Promise(resolve => {
      endMove = resolve;
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / ms);
        overview.camera(from + (row - from) * (1 - (1 - t) ** 3));
        if (t < 1) return void (move = requestAnimationFrame(tick));
        move = 0;
        endMove = null;
        ov.scrollTop = row * overview.step;
        resolve();
      };
      move = requestAnimationFrame(tick);
    });
  }

  /** A row on the depth desk, with the focus on its first thumbnail, or on the current one in the current block. */
  function toRow(b: number) {
    b = clamp(b, first, last);
    overview.thumbs[b][b === pos.b ? pos.s : 0].focus({ preventScroll: true });
    void front(b);
  }

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
  const remote = () => options.remote?.(api);
  const actions: Record<string, () => unknown> = { overview: toOverview, "3d": toggle3d, script: toScript, notes: toggleNotes, remote, prev, next, exit };

  /** The row in front when the pointer went down: the focus that follows may already be bringing another row forward. */
  let pressed: number | null = null;
  overview.el.addEventListener("pointerdown", () => void (pressed = aim), { capture: true, signal });

  app.addEventListener(
    "click",
    event => {
      const target = event.target as Element;
      const action = target.closest<HTMLElement>("[data-ct-act]")?.dataset.ctAct;
      if (action) return void actions[action]?.();
      // On the depth desk a click on a row behind brings it to the front; only the row in front opens.
      const row = mode === "overview" && depthOn() ? overview.rowOf(target) : -1;
      const wasFront = pressed ?? aim;
      pressed = null;
      if (row >= 0 && row !== wasFront) return void front(row);
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
      requestAnimationFrame(() => {
        if (!alive) return;
        if (depthOn()) {
          overview.depth(true);
          front(aim, true);
        }
        align(p);
      });
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
    // On the flat outline the entries to the opening and the closing stand before the first thumbnail and after the last.
    const { opening, closing } = depthOn() ? {} : overview.entries;
    const all = [...(opening ? [opening] : []), ...overview.thumbs.slice(first, last + 1).flat(), ...(closing ? [closing] : [])];
    const focused = all.indexOf(document.activeElement as HTMLButtonElement);
    all[focused < 0 ? all.indexOf(overview.thumbs[pos.b][pos.s]) : clamp(focused + step, 0, all.length - 1)].focus({ preventScroll: depthOn() });
  }

  // On the depth desk the focus brings its row to the front: Tab, the arrow keys, a click.
  overview.el.addEventListener(
    "focusin",
    event => {
      const row = depthOn() ? overview.rowOf(event.target as Element) : -1;
      if (row >= 0 && row !== aim) void front(row);
    },
    { signal }
  );

  // Native scrolling (touch, the scroll bar) moves the camera; one snap stop per row.
  overview.el.addEventListener(
    "scroll",
    () => {
      if (!depthOn() || move) return;
      const at = overview.el.scrollTop / overview.step;
      const row = Math.round(at);
      overview.camera(Math.abs(at - row) < 0.02 ? row : at);
      aim = clamp(row + first, first, last);
    },
    { passive: true, signal }
  );

  document.addEventListener(
    "keydown",
    event => {
      pressed = null;
      const target = event.target as Element;
      if (event.metaKey || event.ctrlKey || event.altKey || busy || target.closest?.("input,textarea,select,[contenteditable]")) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const onControl = !!target.closest?.("button,a");
      const activates = key === " " || key === "Enter";
      let run: (() => unknown) | undefined;
      if (key === "r" && options.remote && mode !== "notes") run = remote;
      else if (mode === "overview") {
        const rows = depthOn();
        if (key === "3") run = toggle3d;
        else if (key === "Escape") run = exit;
        else if (rows && (key === "ArrowUp" || key === "ArrowDown")) run = () => toRow(aim + (key === "ArrowDown" ? 1 : -1));
        else if (rows && (key === "Home" || key === "End")) run = () => toRow(key === "Home" ? first : last);
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
          ArrowRight: () => stepOrSlide(1),
          ArrowLeft: () => stepOrSlide(-1),
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

  // The depth desk: one wheel gesture moves one row.
  const rowStep = createWheelGate();
  overview.el.addEventListener(
    "wheel",
    event => {
      if (!depthOn() || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const step = rowStep(event.deltaY * (event.deltaMode === 1 ? 16 : 1), performance.now(), busy);
      if (step) toRow(aim + step);
    },
    { passive: false, signal }
  );

  /* ---- start ---- */
  const params = new URLSearchParams(useUrl ? location.search : "");
  const startAt = resolve(options.at ?? params.get("at") ?? "");
  const startView = options.view ?? (params.get("view") === "notes" ? "notes" : "deck");
  place(startAt ?? pos);
  if (startView === "notes") mode = "notes";
  else if (startAt) mode = "stage";
  // A deck with an opening opens on its title pages, not on the outline.
  else if (first > 0) mode = "stage";
  if (options.overview === "3d") toggle3d();
  render();
  // Opening on the title pages: the stage lifts in, with no outline before it.
  if (mode === "stage" && framed(pos.b)) {
    const lift = liftStage(stage, "in", LIFT_IN_MS, reduced());
    void finished([lift]).then(() => lift.cancel());
  }
  if (mode === "notes") script.show(pos);
  // Focus moves into the shell, so the keys reach the deck and not the control that opened it.
  focusLayer();

  function destroy() {
    if (!alive) return;
    alive = false;
    listeners.destroy.forEach(listener => listener());
    abort.abort();
    stopMove();
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

  const onStage = (move: () => unknown) => void (busy || mode !== "stage" || move());
  const api: Deck = {
    overview: toOverview,
    open: at => goTo(resolve(at)),
    go: at => goTo(resolve(at)),
    next,
    prev,
    slideBy: direction => onStage(() => slideBy(direction)),
    pageBy: direction => onStage(() => stepV(direction)),
    on(type: "change" | "exit" | "destroy", listener: ((change: DeckChange) => void) | (() => void)) {
      const set = listeners[type] as Set<typeof listener>;
      set.add(listener);
      return () => set.delete(listener);
    },
    get state() {
      return snapshot();
    },
    destroy,
  };
  return api;
}
