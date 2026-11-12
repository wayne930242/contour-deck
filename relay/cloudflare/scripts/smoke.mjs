// Live check of a deployed (or local) relay against docs/PROTOCOL.md.
//   node scripts/smoke.mjs [relay URL] [--origin <allowed origin>] [--rate] [--per-address]
// --rate adds the rate-limit check: about 15 s and 1,500 messages.
// --per-address adds the check of the per-address limit: up to 70 plain GETs (no socket, no Durable Object request),
// after which this address is refused for up to a minute; it runs last.
// Exits 1 on the first failed check. It uses the `ws` client because Node's built-in WebSocket reports a close
// the server started only when the TCP connection ends, which Cloudflare does seconds after the close frame.

import WebSocket from "ws";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args.splice(at, 2)[1];
};
const has = (name) => {
  const at = args.indexOf(name);
  if (at !== -1) args.splice(at, 1);
  return at !== -1;
};
const withRate = has("--rate");
const withPerAddress = has("--per-address");
const origin = flag("--origin") ?? process.env.RELAY_ORIGIN ?? "https://wayne930242.github.io";
const base = (args[0] ?? process.env.RELAY_URL ?? "https://contour-relay.wayne930242.workers.dev").replace(/\/$/, "");
const wsBase = base.replace(/^http/, "ws");
const TIMEOUT_MS = 10_000;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(26)), (byte) => CROCKFORD[byte & 31]).join("");

/** The room a host key opens: the first 26 Crockford base32 characters of SHA-256 of the key. */
async function roomOfKey(key) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  let bits = "";
  for (const byte of hash) bits += byte.toString(2).padStart(8, "0");
  let room = "";
  for (let i = 0; i < 26; i++) room += CROCKFORD[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return room;
}

/** The host key of every room `newRoom` made. */
const keys = new Map();
async function newRoom() {
  const key = newKey();
  const room = await roomOfKey(key);
  keys.set(room, key);
  return room;
}

let checks = 0;
function ok(condition, label, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  checks++;
  console.log(`ok  ${label}`);
}

function timeout(label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), TIMEOUT_MS).unref());
}

/**
 * A socket with its frames queued; `status` is 101 once open, else the HTTP status that refused the handshake.
 * A host presents the key `newRoom` made for the room unless `key` says otherwise (`null`: none).
 */
function open(room, role, { from = origin, key = role === "host" ? (keys.get(room) ?? null) : null } = {}) {
  const query = key === null ? "" : `&key=${key}`;
  // `wrangler dev` never ends the connection after a close the relay started; give up waiting after 2 s.
  const ws = new WebSocket(`${wsBase}/v1/room/${room}?role=${role}${query}`, { origin: from, closeTimeout: 2_000 });
  const queue = [];
  let waiter = null;
  ws.on("message", (data) => {
    const frame = JSON.parse(data.toString());
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(frame);
    } else queue.push(frame);
  });
  const status = new Promise((resolve) => {
    ws.on("open", () => resolve(101));
    ws.on("unexpected-response", (request, response) => {
      resolve(response.statusCode);
      request.destroy();
    });
    ws.on("error", () => resolve(0));
  });
  const closed = new Promise((resolve) => ws.on("close", (code) => resolve(code)));
  return {
    status: (label) => Promise.race([status, timeout(label)]),
    closed: (label) => Promise.race([closed, timeout(label)]),
    /** The close code, however long it takes. */
    whenClosed: closed,
    next: (label) =>
      Promise.race([queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => (waiter = resolve)), timeout(label)]),
    send: (message) => ws.send(typeof message === "string" || message instanceof Uint8Array ? message : JSON.stringify(message)),
    close: () => ws.close(1000),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  console.log(`relay ${base}, origin ${origin}`);

  const health = await fetch(`${base}/v1/health`);
  ok(health.status === 200 && (await health.text()) === "ok", "GET /v1/health answers 200 ok");

  const room = await newRoom();
  const evil = open(room, "host", { from: "https://evil.example" });
  const evilStatus = await evil.status("handshake with a disallowed Origin");
  ok(evilStatus === 403, "a WebSocket handshake with a disallowed Origin gets HTTP 403", `status ${evilStatus}`);
  const noOrigin = await fetch(`${base}/v1/room/${room}?role=host`);
  ok(noOrigin.status === 403, "a request without an Origin gets HTTP 403", `status ${noOrigin.status}`);
  const badRoom = open("not-a-room", "host");
  const badRoomStatus = await badRoom.status("handshake with a malformed room id");
  ok(badRoomStatus === 400, "a malformed room id gets HTTP 400", `status ${badRoomStatus}`);
  const noKey = open(room, "host", { key: null });
  const noKeyStatus = await noKey.status("host handshake without a key");
  ok(noKeyStatus === 403, "a host without a key gets HTTP 403", `status ${noKeyStatus}`);
  const wrongKey = open(room, "host", { key: newKey() });
  const wrongKeyStatus = await wrongKey.status("host handshake with another key");
  ok(wrongKeyStatus === 403, "a host with a key that is not the room's gets HTTP 403", `status ${wrongKeyStatus}`);

  const host = open(room, "host");
  ok((await host.status("host handshake")) === 101, "the host connects with an allowed Origin");
  const hostHello = await host.next("host hello");
  ok(
    hostHello.t === "hello" && hostHello.role === "host" && /^[0-9A-HJKMNP-TV-Z]{8}$/.test(hostHello.id),
    "the host gets hello with role host and an 8-character id",
    JSON.stringify(hostHello),
  );

  const stray = open(await newRoom(), "guest");
  ok((await stray.closed("guest without host")) === 4004, "a guest in a room without a host is closed with 4004");

  const a = open(room, "guest");
  const aHello = await a.next("guest hello");
  ok(
    aHello.t === "hello" && aHello.role === "guest" && aHello.id !== hostHello.id,
    "a guest gets hello with role guest",
    JSON.stringify(aHello),
  );
  ok(same(await host.next("join"), { t: "join", id: aHello.id }), "the host gets join with the guest's id");
  const b = open(room, "guest");
  const bHello = await b.next("second guest hello");
  ok(same(await host.next("second join"), { t: "join", id: bHello.id }), "the host gets join for a second guest");

  host.send({ t: "pair", to: aHello.id, code: "0000" });
  ok(
    same(await a.next("pair"), { t: "pair", to: aHello.id, code: "0000" }),
    "a host message with `to` reaches that guest",
  );
  a.send({ t: "cmd", c: "next", from: bHello.id });
  ok(
    same(await host.next("cmd"), { t: "cmd", c: "next", from: aHello.id }),
    "a guest message reaches the host with `from` overwritten by the relay",
  );
  host.send({ t: "state", mode: "stage" });
  ok(
    same(await b.next("state at the other guest"), { t: "state", mode: "stage" }),
    "the other guest's next frame is the host's broadcast: it got neither the pair nor the guest's cmd",
  );
  ok(
    same(await a.next("state at the first guest"), { t: "state", mode: "stage" }),
    "a host message without `to` reaches every guest",
  );

  host.send({ t: "deny", to: aHello.id });
  ok(same(await a.next("deny"), { t: "deny", to: aHello.id }), "the host's deny reaches the guest");
  ok((await a.closed("guest removed")) === 4003, "the relay then closes that guest with 4003");
  ok(same(await host.next("leave"), { t: "leave", id: aHello.id }), "the host gets leave for the guest it denied");

  const second = open(room, "host");
  const secondHello = await second.next("second host hello");
  ok(secondHello.t === "hello" && secondHello.role === "host", "a second host with the room's key takes the seat");
  ok((await host.closed("replaced host")) === 4009, "the host it replaced is closed with 4009");
  ok((await b.closed("guest of the replaced host")) === 4000, "the guests of the replaced host are closed with 4000");
  const c = open(room, "guest");
  const cHello = await c.next("guest of the new host");
  ok(same(await second.next("join at the new host"), { t: "join", id: cHello.id }), "a guest joins the new host");
  second.close();
  ok((await c.closed("room closed")) === 4000, "the guest is closed with 4000 when the host closes");

  await limits();
  if (withRate) await rate();
  if (withPerAddress) await perAddress();
  console.log(`${checks} checks passed`);
}

/** A room with a host and `count` guests, every hello and join already read. */
async function openRoom(count) {
  const room = await newRoom();
  const host = open(room, "host");
  await host.next("hello");
  const guests = [];
  for (let i = 0; i < count; i++) {
    const guest = open(room, "guest");
    guests.push({ ...guest, id: (await guest.next("hello")).id });
    await host.next("join");
  }
  return { room, host, guests };
}

async function limits() {
  const { room, host, guests } = await openRoom(4);
  const fifth = open(room, "guest");
  ok((await fifth.closed("fifth guest")) === 4029, "a fifth guest is closed with 4029");

  guests[0].send(JSON.stringify({ t: "ink", pad: "x".repeat(2048 - 20) }));
  ok((await host.next("2048 bytes")).t === "ink", "a frame of exactly 2048 bytes is forwarded");
  guests[0].send(JSON.stringify({ t: "ink", pad: "x".repeat(2049 - 20) }));
  ok((await guests[0].closed("2049 bytes")) === 1009, "a frame of 2049 bytes closes the socket with 1009");
  ok(same(await host.next("leave"), { t: "leave", id: guests[0].id }), "the host gets leave for the socket the relay closed");
  guests[1].send(new TextEncoder().encode('{"t":"cmd"}'));
  ok((await guests[1].closed("binary frame")) === 1009, "a binary frame closes the socket with 1009");
  await host.next("leave");

  host.send({ t: "grant", to: "ZZZZZZZZ", token: "nobody" });
  host.send({ t: "mark" });
  ok(same(await guests[2].next("mark"), { t: "mark" }), "a host message to an unknown `to` reaches nobody");
  host.close();
  await guests[3].closed("room closed");
}

/** 100 messages/s from one guest: the relay drops the excess and closes the guest after 10 s of it. */
async function rate() {
  const { host, guests } = await openRoom(1);
  const guest = guests[0];
  let sent = 0;
  let got = 0;
  let open = true;
  const started = Date.now();
  const counting = (async () => {
    for (;;) {
      const frame = await host.next("frames at the host");
      if (frame.t === "leave") return;
      got++;
    }
  })();
  const closed = guest.whenClosed.then((code) => {
    open = false;
    return code;
  });
  const timer = setInterval(() => {
    for (let i = 0; i < 10 && open; i++, sent++) guest.send({ t: "ptr", x: 0.5, y: 0.5, on: true });
    if (Date.now() - started > 25_000) clearInterval(timer);
  }, 100);
  const code = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(0), 26_000))]);
  clearInterval(timer);
  const seconds = (Date.now() - started) / 1000;
  ok(code === 1008, "a guest at 100 messages/s is closed with 1008", `code ${code} after ${seconds.toFixed(1)} s`);
  await counting;
  console.log(`    sent ${sent} in ${seconds.toFixed(1)} s, the host got ${got}`);
  ok(seconds > 12 && seconds < 16, "the close came 10 s after the burst of 120 ran out (about 13 s in)", `${seconds.toFixed(1)} s`);
  ok(got < sent && got <= 120 + 60 * seconds + 10, "the host got no more than the burst plus 60 per second", `${got} of ${sent}`);
  host.close();
}

/** Plain GETs to a room path count toward the per-address limit (60 a minute) without opening anything. */
async function perAddress() {
  const room = await newRoom();
  const statuses = [];
  for (let i = 0; i < 70; i++) {
    const response = await fetch(`${base}/v1/room/${room}?role=guest`, { headers: { Origin: origin } });
    await response.text();
    statuses.push(response.status);
    if (response.status === 429) break;
  }
  console.log(`    ${statuses.length} requests: ${statuses.filter((s) => s === 426).length} × 426, then ${statuses.at(-1)}`);
  ok(statuses.at(-1) === 429, "requests from one address past the limit get HTTP 429", statuses.join(","));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`FAILED  ${error.message}`);
    process.exit(1);
  },
);
