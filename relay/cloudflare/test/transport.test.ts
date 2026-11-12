import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type Peer, connect, newRoom, openRoom, request, roomStub, upgrade } from "./peer";

async function status(response: Response): Promise<number> {
  await response.text();
  return response.status;
}

describe("HTTP", () => {
  it("answers GET /v1/health with 200 ok, without an Origin", async () => {
    const response = await request("/v1/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("answers 404 outside /v1", async () => {
    expect(await status(await request("/"))).toBe(404);
    expect(await status(await request(`/v1/room/${newRoom()}/extra`, { Upgrade: "websocket", Origin: "https://deck.example" }))).toBe(404);
  });

  it.each([
    ["too short", "0123456789ABCDEFGHJKMNPQR"],
    ["too long", "0123456789ABCDEFGHJKMNPQRST"],
    ["not Crockford base32", "U123456789ABCDEFGHJKMNPQRS"],
    ["percent-encoded", "0123456789ABCDEFGHJKMNPQR%53"],
  ])("answers 400 to a room id that is %s", async (_name, room) => {
    expect(await status(await upgrade(room, "host"))).toBe(400);
  });

  it.each([["admin"], [""], ["HOST"]])("answers 400 to role=%s", async (role) => {
    expect(await status(await upgrade(newRoom(), role))).toBe(400);
  });

  it("answers 400 without a role", async () => {
    expect(await status(await request(`/v1/room/${newRoom()}`, { Upgrade: "websocket", Origin: "https://deck.example" }))).toBe(400);
  });

  it("answers 403 before the upgrade when the Origin is not allowed", async () => {
    const response = await upgrade(newRoom(), "host", "https://evil.example");
    expect(response.webSocket).toBeNull();
    expect(await status(response)).toBe(403);
  });

  it("answers 403 without an Origin, and before it looks at the room id", async () => {
    expect(await status(await upgrade(newRoom(), "host", null))).toBe(403);
    expect(await status(await upgrade("not-a-room", "host", "https://evil.example"))).toBe(403);
  });

  it("upgrades an Origin that an any-port entry allows", async () => {
    const host = await connect(newRoom(), "host", "http://localhost:53124");
    expect((await host.hello()).role).toBe("host");
  });

  it("answers 426 to a plain GET on a room", async () => {
    expect(await status(await request(`/v1/room/${newRoom()}?role=host`, { Origin: "https://deck.example" }))).toBe(426);
  });

  it("reaches the same room whatever the case of its id", async () => {
    const room = newRoom();
    const host = await connect(room, "host");
    await host.hello();
    const second = await connect(room.toLowerCase(), "host");
    expect((await second.closed).code).toBe(4009);
  });
});

function socketCount(room: string): Promise<number> {
  return runInDurableObject(roomStub(room), (_instance, state) => state.getWebSockets().length);
}

describe("frames", () => {
  /** The host's next frame after the room has handled everything `guest` sent before. */
  async function afterMarker(host: Peer, guest: Peer): Promise<unknown> {
    guest.send({ t: "marker" });
    return host.next();
  }

  it("forwards a frame of exactly 2048 bytes", async () => {
    const { host, guests } = await openRoom(1);
    const guest = guests[0] as Peer;
    const frame = JSON.stringify({ t: "ink", pad: "" });
    guest.send(frame.replace('""', `"${"x".repeat(2048 - frame.length)}"`));
    const got = await host.next();
    expect(got.t).toBe("ink");
    expect((got.pad as string).length).toBe(2048 - frame.length);
  });

  it("closes a socket that sends 2049 bytes with 1009, and tells the host it left", async () => {
    const { host, guests } = await openRoom(1);
    const guest = guests[0] as Peer;
    const frame = JSON.stringify({ t: "ink", pad: "" });
    guest.send(frame.replace('""', `"${"x".repeat(2049 - frame.length)}"`));
    expect((await guest.closed).code).toBe(1009);
    expect(await host.next()).toEqual({ t: "leave", id: guest.id });
  });

  it("tells the host once when the closing handshake of a socket it closed completes", async () => {
    const { room, host, guests } = await openRoom(2);
    const [a, b] = guests as [Peer, Peer];
    a.send("x".repeat(2049));
    expect((await a.closed).code).toBe(1009);
    expect(await host.next()).toEqual({ t: "leave", id: a.id });

    // Once the room no longer holds a's socket, its close event has been delivered.
    for (let tries = 0; (await socketCount(room)) !== 2; tries++) {
      if (tries === 200) throw new Error("the closed socket never went away");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await afterMarker(host, b)).toEqual({ t: "marker", from: b.id });
  });

  it("measures the limit in UTF-8 bytes", async () => {
    const { guests } = await openRoom(1);
    const guest = guests[0] as Peer;
    // 700 characters, 2100 bytes.
    guest.send(JSON.stringify({ t: "ink", pad: "洪".repeat(697) }));
    expect((await guest.closed).code).toBe(1009);
  });

  it("closes a socket that sends a binary frame with 1009", async () => {
    const { host, guests } = await openRoom(1);
    const guest = guests[0] as Peer;
    guest.send(new TextEncoder().encode('{"t":"cmd"}').buffer as ArrayBuffer);
    expect((await guest.closed).code).toBe(1009);
    expect(await host.next()).toEqual({ t: "leave", id: guest.id });
  });

  it("closes the room when the host is the one that sends too much", async () => {
    const { host, guests } = await openRoom(1);
    host.send("x".repeat(2049));
    expect((await host.closed).code).toBe(1009);
    expect((await (guests[0] as Peer).closed).code).toBe(4000);
  });

  it.each([["not JSON"], ["[1,2]"], ['{"c":"next"}'], ['{"t":7}']])("drops %s", async (frame) => {
    const { host, guests } = await openRoom(1);
    const guest = guests[0] as Peer;
    guest.send(frame);
    expect(await afterMarker(host, guest)).toEqual({ t: "marker", from: guest.id });
  });
});
