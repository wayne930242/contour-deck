/** The wire messages of docs/PROTOCOL.md, and the checks every incoming frame passes before it is used. */

/** Frames above this size are dropped by the relay (it closes the socket with 1009). */
export const MAX_FRAME = 2048;
/** An `ink` message carries at most this many points. */
export const MAX_POINTS = 64;

export type Command = "next" | "prev" | "slideNext" | "slidePrev" | "pageNext" | "pagePrev" | "overview" | "open";

const COMMANDS: readonly string[] = ["next", "prev", "slideNext", "slidePrev", "pageNext", "pagePrev", "overview", "open"];

/** Where the deck is and how the time stands; sent to the granted guest and to the presenter window. */
export interface StateMessage {
  t: "state";
  mode: "overview" | "stage";
  /** `b.s.p`, 1-based. */
  at: string;
  step: number;
  steps: number;
  /** Seconds since the talk started; 0 while the clock has not started. */
  elapsed: number;
  /** Planned seconds of the whole talk, or `null` when no block has minutes. */
  total: number | null;
  blockElapsed: number;
  blockMinutes: number | null;
  /** Width over height of the stage, so a phone draws on a pad of the same shape. Not in protocol v1; optional. */
  ratio?: number;
  /** Width of the stage in CSS pixels, so a preview lays the page out as the stage does. Optional. */
  width?: number;
  /** How far the stage is scrolled below the top of the current page, in CSS pixels of the stage. Optional. */
  scroll?: number;
}

/** What the relay itself sends. */
export type RelayMessage =
  | { t: "hello"; id: string; role: "host" | "guest" }
  | { t: "join"; id: string }
  | { t: "leave"; id: string };

/** Host to guest. `to` addresses one guest; the relay strips nothing, the guest ignores it. */
export type HostMessage =
  | { t: "pair"; to: string; code: string }
  | { t: "grant"; to: string; token: string }
  | { t: "deny"; to: string }
  | { t: "revoke"; to: string }
  | { t: "pong"; to?: string }
  | (StateMessage & { to?: string });

/** Guest to host. The relay sets `from`; over BroadcastChannel there is none. */
export type GuestMessage =
  | { t: "resume"; token: string }
  | { t: "cmd"; c: Command; at?: string }
  | { t: "ptr"; x: number; y: number; on: boolean }
  | { t: "ink"; s: number; pts: number[]; end?: boolean }
  | { t: "ink-clear" }
  | { t: "ping" };

export type Message = RelayMessage | HostMessage | GuestMessage;

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const unit = (value: number) => Math.min(1, Math.max(0, value));

/** A frame as an object with a string `t`, or `null`. */
export function decode(frame: unknown): (Fields & { t: string }) | null {
  if (typeof frame !== "string" || frame.length > MAX_FRAME) return null;
  try {
    const value: unknown = JSON.parse(frame);
    return isFields(value) && typeof value.t === "string" ? (value as Fields & { t: string }) : null;
  } catch {
    return null;
  }
}

/**
 * A message a guest may send, with every field checked and every coordinate clamped to [0, 1];
 * `null` for anything else. This is the only door for input from outside the host's own page.
 */
export function guestMessage(value: Fields): GuestMessage | null {
  switch (value.t) {
    case "resume":
      return text(value.token, 64) ? { t: "resume", token: value.token } : null;
    case "cmd": {
      if (typeof value.c !== "string" || !COMMANDS.includes(value.c)) return null;
      const c = value.c as Command;
      if (c !== "open") return { t: "cmd", c };
      return text(value.at, 64) ? { t: "cmd", c, at: value.at } : null;
    }
    case "ptr":
      return finite(value.x) && finite(value.y) && typeof value.on === "boolean"
        ? { t: "ptr", x: unit(value.x), y: unit(value.y), on: value.on }
        : null;
    case "ink": {
      const { s, pts } = value;
      if (!finite(s) || !Array.isArray(pts) || pts.length < 2 || pts.length > MAX_POINTS * 2 || pts.length % 2) return null;
      if (!pts.every(finite)) return null;
      return { t: "ink", s, pts: pts.map(unit), ...(value.end === true ? { end: true } : {}) };
    }
    case "ink-clear":
      return { t: "ink-clear" };
    case "ping":
      return { t: "ping" };
    default:
      return null;
  }
}

const number = (value: unknown, fallback = 0) => (finite(value) ? value : fallback);

/** A `state` message as the guest reads it; a field of the wrong type takes its neutral value. */
export function stateMessage(value: Fields): StateMessage | null {
  if (value.t !== "state" || typeof value.at !== "string") return null;
  return {
    t: "state",
    mode: value.mode === "overview" ? "overview" : "stage",
    at: value.at.slice(0, 32),
    step: number(value.step),
    steps: number(value.steps),
    elapsed: number(value.elapsed),
    total: finite(value.total) ? value.total : null,
    blockElapsed: number(value.blockElapsed),
    blockMinutes: finite(value.blockMinutes) ? value.blockMinutes : null,
    ...(finite(value.ratio) && value.ratio > 0 ? { ratio: value.ratio } : {}),
    ...(finite(value.width) && value.width >= 100 && value.width <= 20000 ? { width: Math.round(value.width) } : {}),
    ...(finite(value.scroll) && value.scroll >= 0 && value.scroll <= 1e6 ? { scroll: Math.round(value.scroll) } : {}),
  };
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function randomText(alphabet: string, bits: number, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil((length * bits) / 8)));
  let out = "";
  let buffer = 0;
  let held = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    held += 8;
    while (held >= bits && out.length < length) {
      held -= bits;
      out += alphabet[(buffer >> held) & ((1 << bits) - 1)];
    }
    buffer &= (1 << held) - 1;
  }
  return out;
}

/**
 * A host key: 26 characters of Crockford base32 from `crypto.getRandomValues` (the first carries 3 bits, 128 in all).
 * It stays in the host's tab; the relay gives the host seat of a room only to the key whose hash is the room.
 */
export const newKey = () => CROCKFORD[crypto.getRandomValues(new Uint8Array(1))[0] & 7] + randomText(CROCKFORD, 5, 25);

/** A room name, and the shape of a host key too. */
export const isRoom = (value: unknown): value is string => typeof value === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);

/** The room of a host key: the first 26 Crockford base32 characters of SHA-256 of the key (docs/PROTOCOL.md). */
export async function roomOf(key: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("contour-deck: the remote relay needs a secure context (https or localhost)");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  let room = "";
  for (let bit = 0; room.length < 26; bit += 5) {
    const at = bit >> 3;
    room += CROCKFORD[(((hash[at] << 8) | hash[at + 1]) >> (11 - (bit & 7))) & 31];
  }
  return room;
}

/** A resume token: 22 characters of base64url, 132 random bits. */
export const newToken = () => randomText(BASE64URL, 6, 22);

/** A fresh 4-digit pairing code, without modulo bias. */
export function newCode(): string {
  const one = new Uint16Array(1);
  do crypto.getRandomValues(one);
  while (one[0] >= 60000);
  return String(one[0] % 10000).padStart(4, "0");
}
