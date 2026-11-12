/**
 * How messages travel: `broadcast` between windows of one browser, `relay` between devices
 * through the WebSocket relay of docs/PROTOCOL.md. Both carry the same messages.
 */
import { decode, MAX_FRAME } from "./protocol.js";
import type { Message } from "./protocol.js";

export type TransportStatus = "connecting" | "open" | "closed";

/** A decoded frame: an object with a string `t`. The receiver checks the rest. */
export type Incoming = Record<string, unknown> & { t: string };

export interface Transport {
  readonly status: TransportStatus;
  /** Close code of the last connection that ended (4004, 4009, …); 0 when none did. */
  readonly code: number;
  /** Sends a message; it is dropped unless the transport is open. */
  send(message: Message): void;
  subscribe(listener: (message: Incoming) => void): () => void;
  /** Calls `listener` on every change of `status`. */
  watch(listener: (status: TransportStatus) => void): () => void;
  /** Ends the current connection and opens a new one at once. */
  reconnect(): void;
  close(): void;
}

function emitter<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    add(listener: (value: T) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit: (value: T) => listeners.forEach(listener => listener(value)),
  };
}

export const channelName = (room: string) => `contour-deck:${room}`;

/** Windows of the same browser and origin, through `BroadcastChannel`. No pairing: same browser, trusted. */
export function broadcast(room: string): Transport {
  const messages = emitter<Incoming>();
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName(room));
  let status: TransportStatus = channel ? "open" : "closed";
  if (channel) {
    channel.onmessage = event => {
      const message = decode(event.data);
      if (message) messages.emit(message);
    };
  }
  return {
    get status() {
      return status;
    },
    code: 0,
    send(message) {
      if (status === "open") channel?.postMessage(JSON.stringify(message));
    },
    subscribe: messages.add,
    watch: () => () => {},
    reconnect() {},
    close() {
      status = "closed";
      channel?.close();
    },
  };
}

export interface RelayOptions {
  room: string;
  role: "host" | "guest";
  /** The host key whose hash is `room`; the relay seats a host only with it. Guests have none. */
  key?: string;
}

const FIRST_RETRY = 500;
const LAST_RETRY = 15_000;
/**
 * The longest wait after `4004` (no host): a phone left open after the talk tries about once a minute, so the
 * phones of one venue network do not spend the relay's per-address budget, which the presenter's phone shares.
 */
const LAST_RETRY_NO_HOST = 60_000;

/** `https://relay.example` or `wss://relay.example` to the room endpoint. */
export function relayUrl(base: string, { room, role, key }: RelayOptions): string {
  return `${base.replace(/^http/, "ws").replace(/\/+$/, "")}/v1/room/${room}?role=${role}${key ? `&key=${key}` : ""}`;
}

/**
 * Closes after which the connection is not opened again by itself: 4009, a newer connection with the same key
 * took the host seat (the same session in another tab); 4003, the host removed this guest; 4029, a guest found
 * the room full (the audience behind one address would otherwise keep spending its request budget).
 */
const FINAL = { host: [4003, 4009], guest: [4003, 4009, 4029] };

/**
 * A WebSocket to the relay. A connection that ends is opened again with exponential backoff
 * (0.5 s doubling to 15 s, 60 s after 4004, with jitter), and at once when the page comes back or the network
 * returns. After a final close it waits for `reconnect()`.
 */
export function relay(base: string, options: RelayOptions): Transport {
  const messages = emitter<Incoming>();
  const statuses = emitter<TransportStatus>();
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let socket: WebSocket | null = null;
  let status: TransportStatus = "connecting";
  let code = 0;
  let attempt = 0;
  let timer = 0;
  let ended = false;
  /** After a final close: waiting for `reconnect()`, not for a timer or the page coming back. */
  let parked = false;

  function set(next: TransportStatus) {
    if (next === status) return;
    status = next;
    statuses.emit(next);
  }

  function open() {
    clearTimeout(timer);
    if (ended) return;
    const current = new WebSocket(relayUrl(base, options));
    socket = current;
    set("connecting");
    current.onopen = () => {
      if (socket === current) set("open");
    };
    current.onmessage = event => {
      if (socket !== current) return;
      const message = decode(event.data);
      if (!message) return;
      // The relay greets every socket; a greeting means the room took us, so the backoff starts over.
      if (message.t === "hello") attempt = 0;
      messages.emit(message);
    };
    current.onclose = event => {
      if (socket !== current) return;
      socket = null;
      code = event.code;
      if (ended) return;
      set("closed");
      parked = FINAL[options.role].includes(code);
      if (parked) return;
      const last = code === 4004 ? LAST_RETRY_NO_HOST : LAST_RETRY;
      const delay = Math.min(last, FIRST_RETRY * 2 ** attempt++) * (0.5 + Math.random() / 2);
      timer = window.setTimeout(open, delay);
    };
  }

  function reconnect() {
    if (ended) return;
    const current = socket;
    socket = null;
    current?.close();
    attempt = 0;
    parked = false;
    open();
  }

  /** Waiting for a retry while the page was hidden or offline: try now. */
  const wake = () => {
    if (!socket && !parked && !document.hidden) reconnect();
  };
  addEventListener("online", wake, { signal: abort.signal });
  document.addEventListener("visibilitychange", wake, { signal: abort.signal });
  open();

  return {
    get status() {
      return status;
    },
    get code() {
      return code;
    },
    send(message) {
      if (status !== "open" || !socket) return;
      const frame = JSON.stringify(message);
      if (encoder.encode(frame).length <= MAX_FRAME) socket.send(frame);
    },
    subscribe: messages.add,
    watch: statuses.add,
    reconnect,
    close() {
      ended = true;
      abort.abort();
      clearTimeout(timer);
      socket?.close();
      socket = null;
      set("closed");
    },
  };
}
