import { DurableObject } from "cloudflare:workers";
import {
  CLOSE,
  IDLE_MS,
  MAX_GUESTS,
  type Message,
  type Role,
  frameTooLarge,
  isRole,
  isSocketId,
  newSocketId,
  parseMessage,
} from "./protocol";
import { type Bucket, newBucket, take } from "./rate";

/**
 * What the relay knows about one accepted socket. It lives in the socket's attachment,
 * because the object's memory is dropped whenever the room hibernates.
 */
interface Member {
  role: Role;
  id: string;
  /** Set once the relay has handled this socket's departure, so a late close event does nothing. */
  gone: boolean;
  /** When this socket last sent a frame (ms); for the host also the latest of its departed guests. */
  seen: number;
  bucket: Bucket;
}

interface Seat {
  ws: WebSocket;
  member: Member;
}

const guestTag = (id: string): string => `guest:${id}`;

function seatOf(ws: WebSocket): Seat | null {
  const member = ws.deserializeAttachment() as Member | null;
  return member === null || member.gone ? null : { ws, member };
}

function send(ws: WebSocket, frame: string): void {
  try {
    ws.send(frame);
  } catch {
    // The peer is already closing; its own close event tidies up.
  }
}

/** Marks the seat as handled and closes it; the caller does what the departure requires. */
function shut(seat: Seat, code: number, reason: string): void {
  seat.member.gone = true;
  try {
    seat.ws.serializeAttachment(seat.member);
    seat.ws.close(code, reason);
  } catch {
    // Already closed by the peer.
  }
}

/** One room: at most one host and `MAX_GUESTS` guests. It forwards frames and stores none. */
export class Room extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get("role");
    if (!isRole(role)) return new Response("bad role", { status: 400 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const response = new Response(null, { status: 101, webSocket: client });

    const host = this.seats("host")[0];
    const refusal =
      role === "host"
        ? host && ([CLOSE.hostTaken, "room already has a host"] as const)
        : !host
          ? ([CLOSE.noHost, "no host in this room"] as const)
          : this.seats("guest").length >= MAX_GUESTS && ([CLOSE.roomFull, "room full"] as const);
    if (refusal) {
      // Accepted without an attachment: a custom close code needs an open socket, and this one is never a member.
      this.ctx.acceptWebSocket(server);
      server.close(refusal[0], refusal[1]);
      return response;
    }

    const now = Date.now();
    const member: Member = { role, id: this.freshId(), gone: false, seen: role === "host" ? now : 0, bucket: newBucket(now) };
    this.ctx.acceptWebSocket(server, role === "host" ? ["host"] : ["guest", guestTag(member.id)]);
    server.serializeAttachment(member);
    send(server, JSON.stringify({ t: "hello", id: member.id, role }));
    if (host) send(host.ws, JSON.stringify({ t: "join", id: member.id }));
    else await this.ctx.storage.setAlarm(now + IDLE_MS);
    return response;
  }

  override async webSocketMessage(ws: WebSocket, frame: string | ArrayBuffer): Promise<void> {
    const seat = seatOf(ws);
    if (!seat) return;
    if (typeof frame !== "string" || frameTooLarge(frame)) {
      await this.expel(seat, CLOSE.tooLarge, "message too large");
      return;
    }

    const now = Date.now();
    const verdict = take(seat.member.bucket, now);
    seat.member.seen = now;
    ws.serializeAttachment(seat.member);
    if (verdict === "close") {
      await this.expel(seat, CLOSE.rateLimit, "rate limit");
      return;
    }
    if (verdict === "drop") return;

    const message = parseMessage(frame);
    if (message) this.relay(seat, frame, message);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      // Completes the closing handshake a peer started; without it the peer waits for its own timeout.
      ws.close(1000);
    } catch {
      // The relay closed this socket first.
    }
    await this.left(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.left(ws);
  }

  /** The idle check: `seen` moves with every frame, so the alarm is written once per two idle hours, not per message. */
  override async alarm(): Promise<void> {
    const seats = [...this.seats("host"), ...this.seats("guest")];
    if (seats.length === 0) return;
    const due = Math.max(...seats.map((seat) => seat.member.seen)) + IDLE_MS;
    if (Date.now() >= due) await this.closeRoom();
    else await this.ctx.storage.setAlarm(due);
  }

  private relay(from: Seat, frame: string, message: Message): void {
    if (from.member.role === "guest") {
      const host = this.seats("host")[0];
      if (!host) return;
      message.from = from.member.id;
      send(host.ws, JSON.stringify(message));
      return;
    }
    if (!Object.hasOwn(message, "to")) {
      for (const guest of this.seats("guest")) send(guest.ws, frame);
      return;
    }
    // A `to` that names no guest in this room is dropped, whatever its type: it never falls back to everyone.
    if (!isSocketId(message.to)) return;
    for (const guest of this.seats(guestTag(message.to))) send(guest.ws, frame);
  }

  /** Open member sockets of one role, or the guest with one id. */
  private seats(tag: string): Seat[] {
    const seats: Seat[] = [];
    for (const ws of this.ctx.getWebSockets(tag)) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const seat = seatOf(ws);
      if (seat) seats.push(seat);
    }
    return seats;
  }

  private freshId(): string {
    for (;;) {
      const id = newSocketId();
      const taken = this.seats("host").some((seat) => seat.member.id === id) || this.ctx.getWebSockets(guestTag(id)).length > 0;
      if (!taken) return id;
    }
  }

  private async left(ws: WebSocket): Promise<void> {
    const seat = seatOf(ws);
    if (!seat) return;
    seat.member.gone = true;
    try {
      ws.serializeAttachment(seat.member);
    } catch {
      // The socket is beyond writing to; it no longer shows up as open either.
    }
    await this.departed(seat.member);
  }

  private async expel(seat: Seat, code: number, reason: string): Promise<void> {
    shut(seat, code, reason);
    await this.departed(seat.member);
  }

  private async departed(member: Member): Promise<void> {
    if (member.role === "host") {
      await this.closeRoom();
      return;
    }
    const host = this.seats("host")[0];
    if (!host) return;
    if (member.seen > host.member.seen) {
      host.member.seen = member.seen;
      host.ws.serializeAttachment(host.member);
    }
    send(host.ws, JSON.stringify({ t: "leave", id: member.id }));
  }

  private async closeRoom(): Promise<void> {
    for (const seat of [...this.seats("host"), ...this.seats("guest")]) shut(seat, CLOSE.roomClosed, "room closed");
    await this.ctx.storage.deleteAlarm();
  }
}
