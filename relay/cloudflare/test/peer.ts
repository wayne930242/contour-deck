import { env, exports } from "cloudflare:workers";

export const ORIGIN = "https://deck.example";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A fresh room id, as a host would make it. */
export function newRoom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  return Array.from(bytes, (byte) => CROCKFORD[byte & 31]).join("");
}

export function roomStub(room: string): DurableObjectStub {
  return env.ROOM.get(env.ROOM.idFromName(room.toUpperCase()));
}

export function request(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(new Request(`https://relay.test${path}`, { headers }));
}

export function upgrade(room: string, role: string, origin: string | null = ORIGIN): Promise<Response> {
  const headers: Record<string, string> = { Upgrade: "websocket" };
  if (origin !== null) headers.Origin = origin;
  return request(`/v1/room/${room}?role=${role}`, headers);
}

export interface Closed {
  code: number;
  reason: string;
}

export interface Frame {
  t: string;
  [field: string]: unknown;
}

/** One end of a relay connection, with its incoming frames queued in arrival order. */
export class Peer {
  readonly closed: Promise<Closed>;
  /** The id from `hello`; empty until `hello()` ran. */
  id = "";
  private readonly queue: Frame[] = [];
  private waiter: ((frame: Frame) => void) | null = null;

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const frame = JSON.parse(event.data as string) as Frame;
      if (this.waiter) {
        const waiter = this.waiter;
        this.waiter = null;
        waiter(frame);
      } else this.queue.push(frame);
    });
    this.closed = new Promise((resolve) => {
      ws.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason }));
    });
    ws.accept();
  }

  /** The next frame; rejects when none arrives in time. */
  next(timeoutMs = 2000): Promise<Frame> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error("no frame arrived"));
      }, timeoutMs);
      this.waiter = (frame) => {
        clearTimeout(timer);
        resolve(frame);
      };
    });
  }

  async hello(): Promise<Frame> {
    const frame = await this.next();
    this.id = String(frame.id);
    return frame;
  }

  send(message: unknown): void {
    this.ws.send(typeof message === "string" || message instanceof ArrayBuffer ? message : JSON.stringify(message));
  }

  close(code = 1000): void {
    this.ws.close(code, "bye");
  }
}

/** Opens a socket and returns it once the relay answered 101. */
export async function connect(room: string, role: "host" | "guest", origin: string = ORIGIN): Promise<Peer> {
  const response = await upgrade(room, role, origin);
  if (response.status !== 101 || !response.webSocket) throw new Error(`upgrade answered ${response.status}`);
  return new Peer(response.webSocket);
}

/** A room with a host and `guests` guests, every hello and join already read. */
export async function openRoom(guests: number): Promise<{ room: string; host: Peer; guests: Peer[] }> {
  const room = newRoom();
  const host = await connect(room, "host");
  await host.hello();
  const joined: Peer[] = [];
  for (let i = 0; i < guests; i++) {
    const guest = await connect(room, "guest");
    await guest.hello();
    await host.next();
    joined.push(guest);
  }
  return { room, host, guests: joined };
}
