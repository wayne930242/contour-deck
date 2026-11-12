import { describe, expect, it } from "vitest";
import { openRoom } from "./peer";

describe("forwarding", () => {
  it("sends a guest's message to the host only, never to another guest", async () => {
    const { host, guests } = await openRoom(2);
    const [a, b] = guests as [(typeof guests)[0], (typeof guests)[0]];

    a.send({ t: "cmd", c: "next" });
    expect(await host.next()).toEqual({ t: "cmd", c: "next", from: a.id });

    // The relay has handled a's frame; whatever b gets next must be the host's marker, not a's frame.
    host.send({ t: "mark", to: b.id });
    expect(await b.next()).toEqual({ t: "mark", to: b.id });
    host.send({ t: "mark", to: a.id });
    expect(await a.next()).toEqual({ t: "mark", to: a.id });
  });

  it("overwrites the `from` a guest sent with that guest's id", async () => {
    const { host, guests } = await openRoom(2);
    const [a, b] = guests as [(typeof guests)[0], (typeof guests)[0]];

    a.send({ t: "cmd", c: "next", from: b.id });
    expect(await host.next()).toEqual({ t: "cmd", c: "next", from: a.id });

    a.send('{"t":"ping","from":"x","from":{"id":"y"}}');
    expect(await host.next()).toEqual({ t: "ping", from: a.id });
  });
});
