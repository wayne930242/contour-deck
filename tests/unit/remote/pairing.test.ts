/** The host's pairing state machine: who holds control, and which token brings it back. */
import { describe, expect, it } from "vitest";
import { createPairing, REQUEST_TTL } from "../../../src/remote/pairing.js";
import type { HostMessage } from "../../../src/remote/protocol.js";

function setup(token: string | null = null) {
  const sent: HostMessage[] = [];
  let now = 1000;
  let changes = 0;
  const pairing = createPairing({ send: message => sent.push(message), changed: () => changes++, token, now: () => now });
  return {
    pairing,
    sent,
    take: () => sent.splice(0),
    tick: (ms: number) => (now += ms),
    get changes() {
      return changes;
    },
  };
}

const granted = (sent: HostMessage[]) => {
  const grant = sent.find(message => message.t === "grant");
  if (grant?.t !== "grant") throw new Error("no grant was sent");
  return grant;
};

describe("createPairing", () => {
  it("gives every guest its own 4-digit code and no control", () => {
    const { pairing, sent } = setup();
    pairing.join("aaaaaaaa");
    pairing.join("bbbbbbbb");
    expect(sent.map(message => message.t)).toEqual(["pair", "pair"]);
    expect(pairing.requests.map(request => request.id)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    for (const request of pairing.requests) expect(request.code).toMatch(/^\d{4}$/);
    expect(sent[0]).toEqual({ t: "pair", to: "aaaaaaaa", code: pairing.requests[0].code });
    expect(pairing.controls("aaaaaaaa")).toBe(false);
    expect(pairing.controls("bbbbbbbb")).toBe(false);
    expect(pairing.controls(undefined)).toBe(false);
    expect(pairing.token).toBeNull();
  });

  it("allow grants a 22-character token and control to that guest only", () => {
    const { pairing, take } = setup();
    pairing.join("aaaaaaaa");
    pairing.join("bbbbbbbb");
    take();
    pairing.allow("aaaaaaaa");
    const sent = take();
    expect(sent).toEqual([{ t: "grant", to: "aaaaaaaa", token: pairing.token }]);
    expect(pairing.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(pairing.controls("aaaaaaaa")).toBe(true);
    expect(pairing.controls("bbbbbbbb")).toBe(false);
    expect(pairing.requests.map(request => request.id)).toEqual(["bbbbbbbb"]);
  });

  it("deny tells the guest and leaves it without control", () => {
    const { pairing, take } = setup();
    pairing.join("aaaaaaaa");
    take();
    pairing.deny("aaaaaaaa");
    expect(take()).toEqual([{ t: "deny", to: "aaaaaaaa" }]);
    expect(pairing.requests).toEqual([]);
    expect(pairing.controls("aaaaaaaa")).toBe(false);
    // Allowing a guest that is not waiting does nothing: a denied phone cannot be granted by a stale click.
    pairing.allow("aaaaaaaa");
    expect(take()).toEqual([]);
    expect(pairing.controls("aaaaaaaa")).toBe(false);
  });

  it("granting a second guest revokes the first, and the first token stops working", () => {
    const { pairing, take } = setup();
    pairing.join("aaaaaaaa");
    pairing.allow("aaaaaaaa");
    const first = pairing.token!;
    pairing.join("bbbbbbbb");
    take();
    pairing.allow("bbbbbbbb");
    const sent = take();
    expect(sent[0]).toEqual({ t: "revoke", to: "aaaaaaaa" });
    expect(granted(sent).to).toBe("bbbbbbbb");
    expect(pairing.token).not.toBe(first);
    expect(pairing.controls("aaaaaaaa")).toBe(false);
    expect(pairing.controls("bbbbbbbb")).toBe(true);
    // The first phone reconnects and presents its old token.
    pairing.leave("aaaaaaaa");
    pairing.join("cccccccc");
    expect(pairing.resume("cccccccc", first)).toBe(false);
    expect(pairing.controls("cccccccc")).toBe(false);
    expect(pairing.controls("bbbbbbbb")).toBe(true);
  });

  it("resume with the granted token restores control without asking", () => {
    const { pairing, take } = setup();
    pairing.join("aaaaaaaa");
    pairing.allow("aaaaaaaa");
    const token = pairing.token!;
    pairing.leave("aaaaaaaa");
    expect(pairing.controller).toBeNull();
    expect(pairing.token).toBe(token);
    take();
    pairing.join("dddddddd");
    expect(pairing.requests).toHaveLength(1);
    expect(pairing.resume("dddddddd", token)).toBe(true);
    expect(take().at(-1)).toEqual({ t: "grant", to: "dddddddd", token });
    expect(pairing.requests).toEqual([]);
    expect(pairing.controls("dddddddd")).toBe(true);
  });

  it("resume fails with a wrong token, with no token in force, and from an id the relay never announced", () => {
    const { pairing, take } = setup();
    pairing.join("aaaaaaaa");
    expect(pairing.resume("aaaaaaaa", "x".repeat(22))).toBe(false);
    pairing.allow("aaaaaaaa");
    const token = pairing.token!;
    take();
    pairing.join("bbbbbbbb");
    expect(pairing.resume("bbbbbbbb", `${token.slice(0, 21)}!`)).toBe(false);
    expect(pairing.resume("zzzzzzzz", token)).toBe(false);
    expect(pairing.controls("bbbbbbbb")).toBe(false);
    expect(pairing.controls("aaaaaaaa")).toBe(true);
    expect(take().map(message => message.t)).toEqual(["pair"]);
  });

  it("revoke takes control back and kills the token, connected or not", () => {
    const { pairing, take } = setup();
    pairing.join("aaaaaaaa");
    pairing.allow("aaaaaaaa");
    const token = pairing.token!;
    take();
    pairing.revoke();
    expect(take()).toEqual([{ t: "revoke", to: "aaaaaaaa" }]);
    expect(pairing.controls("aaaaaaaa")).toBe(false);
    expect(pairing.resume("aaaaaaaa", token)).toBe(false);
    // Paired but offline: nothing to send, the token still dies.
    pairing.join("bbbbbbbb");
    pairing.allow("bbbbbbbb");
    const second = pairing.token!;
    pairing.leave("bbbbbbbb");
    take();
    pairing.revoke();
    expect(take()).toEqual([]);
    pairing.join("cccccccc");
    expect(pairing.resume("cccccccc", second)).toBe(false);
  });

  it("a token restored after a host reload resumes, once", () => {
    const { pairing } = setup("restored-token-22-chars");
    pairing.join("aaaaaaaa");
    expect(pairing.resume("aaaaaaaa", "restored-token-22-chars")).toBe(true);
    expect(pairing.controls("aaaaaaaa")).toBe(true);
  });

  it("a second connection with the same token takes over and the first is told", () => {
    const { pairing, take } = setup();
    pairing.join("aaaaaaaa");
    pairing.allow("aaaaaaaa");
    const token = pairing.token!;
    pairing.join("bbbbbbbb");
    take();
    expect(pairing.resume("bbbbbbbb", token)).toBe(true);
    expect(take()).toEqual([
      { t: "revoke", to: "aaaaaaaa" },
      { t: "grant", to: "bbbbbbbb", token },
    ]);
    expect(pairing.controls("aaaaaaaa")).toBe(false);
  });

  it("denies a request nobody answered for two minutes", () => {
    const { pairing, take, tick } = setup();
    pairing.join("aaaaaaaa");
    tick(60_000);
    pairing.join("bbbbbbbb");
    take();
    tick(REQUEST_TTL - 60_000);
    pairing.expire();
    expect(take()).toEqual([{ t: "deny", to: "aaaaaaaa" }]);
    expect(pairing.requests.map(request => request.id)).toEqual(["bbbbbbbb"]);
  });

  it("forgets everyone when the relay connection ends, and keeps the token", () => {
    const { pairing } = setup();
    pairing.join("aaaaaaaa");
    pairing.allow("aaaaaaaa");
    pairing.join("bbbbbbbb");
    const token = pairing.token;
    pairing.offline();
    expect(pairing.controller).toBeNull();
    expect(pairing.requests).toEqual([]);
    expect(pairing.controls("aaaaaaaa")).toBe(false);
    expect(pairing.token).toBe(token);
  });

  it("reports every change", () => {
    const state = setup();
    state.pairing.join("aaaaaaaa");
    state.pairing.allow("aaaaaaaa");
    state.pairing.leave("aaaaaaaa");
    state.pairing.leave("aaaaaaaa");
    expect(state.changes).toBe(3);
  });
});
