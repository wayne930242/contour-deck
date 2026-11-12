import { describe, expect, it } from "vitest";
import { HOSTS_PER_MINUTE, UPGRADES_PER_MINUTE } from "../src/protocol";
import { connect, keyOf, newKey, newRoom, openRoom, request, upgrade } from "./peer";

async function refusal(response: Response): Promise<[number, string]> {
  return [response.status, await response.text()];
}

describe("the host seat", () => {
  it.each([
    ["no key", null],
    ["an empty key", ""],
    ["a malformed key", "not-a-key"],
    ["a key 27 characters long", "0123456789ABCDEFGHJKMNPQRST"],
  ])("answers 403 before the upgrade to a host with %s", async (_name, key) => {
    const response = await upgrade(await newRoom(), "host", { key });
    expect(response.webSocket).toBeNull();
    expect(await refusal(response)).toEqual([403, "bad host key"]);
  });

  it("answers 403 to the key of another room, and to the room id given as its own key", async () => {
    const room = await newRoom();
    const other = await newRoom();
    expect(await refusal(await upgrade(room, "host", { key: keyOf(other) }))).toEqual([403, "bad host key"]);
    expect(await refusal(await upgrade(room, "host", { key: room }))).toEqual([403, "bad host key"]);
    expect(await refusal(await upgrade(room, "host", { key: newKey() }))).toEqual([403, "bad host key"]);
  });

  it("takes the key in either case", async () => {
    const room = await newRoom();
    const host = await connect(room, "host", { key: keyOf(room)!.toLowerCase() });
    expect((await host.hello()).role).toBe("host");
  });

  it("keeps a stranger out of a room whose host dropped: the guest's resume never reaches anyone without the key", async () => {
    const { room, host, guests } = await openRoom(1);
    const phone = guests[0]!;
    host.send({ t: "grant", to: phone.id, token: "SECRET_TOKEN" });
    expect((await phone.next()).t).toBe("grant");
    host.close();
    expect((await phone.closed).code).toBe(4000);

    // A stranger who read the room from the projected QR asks for the empty host seat.
    expect((await upgrade(room, "host", { key: null })).status).toBe(403);
    // The phone comes back and finds no host to give its token to.
    const back = await connect(room, "guest");
    expect((await back.closed).code).toBe(4004);

    // The real host, with its key, takes the room again, and the phone's resume reaches it.
    const again = await connect(room, "host");
    await again.hello();
    const phoneAgain = await connect(room, "guest");
    await phoneAgain.hello();
    expect(await again.next()).toEqual({ t: "join", id: phoneAgain.id });
    phoneAgain.send({ t: "resume", token: "SECRET_TOKEN" });
    expect(await again.next()).toEqual({ t: "resume", token: "SECRET_TOKEN", from: phoneAgain.id });
  });

  it("lets a guest in with the room alone", async () => {
    const { room, host } = await openRoom(0);
    const guest = await connect(room, "guest", { key: null });
    await guest.hello();
    expect(await host.next()).toEqual({ t: "join", id: guest.id });
  });
});

describe("requests per client address", () => {
  it(`answers 429 to room requests past ${UPGRADES_PER_MINUTE} a minute from one address, and not to another address`, async () => {
    const room = await newRoom();
    const address = "203.0.113.7";
    const statuses: number[] = [];
    for (let i = 0; i <= UPGRADES_PER_MINUTE; i++) {
      const response = await request(`/v1/room/${room}?role=guest`, { Origin: "https://deck.example", "CF-Connecting-IP": address });
      await response.text();
      statuses.push(response.status);
    }
    // Plain GETs count as upgrades do: the limit comes before anything else a room path checks.
    expect(statuses.slice(0, UPGRADES_PER_MINUTE).every((status) => status === 426)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await upgrade(room, "guest", { address })).status).toBe(429);
    expect((await upgrade(room, "guest")).status).not.toBe(429);
  });

  it("seats a host with its key from an address whose guests used up their budget", async () => {
    const room = await newRoom();
    const address = "203.0.113.8";
    // A venue network: refused guests behind one address spend the guest budget.
    for (let i = 0; i <= UPGRADES_PER_MINUTE; i++) await (await request(`/v1/room/${room}?role=guest`, { Origin: "https://deck.example", "CF-Connecting-IP": address })).text();
    expect((await upgrade(room, "guest", { address })).status).toBe(429);
    // A stranger without the key still counts as a guest.
    expect((await upgrade(room, "host", { address, key: null })).status).toBe(429);
    expect((await upgrade(room, "host", { address, key: newKey() })).status).toBe(429);

    const host = await connect(room, "host", { address });
    expect((await host.hello()).role).toBe("host");
  });

  it(`answers 429 to host requests with a key past ${HOSTS_PER_MINUTE} a minute from one address`, async () => {
    const room = await newRoom();
    const address = "203.0.113.9";
    const statuses: number[] = [];
    for (let i = 0; i <= HOSTS_PER_MINUTE; i++) {
      const response = await request(`/v1/room/${room}?role=host&key=${keyOf(room)}`, { Origin: "https://deck.example", "CF-Connecting-IP": address });
      await response.text();
      statuses.push(response.status);
    }
    expect(statuses.slice(0, HOSTS_PER_MINUTE).every((status) => status === 426)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // The host budget is its own: guests from that address still get in.
    expect((await upgrade(room, "guest", { address })).status).not.toBe(429);
  });
});
