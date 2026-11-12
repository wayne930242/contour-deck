import { afterEach, describe, expect, it, vi } from "vitest";
import { runInDurableObject } from "cloudflare:test";
import { type Peer, openRoom, roomStub } from "./peer";

const T0 = Date.UTC(2026, 10, 12, 9, 0, 0);

afterEach(() => {
  vi.useRealTimers();
});

/** When the run of drops of the room's only guest (or its host) began, straight from the socket's attachment. */
function excessSince(room: string, role: "host" | "guest" = "guest"): Promise<number | null> {
  return runInDurableObject(roomStub(room), (_instance, state) => {
    const ws = state.getWebSockets(role)[0];
    return (ws?.deserializeAttachment() as { bucket: { excessSince: number | null } } | null)?.bucket.excessSince ?? null;
  });
}

/** Reads the host's frames up to and including the first one of type `until`. */
async function drain(host: Peer, until: string): Promise<Array<Record<string, unknown>>> {
  const frames: Array<Record<string, unknown>> = [];
  for (;;) {
    const frame = await host.next();
    frames.push(frame);
    if (frame.t === until) return frames;
  }
}

describe("rate limit", () => {
  it("forwards a burst of 120 and drops the rest", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const { host, guests } = await openRoom(1);
    const guest = guests[0] as Peer;

    for (let i = 0; i < 125; i++) guest.send({ t: "ptr", i });
    guest.close();
    const frames = await drain(host, "leave");
    expect(frames.length).toBe(121);
    expect(frames.slice(0, 120).map((frame) => frame.i)).toEqual(Array.from({ length: 120 }, (_, i) => i));
  });

  it("lets 60 more through for every second that passes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const { host, guests } = await openRoom(1);
    const guest = guests[0] as Peer;

    for (let i = 0; i < 120; i++) guest.send({ t: "ptr", i });
    for (let i = 0; i < 120; i++) await host.next();

    vi.setSystemTime(T0 + 500);
    for (let i = 0; i < 35; i++) guest.send({ t: "ptr", i });
    guest.close();
    expect((await drain(host, "leave")).length).toBe(31);
  });

  it("limits each socket on its own", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const { host, guests } = await openRoom(2);
    const [a, b] = guests as [Peer, Peer];

    for (let i = 0; i < 125; i++) a.send({ t: "ptr", i });
    a.close();
    await drain(host, "leave");
    b.send({ t: "ptr" });
    expect(await host.next()).toEqual({ t: "ptr", from: b.id });
    for (let i = 0; i < 125; i++) host.send({ t: "state", i });
    for (let i = 0; i < 120; i++) expect((await b.next()).i).toBe(i);
  });

  /**
   * Keeps `sender` over its rate from T0 to T0 + 10 s and leaves the frame that ends it in flight.
   * `receiver` is who its frames are forwarded to; it has read all but the last 60 when this returns.
   */
  async function exceedForTenSeconds(room: string, sender: Peer, receiver: Peer, role: "host" | "guest"): Promise<void> {
    // 121 frames at T0: the last one is dropped, which starts the run of drops. A dropped frame shows nowhere
    // outside the room, so wait for it in the socket's state before the clock moves.
    for (let i = 0; i < 121; i++) sender.send({ t: "ptr" });
    for (let i = 0; i < 120; i++) await receiver.next();
    for (let tries = 0; (await excessSince(room, role)) !== T0; tries++) {
      if (tries === 200) throw new Error("the 121st frame was never dropped");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // Every 1.5 s the bucket gains 90 and the sender spends them all: it never refills, so the run goes on.
    for (let step = 1; step <= 6; step++) {
      vi.setSystemTime(T0 + step * 1500);
      for (let i = 0; i < 90; i++) sender.send({ t: "ptr" });
      for (let i = 0; i < 90; i++) expect((await receiver.next()).t).toBe("ptr");
    }
    expect(await excessSince(room, role)).toBe(T0);

    // 10 s after the first drop the bucket holds 60: the 61st frame is over the rate again.
    vi.setSystemTime(T0 + 10_000);
    for (let i = 0; i < 61; i++) sender.send({ t: "ptr" });
  }

  it("closes a socket with 1008 after 10 s of sustained excess, and tells the host it left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const { room, host, guests } = await openRoom(1);
    const guest = guests[0] as Peer;

    await exceedForTenSeconds(room, guest, host, "guest");
    expect(await guest.closed).toEqual({ code: 1008, reason: "rate limit" });
    const frames = await drain(host, "leave");
    expect(frames.length).toBe(61);
    expect(frames[60]).toEqual({ t: "leave", id: guest.id });
  });

  it("closes the room when the host is the one over the rate", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const { room, host, guests } = await openRoom(1);
    const guest = guests[0] as Peer;

    await exceedForTenSeconds(room, host, guest, "host");
    expect((await host.closed).code).toBe(1008);
    expect((await guest.closed).code).toBe(4000);
  });
});
