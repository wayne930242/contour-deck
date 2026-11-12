/** Frames from outside: what the host accepts from a guest, and what a guest accepts as state. */
import { describe, expect, it } from "vitest";
import { decode, guestMessage, isRoom, MAX_FRAME, newCode, newRoom, newToken, stateMessage } from "../../../src/remote/protocol.js";

const parse = (value: object) => guestMessage(decode(JSON.stringify(value))!);

describe("decode", () => {
  it("takes JSON objects with a string t and nothing else", () => {
    expect(decode('{"t":"ping"}')).toEqual({ t: "ping" });
    expect(decode("not json")).toBeNull();
    expect(decode('"ping"')).toBeNull();
    expect(decode("[1,2]")).toBeNull();
    expect(decode('{"t":7}')).toBeNull();
    expect(decode(new ArrayBuffer(4))).toBeNull();
    expect(decode(`{"t":"ping","x":"${"a".repeat(MAX_FRAME)}"}`)).toBeNull();
  });
});

describe("guestMessage", () => {
  it("accepts the commands of the protocol and drops unknown ones", () => {
    for (const c of ["next", "prev", "slideNext", "slidePrev", "pageNext", "pagePrev", "overview"]) {
      expect(parse({ t: "cmd", c, from: "aaaaaaaa", extra: 1 })).toEqual({ t: "cmd", c });
    }
    expect(parse({ t: "cmd", c: "open", at: "3.2" })).toEqual({ t: "cmd", c: "open", at: "3.2" });
    expect(parse({ t: "cmd", c: "open" })).toBeNull();
    expect(parse({ t: "cmd", c: "open", at: 3 })).toBeNull();
    expect(parse({ t: "cmd", c: "open", at: "x".repeat(65) })).toBeNull();
    expect(parse({ t: "cmd", c: "destroy" })).toBeNull();
    expect(parse({ t: "cmd", c: "__proto__" })).toBeNull();
    expect(parse({ t: "grant", token: "x" })).toBeNull();
    expect(parse({ t: "state", at: "1.1.1" })).toBeNull();
  });

  it("clamps pointer coordinates and refuses what is not a number", () => {
    expect(parse({ t: "ptr", x: 0.25, y: 0.75, on: true })).toEqual({ t: "ptr", x: 0.25, y: 0.75, on: true });
    expect(parse({ t: "ptr", x: -4, y: 1e9, on: false })).toEqual({ t: "ptr", x: 0, y: 1, on: false });
    expect(parse({ t: "ptr", x: "0.5", y: 0.5, on: true })).toBeNull();
    expect(parse({ t: "ptr", x: null, y: 0.5, on: true })).toBeNull();
    expect(parse({ t: "ptr", x: 0.5, y: 0.5, on: 1 })).toBeNull();
    expect(guestMessage({ t: "ptr", x: Number.NaN, y: 0.5, on: true })).toBeNull();
  });

  it("takes ink of 1 to 64 points as pairs and clamps them", () => {
    expect(parse({ t: "ink", s: 3, pts: [0.1, 0.2, 1.5, -1], end: true })).toEqual({ t: "ink", s: 3, pts: [0.1, 0.2, 1, 0], end: true });
    expect(parse({ t: "ink", s: 3, pts: [0.1, 0.2] })).toEqual({ t: "ink", s: 3, pts: [0.1, 0.2] });
    expect(parse({ t: "ink", s: 3, pts: new Array(128).fill(0.5) })).not.toBeNull();
    expect(parse({ t: "ink", s: 3, pts: new Array(130).fill(0.5) })).toBeNull();
    expect(parse({ t: "ink", s: 3, pts: [0.1, 0.2, 0.3] })).toBeNull();
    expect(parse({ t: "ink", s: 3, pts: [] })).toBeNull();
    expect(parse({ t: "ink", s: 3, pts: [0.1, "0.2"] })).toBeNull();
    expect(parse({ t: "ink", s: "3", pts: [0.1, 0.2] })).toBeNull();
    expect(parse({ t: "ink", s: 3, pts: { length: 2 } })).toBeNull();
  });

  it("takes resume, ink-clear and ping", () => {
    expect(parse({ t: "resume", token: "abc" })).toEqual({ t: "resume", token: "abc" });
    expect(parse({ t: "resume", token: "" })).toBeNull();
    expect(parse({ t: "resume", token: "x".repeat(65) })).toBeNull();
    expect(parse({ t: "resume" })).toBeNull();
    expect(parse({ t: "ink-clear" })).toEqual({ t: "ink-clear" });
    expect(parse({ t: "ping" })).toEqual({ t: "ping" });
  });
});

describe("stateMessage", () => {
  it("reads the fields of the protocol and neutralises wrong types", () => {
    const state = { t: "state", mode: "stage", at: "3.4.2", step: 1, steps: 4, elapsed: 72.5, total: 720, block: "三", blockElapsed: 12, blockMinutes: 5 };
    expect(stateMessage(state)).toEqual(state);
    expect(stateMessage({ ...state, ratio: 1.6 })).toEqual({ ...state, ratio: 1.6 });
    expect(stateMessage({ t: "state", at: "1.1.1", mode: "notes", step: "x", total: "12", ratio: -1 })).toEqual({
      t: "state",
      mode: "stage",
      at: "1.1.1",
      step: 0,
      steps: 0,
      elapsed: 0,
      total: null,
      block: "",
      blockElapsed: 0,
      blockMinutes: null,
    });
    expect(stateMessage({ t: "state" })).toBeNull();
    expect(stateMessage({ t: "pong", at: "1.1.1" })).toBeNull();
  });
});

describe("random names", () => {
  it("makes rooms of 26 Crockford characters that hold 128 bits", () => {
    const rooms = Array.from({ length: 200 }, newRoom);
    for (const room of rooms) {
      expect(isRoom(room)).toBe(true);
      expect("01234567").toContain(room[0]);
    }
    expect(new Set(rooms).size).toBe(200);
    // Every other position uses the whole alphabet.
    expect(new Set(rooms.map(room => room[13])).size).toBeGreaterThan(20);
    expect(isRoom("7ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(true);
    expect(isRoom("7ZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(false);
    expect(isRoom("IZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(false);
    expect(isRoom("7zzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
    expect(isRoom(null)).toBe(false);
  });

  it("makes 22-character tokens and 4-digit codes", () => {
    const tokens = Array.from({ length: 100 }, newToken);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(new Set(tokens).size).toBe(100);
    const codes = Array.from({ length: 300 }, newCode);
    for (const code of codes) expect(code).toMatch(/^\d{4}$/);
    expect(new Set(codes).size).toBeGreaterThan(250);
  });
});
