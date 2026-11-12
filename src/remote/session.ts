/**
 * The host side of the remote: one session per open deck. It owns the room, answers pairing,
 * runs what the granted phone and the presenter window ask for, and tells them where the deck is.
 */
import type { Deck, DeckState } from "../core/index.js";
import { readModel } from "../core/model.js";
import { createClock, plannedSeconds } from "./clock.js";
import type { ClockState } from "./clock.js";
import { defaultRemoteLabels } from "./labels.js";
import type { RemoteLabels } from "./labels.js";
import { pageLink } from "./links.js";
import { createOverlay } from "./overlay.js";
import { createPairing } from "./pairing.js";
import { createPanel } from "./panel.js";
import type { QrEncoder } from "./panel.js";
import { guestMessage, isRoom, newKey, roomOf } from "./protocol.js";
import type { Command, GuestMessage, StateMessage } from "./protocol.js";
import { hostKey, load, save } from "./store.js";
import { injectStyle } from "./style.js";
import { broadcast, relay } from "./transport.js";
import type { Incoming } from "./transport.js";

export interface RemoteOptions {
  /**
   * Base URL of the relay, `wss://…` or `https://…` (see docs/PROTOCOL.md). Without it the remote stays
   * on this computer: the presenter window and the notes link work, a phone cannot control the deck.
   */
  relay?: string;
  /** Draws a QR code as an SVG string. Default: the built-in encoder, for links up to 287 bytes. */
  qr?: QrEncoder;
  /** Block kinds outside the talk, whose minutes are not planned time. Default `["appendix"]`, as `linear.skip` of the deck. */
  skip?: string[];
  labels?: Partial<RemoteLabels>;
  /** Nonce for the injected `<style>`, for a page with a `style-src` policy. */
  nonce?: string;
}

export interface RemoteHost {
  /** The room of this session: the name of the relay room and of the BroadcastChannel. */
  readonly room: string;
  /** Whether the panel is showing. */
  readonly open: boolean;
  /** Shows or hides the panel; without an argument, the other state. */
  toggle(open?: boolean): void;
  /** Ends the session for good: control is taken back, the room closes, and the next session gets a new room. */
  end(): void;
  /** Closes the connections and removes the overlays. The room and the token stay in `sessionStorage`, so the next session in this tab continues. */
  destroy(): void;
}

interface Stored {
  /** The host key; the room is its hash, so the key alone names the session. */
  key: string;
  token: string | null;
  clock: ClockState | null;
}

function stored(): Stored | null {
  const value = load(hostKey());
  if (typeof value !== "object" || value === null) return null;
  const { key, token, clock } = value as Record<string, unknown>;
  if (!isRoom(key)) return null;
  const state = clock as ClockState | null;
  const usable = !!state && typeof state === "object" && typeof state.spent === "object" && state.spent !== null;
  return { key, token: typeof token === "string" ? token : null, clock: usable ? state : null };
}

/** A request shows once it is this old: a phone that resumes with its token in that time never flashes one. */
const SETTLE = 300;
/** `state` goes out on every change and this often between changes. */
const STATE_EVERY = 15;

const hosts = new WeakMap<Deck, Promise<RemoteHost>>();

/**
 * Starts the remote for an open deck, or returns the session it already has.
 * `root` is the deck element given to `createDeck`. It resolves once the room is known: the room is
 * the hash of the session's key, which takes `crypto.subtle`.
 */
export function remoteHost(deck: Deck, root: HTMLElement, options: RemoteOptions = {}): Promise<RemoteHost> {
  const known = hosts.get(deck);
  if (known) return known;
  const app = root.closest<HTMLElement>(".ct-app");
  const stage = app?.querySelector<HTMLElement>(".ct-stage");
  const viewport = app?.querySelector<HTMLElement>(".ct-vp");
  if (!app || !stage || !viewport) return Promise.reject(new Error("contour-deck: remoteHost needs an open deck"));
  const before = stored();
  const key = before?.key ?? newKey();
  let closed = false;
  const stop = deck.on("destroy", () => (closed = true));
  // Without a relay the room is only the name of a BroadcastChannel; a page without `crypto.subtle` (plain http
  // off localhost) then uses the key itself, which nothing outside this browser ever sees.
  const room = options.relay || globalThis.crypto?.subtle ? roomOf(key) : Promise.resolve(key);
  const pending = room
    .then(room => {
      if (closed) throw new Error("contour-deck: the deck closed before its remote started");
      return start(deck, root, options, { app, stage, viewport }, { key, room, before });
    })
    .finally(stop);
  hosts.set(deck, pending);
  pending.catch(() => hosts.delete(deck));
  return pending;
}

interface Shell {
  app: HTMLElement;
  stage: HTMLElement;
  viewport: HTMLElement;
}

interface Seat {
  key: string;
  room: string;
  before: Stored | null;
}

function start(deck: Deck, root: HTMLElement, options: RemoteOptions, { app, stage, viewport }: Shell, { key, room, before }: Seat): RemoteHost {
  injectStyle(options.nonce);
  const labels = { ...defaultRemoteLabels, ...options.labels };
  const blocks = readModel(root, root.dataset.title || document.title);
  const total = plannedSeconds(blocks, options.skip ?? ["appendix"]);
  const clock = createClock(before?.clock);
  const overlay = createOverlay(stage);
  const local = broadcast(room);
  // The key goes to the relay only; the links and the QR carry the room.
  const wan = options.relay ? relay(options.relay, { room, role: "host", key }) : null;
  const barButton = app.querySelector<HTMLElement>('[data-ct-act="remote"]');
  let alive = true;
  let last: DeckState = deck.state;
  let seated: string | null = null;
  let ticks = 0;

  const pairing = createPairing({
    send: message => wan?.send(message),
    token: before?.token,
    changed() {
      persist();
      // A new holder of control learns where the deck is at once; when it leaves, its dot goes too.
      if (pairing.controller !== seated) {
        seated = pairing.controller;
        if (seated) sendState();
        else overlay.hide();
      }
      refresh();
      setTimeout(refresh, SETTLE + 20);
    },
  });

  const persist = () => save(hostKey(), { key, token: pairing.token, clock: clock.state } satisfies Stored);

  function state(): StateMessage {
    const { mode, block, slide, page, step } = deck.state;
    const current = blocks[block - 1];
    const reading = clock.read(Date.now());
    return {
      t: "state",
      mode: mode === "stage" ? "stage" : "overview",
      at: `${block}.${slide}.${page}`,
      step,
      steps: current.slides[slide - 1].pages[page - 1].steps.length,
      elapsed: reading.elapsed,
      total,
      blockElapsed: reading.blockElapsed,
      blockMinutes: current.minutes || null,
      ratio: Math.round((stage.clientWidth / (stage.clientHeight || 1)) * 1000) / 1000,
    };
  }

  /** To the presenter window, and to the phone that holds control; nobody else is told where the deck is. */
  function sendState() {
    const message = state();
    local.send(message);
    if (pairing.controller) wan?.send({ ...message, to: pairing.controller });
  }

  const commands: Record<Command, (at?: string) => unknown> = {
    next: () => deck.next(),
    prev: () => deck.prev(),
    slideNext: () => deck.slideBy(1),
    slidePrev: () => deck.slideBy(-1),
    pageNext: () => deck.pageBy(1),
    pagePrev: () => deck.pageBy(-1),
    overview: () => deck.overview(),
    open: at => at && deck.open(at),
  };

  /** Runs a message from a source that may control the deck. */
  function act(message: GuestMessage, source: string) {
    if (message.t === "cmd") void commands[message.c](message.at);
    else if (message.t === "ptr") overlay.point(message.x, message.y, message.on);
    else if (message.t === "ink") overlay.ink(`${source}:${message.s}`, message.pts);
    else if (message.t === "ink-clear") overlay.clear();
  }

  /**
   * From the relay. The relay stamps `from` on everything a guest sends, so a frame with `from` is a guest's,
   * whatever its `t` claims, and a frame without it is the relay's own (`hello`, `join`, `leave`).
   */
  function fromRelay(message: Incoming) {
    const from = message.from;
    if (from === undefined) {
      const id = typeof message.id === "string" && message.id.length <= 32 ? message.id : "";
      if (message.t === "join" && id) pairing.join(id);
      else if (message.t === "leave" && id) pairing.leave(id);
      return;
    }
    const parsed = typeof from === "string" ? guestMessage(message) : null;
    if (!parsed || typeof from !== "string") return;
    if (parsed.t === "resume") return void pairing.resume(from, parsed.token);
    if (!pairing.controls(from)) return;
    if (parsed.t === "ping") wan?.send({ t: "pong", to: from });
    else act(parsed, from);
  }

  /** From a window of this browser on the room's channel: trusted, no pairing. */
  function fromLocal(message: Incoming) {
    const parsed = guestMessage(message);
    if (!parsed || parsed.t === "resume") return;
    if (parsed.t === "ping") {
      local.send({ t: "pong" });
      local.send(state());
    } else act(parsed, "local");
  }

  const panel = createPanel({
    parent: viewport,
    labels,
    qr: options.qr ?? (text => import("./qr.js").then(module => module.qrSvg(text))),
    remoteLink: wan ? pageLink("remote", room) : null,
    notesLink: pageLink("notes"),
    allow: id => pairing.allow(id),
    deny: id => pairing.deny(id),
    revoke: () => pairing.revoke(),
    presenter: () => void window.open(pageLink("presenter", room), "contour-deck-presenter", "popup,width=1180,height=760"),
    resetTimer() {
      clock.reset();
      persist();
      sendState();
      refresh();
    },
    end: () => api.end(),
    close: () => api.toggle(false),
  });

  function refresh() {
    if (!alive) return;
    const settled = Date.now() - SETTLE;
    const requests = pairing.requests.filter(request => request.at <= settled);
    panel.update({
      relay: wan?.status ?? null,
      code: wan?.code ?? 0,
      requests,
      paired: pairing.controller ? "online" : pairing.token ? "offline" : "no",
      elapsed: clock.read(Date.now()).elapsed,
    });
    // With the panel closed, a waiting phone shows as a count on the bar button; nothing opens by itself.
    if (requests.length) {
      barButton?.setAttribute("data-ct-count", String(requests.length));
      barButton?.setAttribute("aria-label", labels.waiting(requests.length));
    } else {
      barButton?.removeAttribute("data-ct-count");
      barButton?.removeAttribute("aria-label");
    }
    barButton?.setAttribute("aria-pressed", String(panel.open));
  }

  const stops = [
    deck.on("change", change => {
      const now = Date.now();
      // The talk starts with the first move on the stage, not with opening a slide from the outline.
      if (clock.running) clock.enter(change.block - 1, now);
      else if (last.mode === "stage" && change.mode === "stage") clock.start(change.block - 1, now);
      if (change.mode !== last.mode || change.block !== last.block || change.slide !== last.slide || change.page !== last.page) overlay.clear();
      last = { ...change };
      persist();
      sendState();
      refresh();
    }),
    deck.on("destroy", () => api.destroy()),
    local.subscribe(fromLocal),
    wan?.subscribe(fromRelay),
    wan?.watch(status => {
      // Without the relay nobody is connected; the token stays, so the phone resumes when the room is back.
      if (status !== "open") pairing.offline();
      refresh();
    }),
  ];
  const interval = window.setInterval(() => {
    pairing.expire();
    if (++ticks % STATE_EVERY === 0) sendState();
    if (panel.open) refresh();
  }, 1000);

  const api: RemoteHost = {
    room,
    get open() {
      return panel.open;
    },
    toggle(open = !panel.open) {
      if (!alive) return;
      panel.show(open);
      refresh();
    },
    end() {
      if (!alive) return;
      pairing.revoke();
      api.destroy();
      save(hostKey(), null);
    },
    destroy() {
      if (!alive) return;
      alive = false;
      clearInterval(interval);
      stops.forEach(stop => stop?.());
      local.close();
      wan?.close();
      overlay.destroy();
      panel.destroy();
      for (const name of ["data-ct-count", "aria-label", "aria-pressed"]) barButton?.removeAttribute(name);
      hosts.delete(deck);
    },
  };
  persist();
  sendState();
  refresh();
  return api;
}
