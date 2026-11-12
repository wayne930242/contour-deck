/**
 * The guest side: a phone through the relay, or the presenter window on the room's BroadcastChannel.
 * It follows the pairing of docs/PROTOCOL.md, keeps the resume token, and paces what it sends.
 */
import { MAX_POINTS, stateMessage } from "./protocol.js";
import type { Command, GuestMessage, StateMessage } from "./protocol.js";
import { guestKey, load, save } from "./store.js";
import type { Transport } from "./transport.js";

/**
 * `connecting`: no answer from the room yet. `pairing`: showing a code, waiting for the presenter.
 * `granted`: in control. `denied`, `revoked`: the presenter said no; the connection is closed until `retry()`.
 * `offline`: the connection ended and is being retried, except after 4029 (room full), where it waits for `retry()`.
 */
export type GuestPhase = "connecting" | "pairing" | "granted" | "denied" | "revoked" | "offline";

export interface Stroke {
  add(x: number, y: number): void;
  end(): void;
}

export interface Guest {
  readonly phase: GuestPhase;
  /** The pairing code to show, while `phase` is `pairing`. */
  readonly code: string;
  /** Close code of the last connection (4004: no host, 4029: room full), 0 when none ended. */
  readonly closeCode: number;
  /** The last `state` from the host, and when it arrived on `performance.now()`. */
  readonly state: StateMessage | null;
  readonly stateAt: number;
  command(c: Command, at?: string): void;
  /** The laser pointer; at most one message every 33 ms, the last position always goes out. */
  point(x: number, y: number, on: boolean): void;
  /** Starts an ink stroke; its points go out in batches. */
  stroke(): Stroke;
  clearInk(): void;
  /** After `denied` or `revoked`, or offline after 4029 (room full): connects again and asks anew. */
  retry(): void;
  /** Calls `listener` after every change of phase, code, or state. */
  subscribe(listener: () => void): () => void;
  close(): void;
}

export interface GuestOptions {
  room: string;
  /** Opens the transport; called again by `retry()`. */
  open(): Transport;
  /** Same browser as the host (BroadcastChannel): no pairing, control from the start. */
  trusted?: boolean;
}

const POINT_EVERY = 33;
const INK_EVERY = 50;
const PING_EVERY = 10_000;
/** A granted guest that hears nothing for this long reconnects: a phone's socket can die without closing. */
const SILENCE = 25_000;
/** With a token in hand, the code stays hidden this long: the grant usually arrives first. */
const RESUME_WAIT = 1200;

const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1e4) / 1e4;

export function createGuest({ room, open, trusted = false }: GuestOptions): Guest {
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  let transport: Transport;
  let stops: (() => void)[] = [];
  let phase: GuestPhase = "connecting";
  let code = "";
  let state: StateMessage | null = null;
  let stateAt = 0;
  let heard = performance.now();
  let reveal = 0;
  let strokes = 0;
  let pointTimer = 0;
  let pointAt = 0;
  let pending: GuestMessage | null = null;
  let closed = false;

  const token = () => {
    const value = load(guestKey(room));
    return typeof value === "string" ? value : null;
  };
  const send = (message: GuestMessage) => {
    if (phase === "granted") transport.send(message);
  };
  function set(next: GuestPhase) {
    clearTimeout(reveal);
    phase = next;
    emit();
  }

  function receive(message: Record<string, unknown> & { t: string }) {
    heard = performance.now();
    switch (message.t) {
      case "hello": {
        // A fresh connection: present the token, if this tab was granted before.
        const kept = token();
        if (kept) transport.send({ t: "resume", token: kept });
        if (phase !== "granted") set("connecting");
        return;
      }
      case "pair":
        if (typeof message.code !== "string" || !/^\d{4}$/.test(message.code)) return;
        code = message.code;
        clearTimeout(reveal);
        if (token() && phase !== "pairing") reveal = window.setTimeout(() => set("pairing"), RESUME_WAIT);
        else set("pairing");
        return;
      case "grant":
        if (typeof message.token !== "string" || message.token.length > 64) return;
        save(guestKey(room), message.token);
        return set("granted");
      case "deny":
      case "revoke":
        if (message.t === "revoke") save(guestKey(room), null);
        state = null;
        // Leave the room: a guest without control has nothing to wait for, and frees one of its places.
        hangUp();
        return set(message.t === "deny" ? "denied" : "revoked");
      case "state": {
        const next = stateMessage(message);
        if (!next) return;
        state = next;
        stateAt = performance.now();
        return emit();
      }
    }
  }

  function hangUp() {
    stops.forEach(stop => stop());
    stops = [];
    transport.close();
  }

  function connect() {
    transport = open();
    if (trusted) phase = "granted";
    stops = [
      transport.subscribe(receive),
      transport.watch(status => {
        if (status === "closed") set("offline");
        else if (status === "connecting" && phase === "offline") emit();
      }),
    ];
    // The presenter window asks for the state; the host answers a ping on the channel with pong and state.
    if (trusted) transport.send({ t: "ping" });
  }
  connect();

  const beat = window.setInterval(() => {
    if (phase !== "granted") return;
    if (trusted) {
      // Until the deck answers, ask every beat: the presenter window may open before the remote is on.
      if (!state) transport.send({ t: "ping" });
      return;
    }
    if (performance.now() - heard > SILENCE) {
      heard = performance.now();
      transport.reconnect();
    } else transport.send({ t: "ping" });
  }, trusted ? 1500 : PING_EVERY);

  function flushPoint() {
    pointTimer = 0;
    if (!pending) return;
    send(pending);
    pending = null;
    pointAt = performance.now();
  }

  return {
    get phase() {
      return phase;
    },
    get code() {
      return code;
    },
    get closeCode() {
      return transport.code;
    },
    get state() {
      return state;
    },
    get stateAt() {
      return stateAt;
    },
    command(c, at) {
      send(at === undefined ? { t: "cmd", c } : { t: "cmd", c, at });
    },
    point(x, y, on) {
      pending = { t: "ptr", x: round(x), y: round(y), on };
      const wait = POINT_EVERY - (performance.now() - pointAt);
      // Switching off is never held back; a position waits for its slot, and the newest one wins it.
      if (!on || wait <= 0) {
        clearTimeout(pointTimer);
        flushPoint();
      } else pointTimer ||= window.setTimeout(flushPoint, wait);
    },
    stroke() {
      const s = ++strokes;
      let points: number[] = [];
      let last: number[] = [];
      let timer = 0;
      let ended = false;
      const flush = (end = false) => {
        clearTimeout(timer);
        timer = 0;
        while (points.length > MAX_POINTS * 2) send({ t: "ink", s, pts: points.splice(0, MAX_POINTS * 2) });
        // The closing message carries `end`; when every point has gone out already, it repeats the last one.
        if (end && !points.length) points = last;
        if (points.length) send({ t: "ink", s, pts: points, ...(end ? { end: true } : {}) });
        points = [];
      };
      return {
        add(x, y) {
          if (ended) return;
          last = [round(x), round(y)];
          points.push(...last);
          if (points.length >= MAX_POINTS * 2) flush();
          else timer ||= window.setTimeout(flush, INK_EVERY);
        },
        end() {
          if (ended) return;
          ended = true;
          flush(true);
        },
      };
    },
    clearInk: () => send({ t: "ink-clear" }),
    retry() {
      if (closed) return;
      const full = phase === "offline" && transport.code === 4029;
      if (!full && phase !== "denied" && phase !== "revoked") return;
      phase = "connecting";
      if (full) transport.reconnect();
      else connect();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      closed = true;
      clearInterval(beat);
      clearTimeout(reveal);
      clearTimeout(pointTimer);
      hangUp();
    },
  };
}
