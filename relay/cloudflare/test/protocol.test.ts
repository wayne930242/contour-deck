import { describe, expect, it } from "vitest";
import { canonicalRoom, frameTooLarge, isSocketId, newSocketId, originAllowed, parseMessage } from "../src/protocol";
import { RATE, newBucket, take } from "../src/rate";

describe("canonicalRoom", () => {
  it("takes 26 Crockford base32 characters in either case", () => {
    expect(canonicalRoom("0123456789ABCDEFGHJKMNPQRS")).toBe("0123456789ABCDEFGHJKMNPQRS");
    expect(canonicalRoom("tvwxyz0123456789abcdefghjk")).toBe("TVWXYZ0123456789ABCDEFGHJK");
  });

  it.each([
    ["25 characters", "0123456789ABCDEFGHJKMNPQR"],
    ["27 characters", "0123456789ABCDEFGHJKMNPQRST"],
    ["the letter I", "I123456789ABCDEFGHJKMNPQRS"],
    ["the letter L", "L123456789ABCDEFGHJKMNPQRS"],
    ["the letter O", "O123456789ABCDEFGHJKMNPQRS"],
    ["the letter U", "U123456789ABCDEFGHJKMNPQRS"],
    ["a hyphen", "01234-6789ABCDEFGHJKMNPQRS"],
    ["a trailing newline", "0123456789ABCDEFGHJKMNPQRS\n"],
    ["a dotless i that upper-cases to I", "ı0123456789ABCDEFGHJKMNPQ"],
  ])("rejects %s", (_name, raw) => {
    expect(canonicalRoom(raw)).toBeNull();
  });
});

describe("socket ids", () => {
  it("are 8 Crockford base32 characters", () => {
    for (let i = 0; i < 200; i++) expect(newSocketId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(isSocketId(newSocketId())).toBe(true);
    expect(isSocketId("host")).toBe(false);
    expect(isSocketId(12345678)).toBe(false);
  });
});

describe("originAllowed", () => {
  const list = "https://www.wayneh.tw, https://wayne930242.github.io,http://localhost:4321";

  it("matches a listed origin exactly", () => {
    expect(originAllowed("https://www.wayneh.tw", list)).toBe(true);
    expect(originAllowed("https://wayne930242.github.io", list)).toBe(true);
    expect(originAllowed("http://localhost:4321", list)).toBe(true);
  });

  it.each([
    ["no Origin header", null],
    ["an empty Origin", ""],
    ["the opaque origin", "null"],
    ["another host", "https://evil.example"],
    ["a suffix lookalike", "https://www.wayneh.tw.evil.example"],
    ["a prefix lookalike", "https://www.wayneh.tw:8443"],
    ["another scheme", "http://www.wayneh.tw"],
    ["another port", "http://localhost:4322"],
    ["two origins in one header", "https://www.wayneh.tw,https://evil.example"],
  ])("refuses %s", (_name, origin) => {
    expect(originAllowed(origin, list)).toBe(false);
  });

  it("refuses everything when the variable is missing or empty", () => {
    expect(originAllowed("https://www.wayneh.tw", undefined)).toBe(false);
    expect(originAllowed("https://www.wayneh.tw", "")).toBe(false);
    expect(originAllowed("", ",")).toBe(false);
  });

  it("lets an entry ending in :* match any port of that host, and nothing else", () => {
    const dev = "http://localhost:*";
    expect(originAllowed("http://localhost:4321", dev)).toBe(true);
    expect(originAllowed("http://localhost:65535", dev)).toBe(true);
    expect(originAllowed("http://localhost", dev)).toBe(false);
    expect(originAllowed("http://localhost:", dev)).toBe(false);
    expect(originAllowed("http://localhost:4321.evil.example", dev)).toBe(false);
    expect(originAllowed("http://localhost:4321@evil.example", dev)).toBe(false);
    expect(originAllowed("http://localhost.evil.example:4321", dev)).toBe(false);
    expect(originAllowed("https://localhost:4321", dev)).toBe(false);
  });
});

describe("frameTooLarge", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(frameTooLarge("a".repeat(2048))).toBe(false);
    expect(frameTooLarge("a".repeat(2049))).toBe(true);
    // U+6D2A is three bytes in UTF-8: 682 of them are 2046 bytes, 683 are 2049.
    expect(frameTooLarge("洪".repeat(682))).toBe(false);
    expect(frameTooLarge("洪".repeat(682) + "ab")).toBe(false);
    expect(frameTooLarge("洪".repeat(683))).toBe(true);
    // An emoji is two UTF-16 code units and four bytes: 512 of them are exactly 2048 bytes.
    expect(frameTooLarge("😀".repeat(512))).toBe(false);
    expect(frameTooLarge("😀".repeat(512) + "a")).toBe(true);
  });
});

describe("parseMessage", () => {
  it("takes a JSON object with a string t", () => {
    expect(parseMessage('{"t":"cmd","c":"next"}')).toEqual({ t: "cmd", c: "next" });
  });

  it.each([["not JSON"], ['"text"'], ["42"], ["null"], ["[]"], ['[{"t":"cmd"}]'], ["{}"], ['{"t":1}'], ['{"t":null}']])(
    "refuses %s",
    (text) => {
      expect(parseMessage(text)).toBeNull();
    },
  );
});

describe("take", () => {
  const T0 = 1_000_000;

  it("passes a burst of 120, then drops", () => {
    const bucket = newBucket(T0);
    for (let i = 0; i < RATE.burst; i++) expect(take(bucket, T0)).toBe("pass");
    expect(take(bucket, T0)).toBe("drop");
    expect(take(bucket, T0)).toBe("drop");
  });

  it("refills 60 messages per second, up to the burst", () => {
    const bucket = newBucket(T0);
    for (let i = 0; i < RATE.burst; i++) take(bucket, T0);
    for (let i = 0; i < 30; i++) expect(take(bucket, T0 + 500)).toBe("pass");
    expect(take(bucket, T0 + 500)).toBe("drop");

    for (let i = 0; i < RATE.burst; i++) expect(take(bucket, T0 + 3_600_000)).toBe("pass");
    expect(take(bucket, T0 + 3_600_000)).toBe("drop");
  });

  it("never drops a steady 60 messages per second", () => {
    const bucket = newBucket(T0);
    for (let i = 1; i <= 60 * 60; i++) expect(take(bucket, T0 + Math.ceil((i * 1000) / 60))).toBe("pass");
  });

  it("closes once drops have gone on for 10 s without the bucket refilling", () => {
    const bucket = newBucket(T0);
    // 100 messages per second: one every 10 ms.
    let firstDrop: number | null = null;
    let closedAt: number | null = null;
    for (let now = T0; now < T0 + 30_000 && closedAt === null; now += 10) {
      const verdict = take(bucket, now);
      if (verdict === "drop") firstDrop ??= now;
      if (verdict === "close") closedAt = now;
    }
    // Before its k-th message the bucket holds 120 - 0.4k tokens: less than one from k = 298 on.
    expect(firstDrop).toBe(T0 + 2_980);
    // The first message dropped 10 s or more after that; three in five still pass, so within 20 ms.
    expect(closedAt).toBeGreaterThanOrEqual(T0 + 12_980);
    expect(closedAt).toBeLessThanOrEqual(T0 + 13_000);
  });

  it("drops, not closes, one millisecond short of 10 s", () => {
    const bucket = newBucket(T0);
    for (let i = 0; i <= RATE.burst; i++) take(bucket, T0);
    for (let step = 1; step <= 6; step++) for (let i = 0; i < 90; i++) expect(take(bucket, T0 + step * 1500)).toBe("pass");
    for (let i = 0; i < 59; i++) expect(take(bucket, T0 + 9_999)).toBe("pass");
    expect(take(bucket, T0 + 9_999)).toBe("drop");
    expect(take(bucket, T0 + 10_000)).toBe("close");
  });

  it("starts the 10 s over after a pause long enough to refill the bucket", () => {
    const bucket = newBucket(T0);
    for (let i = 0; i <= RATE.burst; i++) take(bucket, T0);
    // Still short of a full bucket after 1.9 s: the same run of drops goes on.
    for (let i = 0; i < 114; i++) expect(take(bucket, T0 + 1_900)).toBe("pass");
    expect(take(bucket, T0 + 1_900)).toBe("drop");
    expect(bucket.excessSince).toBe(T0);

    // A 2 s pause refills it: drops 12 s after the first one belong to a new run.
    const later = T0 + 12_000;
    for (let i = 0; i < RATE.burst; i++) expect(take(bucket, later)).toBe("pass");
    expect(take(bucket, later)).toBe("drop");
    expect(bucket.excessSince).toBe(later);
  });

  it("does not refill when the clock steps back", () => {
    const bucket = newBucket(T0);
    for (let i = 0; i < RATE.burst; i++) take(bucket, T0);
    expect(take(bucket, T0 - 60_000)).toBe("drop");
    expect(take(bucket, T0)).toBe("drop");
  });
});
