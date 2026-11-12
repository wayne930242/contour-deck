/**
 * The phone remote, `?view=remote&room=…`: the same page as the deck, showing its own notes and a small
 * copy of the current page, and sending commands, the pointer, ink, and tilt to the deck through the relay.
 */
import { h } from "../core/dom.js";
import { defaultLabels } from "../core/labels.js";
import { notesHtml } from "../core/notes.js";
import { createGuest } from "./guest.js";
import type { Stroke } from "./guest.js";
import { createInk } from "./ink.js";
import { defaultRemoteLabels } from "./labels.js";
import { pageLink } from "./links.js";
import { isRoom } from "./protocol.js";
import type { Command } from "./protocol.js";
import { createSensor } from "./sensor.js";
import type { RemoteOptions } from "./session.js";
import { load, save, TILT_KEY } from "./store.js";
import { injectStyle } from "./style.js";
import { calibrate, CALIBRATION_TARGETS, createPointer, defaultCalibration, isCalibration, meanAim } from "./tilt.js";
import type { Aim, CalibrationTarget, Point, Pointer } from "./tilt.js";
import { relay } from "./transport.js";
import { createPreview, createTimers, keepAwake, pageAt, positionLabel, readOutline, statePos, upNext } from "./view.js";

export interface RemoteViewOptions extends RemoteOptions {
  /** The room to join. Default: the `room` query parameter. */
  room?: string;
}

export interface RemoteView {
  /** Closes the connection and removes the view; the page is a document again. */
  destroy(): void;
}

type Tab = "notes" | "pointer" | "ink" | "tilt";
type TiltState = "off" | "on" | "denied" | "unsupported";

/** Where each calibration target sits on the screen. */
const TARGET_AT: Record<CalibrationTarget, Point> = {
  centre: { x: 0.5, y: 0.5 },
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};
/** Readings averaged for one calibration sample: about a tenth of a second. */
const STEADY = 6;
/** Ink points closer than this to the last one are not sent. */
const INK_STEP = 0.004;

export function remoteView(root: HTMLElement, options: RemoteViewOptions = {}): RemoteView {
  injectStyle(options.nonce);
  const labels = { ...defaultRemoteLabels, ...options.labels };
  const outline = readOutline(root, options.skip);
  const room = options.room ?? new URLSearchParams(location.search).get("room");
  const abort = new AbortController();
  const { signal } = abort;

  /* ---- shell ---- */
  const app = h("div", "ct-app ct-rmt", "", { "data-ct-mode": "stage", "data-ct-phase": "connecting", "data-ct-tab": "notes" });
  const button = (action: string, text: string, primary = false) => {
    const el = h("button", "ct-btn", text, { "data-ct-do": action });
    if (primary) el.setAttribute("data-ct-primary", "");
    return el;
  };

  // Before control: one card with the state of the pairing, and the way to the notes that needs no connection.
  const card = app.appendChild(h("div", "ct-rmt-card"));
  const cardBadge = card.appendChild(h("span", "ct-badge"));
  const cardCode = card.appendChild(h("b", "ct-rmt-code"));
  const cardText = card.appendChild(h("p", "", "", { "aria-live": "polite" }));
  const retry = card.appendChild(button("retry", labels.retry, true));
  card.append(h("a", "ct-btn", labels.notesOnly, { href: pageLink("notes") }));

  const top = app.appendChild(h("header", "ct-rmt-top"));
  const status = h("span", "ct-badge ct-rmt-st");
  const position = h("span", "ct-rmt-pos");
  const timers = createTimers(labels, outline);
  top.append(status, position, timers.time, timers.block);

  const tabs = app.appendChild(h("nav", "ct-rmt-tabs"));
  const tabNames: [Tab, string][] = [
    ["notes", labels.tabNotes],
    ["pointer", labels.tabPointer],
    ["ink", labels.tabInk],
    ["tilt", labels.tabTilt],
  ];
  const tabButtons = tabNames.map(([name, text]) => tabs.appendChild(button(`tab:${name}`, text)));

  const main = app.appendChild(h("main", "ct-rmt-main"));
  const notes = main.appendChild(h("div", "ct-rmt-notes"));
  const padBox = main.appendChild(h("div", "ct-rmt-padbox"));
  const pad = padBox.appendChild(h("div", "ct-rmt-pad"));
  const preview = createPreview(root);
  const canvas = h("canvas", "ct-ink");
  const dot = h("i", "ct-rmt-dot");
  pad.append(preview.el, canvas, dot);
  const ink = createInk(canvas);
  const tools = main.appendChild(h("div", "ct-rmt-tools"));
  const hint = tools.appendChild(h("p", "", "", { "aria-live": "polite" }));
  const hold = button("hold", labels.tiltHold);
  hold.classList.add("ct-rmt-hold");
  const toolButtons: [string, HTMLElement][] = [
    ["ink", button("clear", labels.clearInk)],
    ["tilt-off", button("tilt", labels.tiltEnable, true)],
    ["tilt-on", hold],
    ["tilt-on", button("recentre", labels.tiltRecentre)],
    ["tilt-on", button("calibrate", labels.tiltCalibrate)],
    ["tilt-cal", button("aimed", labels.tiltAimed, true)],
    ["tilt-cal", button("cancel", labels.tiltCancel)],
  ];
  for (const [when, el] of toolButtons) {
    el.dataset.for = when;
    tools.append(el);
  }

  const next = app.appendChild(h("div", "ct-rmt-next"));
  const nextKind = next.appendChild(h("span", "ct-meta", labels.upNext));
  const nextText = next.appendChild(h("span"));
  const nav = app.appendChild(h("nav", "ct-rmt-nav"));
  nav.append(
    button("cmd:prev", defaultLabels.prev),
    button("cmd:slidePrev", labels.slidePrev),
    button("cmd:slideNext", labels.slideNext),
    button("cmd:overview", defaultLabels.overview)
  );
  const go = app.appendChild(button("cmd:next", defaultLabels.next, true));
  go.classList.add("ct-rmt-go");

  root.after(app);
  document.documentElement.setAttribute("data-ct-open", "");
  keepAwake(signal);

  /* ---- connection ---- */
  const relayBase = options.relay;
  const guest = relayBase && isRoom(room) ? createGuest({ room, open: () => relay(relayBase, { room, role: "guest" }) }) : null;

  let tab: Tab = "notes";
  let drawnPage = "";
  let tilt: TiltState = "off";
  let pointer: Pointer | null = null;
  let calibrated = false;
  let calibrating: { index: number; aims: Partial<Record<CalibrationTarget, Aim>> } | null = null;
  let pointing = false;
  let tiltNote = "";
  let lastPoint: Point = { x: 0.5, y: 0.5 };
  const recent: Aim[] = [];

  const kept = load(TILT_KEY);
  if (isCalibration(kept)) {
    pointer = createPointer(kept);
    calibrated = true;
  }

  function showDot(point: Point, on: boolean, target = false) {
    dot.style.transform = `translate(${point.x * pad.clientWidth}px,${point.y * pad.clientHeight}px)`;
    dot.toggleAttribute("data-on", on);
    dot.toggleAttribute("data-target", target);
  }

  /** The laser on the deck and its twin on the pad. */
  function point(at: Point, on: boolean) {
    lastPoint = at;
    guest?.point(at.x, at.y, on);
    showDot(at, on);
  }

  /* ---- drawing what the guest knows ---- */
  function drawCard() {
    if (!guest) {
      cardBadge.textContent = labels.title;
      cardText.textContent = labels.badLink;
      cardCode.hidden = retry.hidden = true;
      return "denied";
    }
    const { phase, closeCode } = guest;
    cardCode.hidden = phase !== "pairing";
    cardCode.textContent = guest.code;
    // A full room is not retried by itself: each try counts against the relay's limit for this network.
    retry.hidden = phase !== "denied" && phase !== "revoked" && !(phase === "offline" && closeCode === 4029);
    cardBadge.textContent = phase === "pairing" ? labels.code : phase === "offline" ? labels.offline : labels.title;
    cardText.textContent =
      phase === "pairing"
        ? labels.pairHint
        : phase === "denied"
          ? labels.denied
          : phase === "revoked"
            ? labels.revoked
            : phase === "offline" && (closeCode === 4004 || closeCode === 4000)
              ? labels.noHost
              : phase === "offline" && closeCode === 4029
                ? labels.full
                : labels.connecting;
    return phase;
  }

  function drawTools() {
    const state = guest?.state;
    const shown: Tab = state?.mode === "overview" ? "notes" : tab;
    app.dataset.ctTab = shown;
    tabButtons.forEach((el, i) => el.setAttribute("aria-pressed", String(tabNames[i][0] === shown)));
    const mode = shown !== "tilt" ? shown : calibrating ? "tilt-cal" : tilt === "on" ? "tilt-on" : "tilt-off";
    for (const [when, el] of toolButtons) el.toggleAttribute("data-show", when === mode);
    hold.setAttribute("aria-pressed", String(pointing));
    if (shown === "pointer") hint.textContent = labels.pointerHint;
    else if (shown === "ink") hint.textContent = labels.inkHint;
    else if (shown !== "tilt") hint.textContent = "";
    else if (calibrating) {
      const target = CALIBRATION_TARGETS[calibrating.index];
      hint.textContent = labels.tiltAim(labels.tiltTargets[target], calibrating.index + 1, CALIBRATION_TARGETS.length);
    } else if (tilt === "denied") hint.textContent = labels.tiltDenied;
    else if (tilt === "unsupported") hint.textContent = labels.tiltUnsupported;
    else hint.textContent = tiltNote || (tilt === "on" ? (calibrated ? labels.tiltCalibrated : labels.tiltUncalibrated) : "");
  }

  function draw() {
    app.dataset.ctPhase = drawCard();
    const state = guest?.state;
    if (!guest || guest.phase !== "granted" || !state) {
      status.textContent = labels.connecting;
      return;
    }
    status.textContent = labels.connected;
    status.dataset.st = "granted";
    timers.draw(state, guest.stateAt);
    if (state.ratio) app.style.setProperty("--ct-ratio", String(state.ratio));
    const pos = statePos(outline, state);
    position.textContent = !pos || state.mode === "overview" ? labels.inOverview : positionLabel(outline, pos, state);
    const key = `${state.mode} ${state.at}`;
    if (key !== drawnPage) {
      drawnPage = key;
      // A new page: its notes from the top, and the ink of the old one gone, as on the deck.
      ink.clear();
      notes.scrollTop = 0;
      if (state.mode === "overview") {
        const list = h("ul", "ct-rmt-list");
        outline.blocks.forEach((block, b) => {
          const open = list.appendChild(h("li")).appendChild(button(`open:${b + 1}`, ""));
          if (pos?.b === b) open.setAttribute("aria-current", "true");
          open.append(h("span", "ct-meta", block.short), h("span", "", block.title));
          if (block.minutes) open.append(h("span", "ct-meta", defaultLabels.minutes(block.minutes)));
        });
        notes.replaceChildren(list);
      } else if (pos) {
        notes.innerHTML = notesHtml(pageAt(outline, pos));
        if (!notes.childNodes.length) notes.append(h("p", "", defaultLabels.noNotes));
      }
    }
    if (pos) {
      preview.show(pageAt(outline, pos), state.step);
      const up = upNext(outline, pos, state.step);
      const kinds = { step: labels.nextStep, page: labels.nextPage, slide: labels.nextSlide, end: labels.theEnd };
      // On the outline the step button opens the slide the deck is on.
      const outside = state.mode === "overview";
      nextKind.textContent = outside ? labels.upNext : `${labels.upNext}｜${kinds[up.kind]}`;
      nextText.textContent = outside ? outline.blocks[pos.b].slides[pos.s].title : up.text;
    }
    drawTools();
  }

  /* ---- pad: pointer and ink ---- */
  let finger = -1;
  let stroke: Stroke | null = null;
  let strokeKey = "";
  let strokes = 0;
  let inked: Point = { x: -1, y: -1 };

  const onPad = (event: PointerEvent): Point => {
    const box = pad.getBoundingClientRect();
    const unit = (value: number) => Math.min(1, Math.max(0, value));
    return { x: unit((event.clientX - box.left) / box.width), y: unit((event.clientY - box.top) / box.height) };
  };
  function inkTo(at: Point) {
    if (Math.hypot(at.x - inked.x, at.y - inked.y) < INK_STEP) return;
    inked = at;
    stroke?.add(at.x, at.y);
    ink.add(strokeKey, [at.x, at.y]);
  }
  pad.addEventListener(
    "pointerdown",
    event => {
      if (finger !== -1 || (tab !== "pointer" && tab !== "ink") || guest?.phase !== "granted") return;
      finger = event.pointerId;
      pad.setPointerCapture(finger);
      const at = onPad(event);
      if (tab === "pointer") return point(at, true);
      stroke = guest.stroke();
      strokeKey = `own:${++strokes}`;
      inked = { x: -1, y: -1 };
      inkTo(at);
    },
    { signal }
  );
  pad.addEventListener(
    "pointermove",
    event => {
      if (event.pointerId !== finger) return;
      if (!stroke) return point(onPad(event), true);
      for (const sample of event.getCoalescedEvents?.() ?? [event]) inkTo(onPad(sample));
    },
    { signal }
  );
  const lift = (event: PointerEvent) => {
    if (event.pointerId !== finger) return;
    finger = -1;
    if (stroke) stroke.end();
    else point(lastPoint, false);
    stroke = null;
  };
  pad.addEventListener("pointerup", lift, { signal });
  pad.addEventListener("pointercancel", lift, { signal });
  const padSize = new ResizeObserver(() => ink.resize());
  padSize.observe(pad);

  /* ---- tilt ---- */
  const sensor = createSensor((aim, t) => {
    recent.push(aim);
    if (recent.length > STEADY) recent.shift();
    if (!pointing || calibrating) return;
    // Without a calibration, the direction of the first press is the middle of a screen of ordinary size.
    pointer ??= createPointer(defaultCalibration(aim));
    point(pointer.update(aim, t), true);
  });

  function stopPointing() {
    if (!pointing) return;
    pointing = false;
    point(lastPoint, false);
    // Drift correction moved the calibration while pointing; a measured one is worth keeping.
    if (calibrated && pointer) save(TILT_KEY, pointer.calibration);
    drawTools();
  }
  hold.addEventListener(
    "pointerdown",
    event => {
      if (tilt !== "on") return;
      hold.setPointerCapture(event.pointerId);
      pointing = true;
      tiltNote = "";
      drawTools();
    },
    { signal }
  );
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) hold.addEventListener(type, stopPointing, { signal });

  function aimAtTarget() {
    if (!calibrating) return;
    const at = TARGET_AT[CALIBRATION_TARGETS[calibrating.index]];
    // The deck shows the dot on the spot to aim at; the pad marks the same spot.
    guest?.point(at.x, at.y, true);
    showDot(at, false, true);
    drawTools();
  }
  function endCalibration(note: string) {
    calibrating = null;
    tiltNote = note;
    point(TARGET_AT.centre, false);
    drawTools();
  }

  const actions: Record<string, (value: string) => unknown> = {
    cmd(c) {
      guest?.command(c as Command);
      navigator.vibrate?.(8);
    },
    open: at => guest?.command("open", at),
    tab(name) {
      if (tab === "tilt" && name !== "tilt") {
        stopPointing();
        if (calibrating) endCalibration("");
      }
      tab = name as Tab;
      point(lastPoint, false);
      drawTools();
      ink.resize();
    },
    clear() {
      ink.clear();
      guest?.clearInk();
    },
    retry: () => guest?.retry(),
    async tilt() {
      const result = await sensor.start();
      tilt = result === "ok" ? "on" : result;
      drawTools();
    },
    recentre() {
      if (!pointer || !recent.length) return;
      pointer.recentre(meanAim(recent));
      if (calibrated) save(TILT_KEY, pointer.calibration);
    },
    calibrate() {
      stopPointing();
      calibrating = { index: 0, aims: {} };
      aimAtTarget();
    },
    aimed() {
      if (!calibrating || !recent.length) return;
      calibrating.aims[CALIBRATION_TARGETS[calibrating.index]] = meanAim(recent);
      if (++calibrating.index < CALIBRATION_TARGETS.length) return aimAtTarget();
      const result = calibrate(calibrating.aims as Record<CalibrationTarget, Aim>);
      if (result) {
        pointer = createPointer(result);
        calibrated = true;
        save(TILT_KEY, result);
      }
      endCalibration(result ? labels.tiltCalibrated : labels.tiltBad);
    },
    cancel: () => endCalibration(""),
  };
  app.addEventListener(
    "click",
    event => {
      const [action, value = ""] = ((event.target as Element).closest<HTMLElement>("[data-ct-do]")?.dataset.ctDo ?? "").split(":");
      void actions[action]?.(value);
    },
    { signal }
  );

  const stop = guest?.subscribe(draw);
  const ticking = window.setInterval(() => guest && timers.draw(guest.state, guest.stateAt), 500);
  draw();

  return {
    destroy() {
      abort.abort();
      stop?.();
      clearInterval(ticking);
      sensor.stop();
      padSize.disconnect();
      guest?.close();
      preview.destroy();
      app.remove();
      document.documentElement.removeAttribute("data-ct-open");
    },
  };
}
