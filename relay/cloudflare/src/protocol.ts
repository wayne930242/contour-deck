/** Numbers and shapes fixed by docs/PROTOCOL.md, version 1. */

export const MAX_FRAME_BYTES = 2048;
export const MAX_GUESTS = 4;
export const IDLE_MS = 2 * 60 * 60 * 1000;
/** Requests to room paths one client address may make per minute (the `UPGRADES` binding in wrangler.jsonc). */
export const UPGRADES_PER_MINUTE = 60;

export const CLOSE = {
  roomClosed: 4000,
  removed: 4003,
  noHost: 4004,
  hostReplaced: 4009,
  roomFull: 4029,
  rateLimit: 1008,
  tooLarge: 1009,
} as const;

export type Role = "host" | "guest";

export function isRole(value: string | null): value is Role {
  return value === "host" || value === "guest";
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ROOM_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/**
 * The room name a Durable Object is keyed by, or null when `raw` is not a room id.
 * Crockford base32 reads either case, so both cases name the same room.
 */
export function canonicalRoom(raw: string): string | null {
  const upper = raw.toUpperCase();
  return ROOM_PATTERN.test(upper) ? upper : null;
}

/**
 * The room a host key opens: the first 26 Crockford base32 characters of SHA-256 of the key (UTF-8, upper case),
 * or null when `raw` is not a key. A key has the shape of a room id; the QR carries the room, never the key.
 */
export async function roomOfKey(raw: string): Promise<string | null> {
  const key = canonicalRoom(raw);
  if (key === null) return null;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  let room = "";
  let buffer = 0;
  let held = 0;
  for (const byte of hash) {
    buffer = (buffer << 8) | byte;
    held += 8;
    while (held >= 5 && room.length < 26) {
      held -= 5;
      room += CROCKFORD[(buffer >> held) & 31];
    }
    buffer &= (1 << held) - 1;
    if (room.length === 26) break;
  }
  return room;
}

export function isSocketId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Eight Crockford base32 characters (40 random bits). */
export function newSocketId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = "";
  for (const byte of bytes) id += CROCKFORD[byte & 31];
  return id;
}

/** True when `origin` equals an entry of the comma-separated list; an entry ending in `:*` allows any port. */
export function originAllowed(origin: string | null, allowed: string | undefined): boolean {
  if (!origin || !allowed) return false;
  for (const raw of allowed.split(",")) {
    const entry = raw.trim();
    if (entry === "") continue;
    if (entry === origin) return true;
    if (entry.endsWith(":*")) {
      const prefix = entry.slice(0, -1);
      if (origin.startsWith(prefix) && /^\d{1,5}$/.test(origin.slice(prefix.length))) return true;
    }
  }
  return false;
}

const encoder = new TextEncoder();

/** Whether a text frame is longer than `MAX_FRAME_BYTES` once encoded as UTF-8. */
export function frameTooLarge(text: string): boolean {
  if (text.length > MAX_FRAME_BYTES) return true;
  // A UTF-16 code unit encodes to at most three UTF-8 bytes.
  if (text.length * 3 <= MAX_FRAME_BYTES) return false;
  return encoder.encode(text).byteLength > MAX_FRAME_BYTES;
}

/** A frame the relay forwards: a JSON object with a string `t`. */
export interface Message {
  t: string;
  [field: string]: unknown;
}

export function parseMessage(text: string): Message | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return typeof (value as { t?: unknown }).t === "string" ? (value as Message) : null;
}
