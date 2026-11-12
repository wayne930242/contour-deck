/**
 * The relay of docs/PROTOCOL.md, in the test process: every WebSocket a page opens to `RELAY` is routed here
 * and never reaches the network. It follows the relay rules table row by row; what it cannot do as a route
 * is answer before the upgrade (HTTP 400 and 403), so a bad room name closes the socket with 1008 instead.
 */
import type { BrowserContext, WebSocketRoute } from "@playwright/test";

/** The relay URL the pages are given; nothing listens there. */
export const RELAY = "ws://relay.test";

const MAX_FRAME = 2048;
const MAX_GUESTS = 4;
const RATE = 60;
const BURST = 120;

interface Peer {
  id: string;
  role: "host" | "guest";
  socket: WebSocketRoute;
  tokens: number;
  refilled: number;
}

interface Room {
  host: Peer | null;
  guests: Map<string, Peer>;
}

/** One frame the relay forwarded, for assertions on who was told what. */
export interface Forwarded {
  room: string;
  /** `host`, or the id of the guest that sent it. */
  from: string;
  /** `host`, or the id of the guest that received it. */
  to: string;
  message: Record<string, unknown>;
}

export class RelayStub {
  readonly rooms = new Map<string, Room>();
  readonly forwarded: Forwarded[] = [];
  private ids = 0;

  /** Routes the relay URL in a browser context. Call it for every context of a test, before its pages load. */
  async install(context: BrowserContext): Promise<void> {
    await context.routeWebSocket(/^ws:\/\/relay\.test\//, socket => this.accept(socket));
  }

  /** Frames of type `t` delivered to one receiver. */
  received(to: string, t: string): Record<string, unknown>[] {
    return this.forwarded.filter(frame => frame.to === to && frame.message.t === t).map(frame => frame.message);
  }

  /** Ends the host's connection as a network failure would; the room closes as when the host leaves. */
  async dropHost(room: string): Promise<void> {
    const host = this.rooms.get(room)?.host;
    if (!host) throw new Error(`no host in room ${room}`);
    this.leave(room, host);
    await host.socket.close({ code: 1006 });
  }

  private deliver(room: string, from: string, to: Peer, message: Record<string, unknown>) {
    this.forwarded.push({ room, from, to: to.role === "host" ? "host" : to.id, message });
    to.socket.send(JSON.stringify(message));
  }

  private accept(socket: WebSocketRoute) {
    const url = new URL(socket.url());
    const match = /^\/v1\/room\/([^/]+)$/.exec(url.pathname);
    const role = url.searchParams.get("role");
    const name = match?.[1] ?? "";
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(name) || (role !== "host" && role !== "guest")) return void socket.close({ code: 1008, reason: "bad request" });
    const room = this.rooms.get(name) ?? { host: null, guests: new Map<string, Peer>() };
    const peer: Peer = { id: `g${String(++this.ids).padStart(7, "0")}`, role, socket, tokens: BURST, refilled: Date.now() };

    if (role === "host") {
      if (room.host) return void socket.close({ code: 4009, reason: "room already has a host" });
      room.host = peer;
      this.rooms.set(name, room);
    } else {
      if (!room.host) return void socket.close({ code: 4004, reason: "no host in this room" });
      if (room.guests.size >= MAX_GUESTS) return void socket.close({ code: 4029, reason: "room full" });
      room.guests.set(peer.id, peer);
    }
    socket.send(JSON.stringify({ t: "hello", id: peer.id, role }));
    if (role === "guest") this.deliver(name, "relay", room.host!, { t: "join", id: peer.id });

    socket.onMessage(frame => {
      if (typeof frame !== "string" || Buffer.byteLength(frame) > MAX_FRAME) {
        this.leave(name, peer);
        return void socket.close({ code: 1009, reason: "message too large" });
      }
      // 60 messages a second with a burst of 120: the extra ones are dropped.
      const now = Date.now();
      peer.tokens = Math.min(BURST, peer.tokens + ((now - peer.refilled) / 1000) * RATE);
      peer.refilled = now;
      if (peer.tokens < 1) return;
      peer.tokens -= 1;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(frame) as Record<string, unknown>;
      } catch {
        return;
      }
      if (typeof message !== "object" || message === null || typeof message.t !== "string") return;
      if (peer.role === "guest") {
        // To the host only, and `from` is the relay's word, whatever the guest wrote there.
        if (room.host) this.deliver(name, peer.id, room.host, { ...message, from: peer.id });
      } else if (typeof message.to === "string") {
        const guest = room.guests.get(message.to);
        if (guest) this.deliver(name, "host", guest, message);
      } else {
        for (const guest of room.guests.values()) this.deliver(name, "host", guest, message);
      }
    });
    socket.onClose(() => this.leave(name, peer));
  }

  private leave(name: string, peer: Peer) {
    const room = this.rooms.get(name);
    if (!room) return;
    if (peer.role === "guest") {
      if (room.guests.delete(peer.id) && room.host) this.deliver(name, "relay", room.host, { t: "leave", id: peer.id });
      return;
    }
    if (room.host !== peer) return;
    // The host left: every guest is closed with 4000 and the room is gone.
    this.rooms.delete(name);
    for (const guest of room.guests.values()) void guest.socket.close({ code: 4000, reason: "room closed" });
  }
}
