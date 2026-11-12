import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_MS } from "../src/protocol";
import { type Peer, connect, newRoom, openRoom, roomStub } from "./peer";

const ID = /^[0-9A-HJKMNP-TV-Z]{8}$/;

function pendingAlarm(room: string): Promise<number | null> {
  return runInDurableObject(roomStub(room), (_instance, state) => state.storage.getAlarm());
}

afterEach(() => {
  vi.useRealTimers();
});

describe("opening", () => {
  it("greets every socket with hello, its role, and an 8-character id", async () => {
    const room = newRoom();
    const host = await connect(room, "host");
    const hostHello = await host.hello();
    expect(hostHello).toEqual({ t: "hello", id: expect.stringMatching(ID), role: "host" });

    const guest = await connect(room, "guest");
    const guestHello = await guest.hello();
    expect(guestHello).toEqual({ t: "hello", id: expect.stringMatching(ID), role: "guest" });
    expect(guestHello.id).not.toBe(hostHello.id);
  });

  it("closes a second host with 4009 and leaves the first in place", async () => {
    const { room, host } = await openRoom(0);
    const second = await connect(room, "host");
    expect(await second.closed).toEqual({ code: 4009, reason: "room already has a host" });

    const guest = await connect(room, "guest");
    await guest.hello();
    expect(await host.next()).toEqual({ t: "join", id: guest.id });
  });

  it("closes a guest with 4004 when the room has no host", async () => {
    const guest = await connect(newRoom(), "guest");
    expect(await guest.closed).toEqual({ code: 4004, reason: "no host in this room" });
  });

  it("closes a fifth guest with 4029, and takes one again after a guest left", async () => {
    const { room, host, guests } = await openRoom(4);
    const fifth = await connect(room, "guest");
    expect(await fifth.closed).toEqual({ code: 4029, reason: "room full" });

    (guests[0] as Peer).close();
    expect(await host.next()).toEqual({ t: "leave", id: (guests[0] as Peer).id });
    const next = await connect(room, "guest");
    await next.hello();
    expect(await host.next()).toEqual({ t: "join", id: next.id });
  });

  it("tells the host about every guest that joins and leaves", async () => {
    const room = newRoom();
    const host = await connect(room, "host");
    await host.hello();
    const a = await connect(room, "guest");
    await a.hello();
    expect(await host.next()).toEqual({ t: "join", id: a.id });
    const b = await connect(room, "guest");
    await b.hello();
    expect(await host.next()).toEqual({ t: "join", id: b.id });

    a.close();
    expect(await host.next()).toEqual({ t: "leave", id: a.id });
    b.close(1001);
    expect(await host.next()).toEqual({ t: "leave", id: b.id });
  });
});

describe("host messages", () => {
  it("go to the guest named by `to` only", async () => {
    const { host, guests } = await openRoom(3);
    const [a, b, c] = guests as [Peer, Peer, Peer];
    host.send({ t: "pair", to: b.id, code: "1234" });
    host.send({ t: "mark" });
    expect(await b.next()).toEqual({ t: "pair", to: b.id, code: "1234" });
    expect(await b.next()).toEqual({ t: "mark" });
    expect(await a.next()).toEqual({ t: "mark" });
    expect(await c.next()).toEqual({ t: "mark" });
  });

  it("go to every guest without `to`", async () => {
    const { host, guests } = await openRoom(4);
    host.send({ t: "state", mode: "stage", at: "1.1.1" });
    for (const guest of guests) expect(await guest.next()).toEqual({ t: "state", mode: "stage", at: "1.1.1" });
  });

  it.each([
    ["an unknown id", "ZZZZZZZZ"],
    ["the host's own id", "host"],
    ["a role tag", "guest"],
    ["null", null],
    ["a number", 7],
    ["a list of ids", ["all"]],
  ])("are dropped when `to` is %s", async (_name, to) => {
    const { host, guests } = await openRoom(2);
    host.send({ t: "grant", to: to === "host" ? host.id : to, token: "secret" });
    host.send({ t: "mark" });
    for (const guest of guests) expect(await guest.next()).toEqual({ t: "mark" });
  });

  it("are not echoed to the host", async () => {
    const { host, guests } = await openRoom(1);
    const guest = guests[0] as Peer;
    host.send({ t: "state" });
    expect(await guest.next()).toEqual({ t: "state" });
    guest.send({ t: "ping" });
    expect(await host.next()).toEqual({ t: "ping", from: guest.id });
  });
});

describe("closing", () => {
  it("closes every guest with 4000 when the host closes, and the room is gone", async () => {
    const { room, host, guests } = await openRoom(3);
    host.close();
    for (const guest of guests) expect(await guest.closed).toEqual({ code: 4000, reason: "room closed" });
    expect(await pendingAlarm(room)).toBeNull();

    const late = await connect(room, "guest");
    expect((await late.closed).code).toBe(4004);
  });

  it("lets a new host open the same room afterwards, without the old guests", async () => {
    const { room, host, guests } = await openRoom(2);
    host.close();
    for (const guest of guests) await guest.closed;

    const again = await connect(room, "host");
    await again.hello();
    const guest = await connect(room, "guest");
    await guest.hello();
    // The first thing the new host hears is this join: no leave of a guest from the old room.
    expect(await again.next()).toEqual({ t: "join", id: guest.id });
  });
});

describe("idle rooms", () => {
  const T0 = Date.UTC(2026, 10, 12, 9, 0, 0);

  it("closes everyone with 4000 two hours after the last message", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const { room, host, guests } = await openRoom(1);
    const guest = guests[0] as Peer;
    expect(await pendingAlarm(room)).toBe(T0 + IDLE_MS);

    // A guest's message an hour in moves the deadline; the alarm of the first deadline only re-arms.
    vi.setSystemTime(T0 + IDLE_MS / 2);
    guest.send({ t: "ping" });
    await host.next();
    vi.setSystemTime(T0 + IDLE_MS);
    expect(await runDurableObjectAlarm(roomStub(room))).toBe(true);
    expect(await pendingAlarm(room)).toBe(T0 + IDLE_MS / 2 + IDLE_MS);
    host.send({ t: "mark" });
    expect(await guest.next()).toEqual({ t: "mark" });

    // The host's mark moved it again; one millisecond short of two hours later nothing happens.
    vi.setSystemTime(T0 + 2 * IDLE_MS - 1);
    expect(await runDurableObjectAlarm(roomStub(room))).toBe(true);
    expect(await pendingAlarm(room)).toBe(T0 + 2 * IDLE_MS);

    vi.setSystemTime(T0 + 2 * IDLE_MS);
    expect(await runDurableObjectAlarm(roomStub(room))).toBe(true);
    expect(await host.closed).toEqual({ code: 4000, reason: "room closed" });
    expect(await guest.closed).toEqual({ code: 4000, reason: "room closed" });
    expect(await pendingAlarm(room)).toBeNull();
  });

  it("closes a host that never got a message two hours after it opened", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const { room, host } = await openRoom(0);
    vi.setSystemTime(T0 + IDLE_MS);
    expect(await runDurableObjectAlarm(roomStub(room))).toBe(true);
    expect((await host.closed).code).toBe(4000);
  });

  it("counts the messages of a guest that has left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const { room, host, guests } = await openRoom(1);
    const guest = guests[0] as Peer;
    vi.setSystemTime(T0 + 1000);
    guest.send({ t: "ping" });
    await host.next();
    guest.close();
    expect(await host.next()).toEqual({ t: "leave", id: guest.id });

    vi.setSystemTime(T0 + IDLE_MS);
    expect(await runDurableObjectAlarm(roomStub(room))).toBe(true);
    expect(await pendingAlarm(room)).toBe(T0 + 1000 + IDLE_MS);
  });
});

describe("hibernation", () => {
  it("keeps roles, ids, and limits when the room is evicted from memory", async () => {
    const { room, host, guests } = await openRoom(4);
    const [a, b] = guests as [Peer, Peer, Peer, Peer];
    await evictDurableObject(roomStub(room));

    a.send({ t: "cmd", c: "next", from: b.id });
    expect(await host.next()).toEqual({ t: "cmd", c: "next", from: a.id });
    host.send({ t: "pong", to: a.id });
    expect(await a.next()).toEqual({ t: "pong", to: a.id });
    host.send({ t: "mark" });
    expect(await b.next()).toEqual({ t: "mark" });

    await evictDurableObject(roomStub(room));
    expect((await (await connect(room, "host")).closed).code).toBe(4009);
    expect((await (await connect(room, "guest")).closed).code).toBe(4029);

    await evictDurableObject(roomStub(room));
    host.close();
    for (const guest of guests) expect((await guest.closed).code).toBe(4000);
  });
});
