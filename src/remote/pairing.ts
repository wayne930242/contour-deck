/**
 * Who may control the deck: the host's side of the pairing in docs/PROTOCOL.md, as a state machine without DOM.
 * A guest gets a 4-digit code and waits; the presenter allows or denies it; one guest at a time holds control,
 * and its token lets it come back after a reconnect without asking again.
 */
import { newCode, newToken } from "./protocol.js";
import type { HostMessage } from "./protocol.js";

export interface PairRequest {
  id: string;
  code: string;
  /** When the guest joined, on the host's clock. */
  at: number;
}

/** A request the presenter has not answered after this long is denied. */
export const REQUEST_TTL = 120_000;

export interface PairingOptions {
  send(message: HostMessage): void;
  /** Called after every change of `requests`, `controller`, or `token`. */
  changed(): void;
  /** The token granted before a reload of the host page, if any. */
  token?: string | null;
  now?: () => number;
}

export interface Pairing {
  /** Guests waiting for the presenter's answer, oldest first. */
  readonly requests: readonly PairRequest[];
  /** Relay id of the connected guest that holds control, or `null`. */
  readonly controller: string | null;
  /** The one token that resumes control, or `null` when no guest is paired. */
  readonly token: string | null;
  join(id: string): void;
  leave(id: string): void;
  /** A guest presents a token; true when it now holds control. */
  resume(id: string, token: string): boolean;
  allow(id: string): void;
  deny(id: string): void;
  /** Takes control back and forgets the token, whether the guest is connected or not. */
  revoke(): void;
  /** Denies the requests older than `REQUEST_TTL`. */
  expire(): void;
  /** True when a message from this relay id may act on the deck. */
  controls(id: unknown): boolean;
  /** The relay connection ended: nobody is connected any more; the token stays. */
  offline(): void;
}

export function createPairing({ send, changed, token: restored = null, now = Date.now }: PairingOptions): Pairing {
  let requests: PairRequest[] = [];
  let controller: string | null = null;
  let token: string | null = restored;

  const drop = (id: string) => {
    const before = requests.length;
    requests = requests.filter(request => request.id !== id);
    return requests.length !== before;
  };

  /** Hands control to `id`; whoever held it before is told it lost it. */
  function seat(id: string, granted: string) {
    if (controller && controller !== id) send({ t: "revoke", to: controller });
    drop(id);
    controller = id;
    token = granted;
    send({ t: "grant", to: id, token: granted });
    changed();
  }

  return {
    get requests() {
      return requests;
    },
    get controller() {
      return controller;
    },
    get token() {
      return token;
    },
    join(id) {
      drop(id);
      const request = { id, code: newCode(), at: now() };
      requests.push(request);
      send({ t: "pair", to: id, code: request.code });
      changed();
    },
    leave(id) {
      const waiting = drop(id);
      if (controller === id) controller = null;
      else if (!waiting) return;
      changed();
    },
    resume(id, presented) {
      // Only a guest the relay announced, and only with the one token in force.
      if (!token || presented !== token || (controller !== id && !requests.some(request => request.id === id))) return false;
      seat(id, token);
      return true;
    },
    allow(id) {
      // A fresh token on every decision: the one of the phone that held control before stops working.
      if (requests.some(request => request.id === id)) seat(id, newToken());
    },
    deny(id) {
      if (!drop(id)) return;
      send({ t: "deny", to: id });
      changed();
    },
    revoke() {
      if (!controller && !token) return;
      if (controller) send({ t: "revoke", to: controller });
      controller = null;
      token = null;
      changed();
    },
    expire() {
      const limit = now() - REQUEST_TTL;
      for (const request of requests.filter(item => item.at <= limit)) {
        drop(request.id);
        send({ t: "deny", to: request.id });
        changed();
      }
    },
    controls: id => controller !== null && id === controller,
    offline() {
      if (!controller && !requests.length) return;
      controller = null;
      requests = [];
      changed();
    },
  };
}
