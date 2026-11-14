/**
 * The presenter window, `?view=presenter&room=…`: a second window of the same browser that follows the deck
 * over BroadcastChannel and shows the current page, what comes next, the notes, and the clocks.
 */
import { h } from "../core/dom.js";
import { defaultLabels } from "../core/labels.js";
import { notesHtml } from "../core/notes.js";
import { createGuest } from "./guest.js";
import { defaultRemoteLabels } from "./labels.js";
import type { Command } from "./protocol.js";
import type { RemoteViewOptions, RemoteView } from "./phone.js";
import { injectStyle } from "./style.js";
import { broadcast } from "./transport.js";
import { createPreview, createTimers, keepAwake, pageAt, positionLabel, readOutline, statePos, upNext } from "./view.js";

/** The keys of the deck, as commands. */
const KEYS: Record<string, Command> = {
  " ": "next",
  Enter: "next",
  PageDown: "next",
  PageUp: "prev",
  Backspace: "prev",
  ArrowRight: "slideNext",
  ArrowLeft: "slidePrev",
  ArrowDown: "pageNext",
  ArrowUp: "pagePrev",
  Escape: "overview",
  o: "overview",
};

/** The arrow keys reveal or hide the current page's steps before they move to another slide, as on the deck. */
function arrowStep(key: string, state: { mode: string; step: number; steps: number } | null): Command | undefined {
  if (!state || state.mode !== "stage") return undefined;
  if (key === "ArrowRight" && state.step < state.steps) return "next";
  if (key === "ArrowLeft" && state.step > 0) return "prev";
  return undefined;
}

export function presenterView(root: HTMLElement, options: RemoteViewOptions = {}): RemoteView {
  injectStyle(options.nonce);
  const labels = { ...defaultRemoteLabels, ...options.labels };
  const outline = readOutline(root, options.skip);
  const room = options.room ?? new URLSearchParams(location.search).get("room") ?? "";
  const abort = new AbortController();
  const { signal } = abort;

  const app = h("div", "ct-app ct-pr", "", { "data-ct-mode": "stage", "data-ct-wait": "" });
  const top = app.appendChild(h("header", "ct-pr-top"));
  const position = h("span", "ct-rmt-pos", labels.noDeck);
  const timers = createTimers(labels, outline);
  const button = (command: Command, text: string) => h("button", "ct-btn", text, { "data-ct-do": command });
  top.append(button("prev", defaultLabels.prev), button("next", defaultLabels.next), button("overview", defaultLabels.overview), position, timers.block, timers.time);

  function cell(title: string, next = false) {
    const el = app.appendChild(h("section", "ct-pr-cell"));
    if (next) el.setAttribute("data-next", "");
    const head = el.appendChild(h("h2", "", title));
    const caption = head.appendChild(h("span"));
    const preview = createPreview(root);
    el.appendChild(h("div", "ct-pr-box")).append(preview.el);
    return { preview, caption };
  }
  const now = cell(labels.now);
  const coming = cell(labels.upNext, true);
  const notes = app.appendChild(h("div", "ct-pr-notes"));
  root.after(app);
  document.documentElement.setAttribute("data-ct-open", "");
  keepAwake(signal);

  const guest = createGuest({ room, open: () => broadcast(room), trusted: true });
  let drawnPage = "";

  function draw() {
    const { state } = guest;
    app.toggleAttribute("data-ct-wait", !state);
    if (!state) return;
    timers.draw(state, guest.stateAt);
    app.style.setProperty("--ct-ratio", String(state.ratio ?? 16 / 9));
    const pos = statePos(outline, state);
    if (!pos) return;
    const overview = state.mode === "overview";
    position.textContent = (overview ? `${labels.inOverview} · ` : "") + positionLabel(outline, pos, state);
    const page = pageAt(outline, pos);
    now.preview.show(page, state.step, { width: state.width, scroll: state.scroll });
    now.caption.textContent = outline.blocks[pos.b].slides[pos.s].title;
    const up = upNext(outline, pos, state.step);
    const kinds = { step: labels.nextStep, page: labels.nextPage, slide: labels.nextSlide, end: labels.theEnd };
    coming.preview.show(up.kind === "end" ? null : pageAt(outline, up.pos), up.step, { width: state.width });
    coming.caption.textContent = up.kind === "end" ? kinds.end : `${kinds[up.kind]}｜${up.text}`;
    if (state.at === drawnPage) return;
    drawnPage = state.at;
    notes.scrollTop = 0;
    notes.innerHTML = notesHtml(page);
    if (!notes.childNodes.length) notes.append(h("p", "", defaultLabels.noNotes));
  }

  app.addEventListener(
    "click",
    event => {
      const command = (event.target as Element).closest<HTMLElement>("[data-ct-do]")?.dataset.ctDo;
      if (command) guest.command(command as Command);
    },
    { signal }
  );
  document.addEventListener(
    "keydown",
    event => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const onButton = !!(event.target as Element).closest?.("button,a");
      if (onButton && (key === " " || key === "Enter")) return;
      const command = key === " " && event.shiftKey ? "prev" : arrowStep(key, guest.state) ?? KEYS[key];
      if (!command) return;
      event.preventDefault();
      guest.command(command);
    },
    { signal }
  );

  // The mouse over the current page is the laser pointer on the deck.
  const sheet = now.preview.el;
  const aim = (event: PointerEvent, on: boolean) => {
    const box = sheet.getBoundingClientRect();
    guest.point((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height, on);
  };
  sheet.addEventListener("pointermove", event => aim(event, true), { signal });
  sheet.addEventListener("pointerleave", event => aim(event, false), { signal });

  const stop = guest.subscribe(draw);
  const ticking = window.setInterval(() => timers.draw(guest.state, guest.stateAt), 500);
  draw();

  return {
    destroy() {
      abort.abort();
      stop();
      clearInterval(ticking);
      guest.close();
      now.preview.destroy();
      coming.preview.destroy();
      app.remove();
      document.documentElement.removeAttribute("data-ct-open");
    },
  };
}
