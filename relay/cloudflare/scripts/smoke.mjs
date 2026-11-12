// Live check of a deployed (or local) relay against docs/PROTOCOL.md.
//   node scripts/smoke.mjs [https://relay.example] [--origin https://allowed.example]
// Needs Node 22.12 or later (global WebSocket with the `headers` option); exits 1 on the first failed check.

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args.splice(at, 2)[1];
};
const origin = flag("--origin") ?? process.env.RELAY_ORIGIN ?? "https://wayne930242.github.io";
const base = (args[0] ?? process.env.RELAY_URL ?? "").replace(/\/$/, "");
if (!base) {
  console.error("usage: node scripts/smoke.mjs <relay URL> [--origin <allowed origin>]");
  process.exit(2);
}
const wsBase = base.replace(/^http/, "ws");
const TIMEOUT_MS = 10_000;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newRoom = () => Array.from(crypto.getRandomValues(new Uint8Array(26)), (byte) => CROCKFORD[byte & 31]).join("");

let checks = 0;
function ok(condition, label, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  checks++;
  console.log(`ok  ${label}`);
}

function timeout(label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), TIMEOUT_MS).unref());
}

/** A socket with its frames queued; `opened` settles false when the handshake is refused. */
function open(room, role, from = origin) {
  const ws = new WebSocket(`${wsBase}/v1/room/${room}?role=${role}`, { headers: { Origin: from } });
  const queue = [];
  let waiter = null;
  ws.addEventListener("message", (event) => {
    const frame = JSON.parse(event.data);
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(frame);
    } else queue.push(frame);
  });
  const opened = new Promise((resolve) => {
    ws.addEventListener("open", () => resolve(true));
    ws.addEventListener("error", () => resolve(false));
  });
  const closed = new Promise((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
  return {
    opened: (label) => Promise.race([opened, timeout(label)]),
    closed: (label) => Promise.race([closed, timeout(label)]),
    next: (label) =>
      Promise.race([queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => (waiter = resolve)), timeout(label)]),
    send: (message) => ws.send(JSON.stringify(message)),
    close: () => ws.close(1000),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  console.log(`relay ${base}, origin ${origin}`);

  const health = await fetch(`${base}/v1/health`);
  ok(health.status === 200 && (await health.text()) === "ok", "GET /v1/health answers 200 ok");

  const room = newRoom();
  const refused = await fetch(`${base}/v1/room/${room}?role=host`, { headers: { Origin: "https://evil.example" } });
  ok(refused.status === 403, "a disallowed Origin gets HTTP 403", `status ${refused.status}`);
  const noOrigin = await fetch(`${base}/v1/room/${room}?role=host`);
  ok(noOrigin.status === 403, "no Origin gets HTTP 403", `status ${noOrigin.status}`);
  const evil = open(room, "host", "https://evil.example");
  ok(
    (await evil.opened("handshake with a disallowed Origin")) === false,
    "a WebSocket handshake with a disallowed Origin is refused",
  );
  const badRoom = await fetch(`${base}/v1/room/not-a-room?role=host`, { headers: { Origin: origin } });
  ok(badRoom.status === 400, "a malformed room id gets HTTP 400", `status ${badRoom.status}`);

  const host = open(room, "host");
  ok(await host.opened("host handshake"), "the host connects with an allowed Origin");
  const hostHello = await host.next("host hello");
  ok(
    hostHello.t === "hello" && hostHello.role === "host" && /^[0-9A-HJKMNP-TV-Z]{8}$/.test(hostHello.id),
    "the host gets hello with role host and an 8-character id",
    JSON.stringify(hostHello),
  );

  const second = open(room, "host");
  ok((await second.closed("second host")) === 4009, "a second host is closed with 4009");
  const stray = open(newRoom(), "guest");
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

  a.close();
  ok(same(await host.next("leave"), { t: "leave", id: aHello.id }), "the host gets leave when a guest closes");
  host.close();
  ok((await b.closed("room closed")) === 4000, "the remaining guest is closed with 4000 when the host closes");

  console.log(`${checks} checks passed`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`FAILED  ${error.message}`);
    process.exit(1);
  },
);
