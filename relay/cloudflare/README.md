# contour-relay

The relay of [docs/PROTOCOL.md](../../docs/PROTOCOL.md): a Cloudflare Worker and one Durable Object per room.
It forwards frames between a deck (the host) and up to four phones (the guests), and stores and logs none of them.

Deployed at:

```text
https://contour-relay.wayne930242.workers.dev
wss://contour-relay.wayne930242.workers.dev/v1/room/<room>?role=host&key=<key>
wss://contour-relay.wayne930242.workers.dev/v1/room/<room>?role=guest
```

This directory is its own project with its own lockfile.
It is not part of the `contour-deck` npm package.

## Commands

Run them in `relay/cloudflare`.

```sh
pnpm install
pnpm test        # the protocol rules, in workerd (@cloudflare/vitest-plugin)
pnpm typecheck   # wrangler types, then tsc
pnpm dev         # http://localhost:8787, any localhost origin allowed
pnpm smoke       # live check of the deployed relay; pnpm smoke http://localhost:8787 --origin http://localhost:4321 for pnpm dev
pnpm run deploy  # wrangler deploy, to the account wrangler is logged in to
```

`pnpm smoke --rate` adds the rate-limit check, which sends about 1,500 messages in 15 seconds.
`pnpm smoke --per-address` adds the check of the per-address limit: up to 70 plain GETs (no socket, no Durable Object request), after which this address gets 429 for up to a minute.

## Configuration

`ALLOWED_ORIGINS` in `wrangler.jsonc` is the comma-separated list of origins that may open a socket.
A request whose `Origin` is missing or not in the list gets HTTP 403 before the upgrade.
An entry that ends in `:*` allows any port of that host.
Production has no such entry; `pnpm dev` replaces the list with `http://localhost:*,http://127.0.0.1:*`.

The `Origin` check stops other web pages from using the relay.
It does not stop a script, which can send any `Origin`; the host key, the room id, and the pairing code are what protect a deck.

`UPGRADES` and `HOSTS` are [Workers Rate Limiting][rate-limit] bindings, counted per `CF-Connecting-IP`.
A host request that presents the room's key counts on `HOSTS`, 30 a minute (namespace `930243`); every other request to a room path counts on `UPGRADES`, 60 a minute (namespace `930242`).
Bindings with the same namespace on the account share counters.
So guests behind one address cannot spend the budget of the deck's own reconnects, and a host is still limited, since anyone can make a key for a room of their own.
`UPGRADES_PER_MINUTE` and `HOSTS_PER_MINUTE` in `src/protocol.ts` repeat the numbers for the tests.
The tests give every request a fresh address from 198.51.0.0/16, so one test file does not spend another's allowance.

Workers Logs are off (`observability.enabled: false`), because request URLs carry the room id.
The code has no `console` call.

## How the rules map to Cloudflare

| Rule | Here |
| --- | --- |
| one object per room | `env.ROOM.idFromName(room)`, after the room id passed its pattern; the class is SQLite-backed (`new_sqlite_classes`), which the free plan requires |
| the host key | the Worker hashes `key` with `crypto.subtle` and compares it with the room before the object is reached, so a refused host costs no Durable Object request |
| a host replaces a host | the object closes the old host (`4009`) and every guest (`4000`) and seats the new one; the alarm is set again for the new host |
| `deny` and `revoke` remove the guest | the object forwards the frame, then closes the guest named by `to` with `4003` and tells the host `leave` |
| requests per address | `env.HOSTS.limit` for a host with the room's key, else `env.UPGRADES.limit`, keyed on `CF-Connecting-IP`, in the Worker before any other check that can refuse the request (the key's hash is computed first, to pick the budget) |
| sockets | WebSocket Hibernation API (`ctx.acceptWebSocket`): the object leaves memory between messages and the sockets stay connected |
| role, id, rate state | each socket's attachment (`serializeAttachment`), read back on every event; the host and guests are found by tag |
| 2 hours idle | an alarm set when the host opens; when it fires it reads the last-message time of every socket and either closes the room or re-arms for the remaining time, so messages cost no storage writes |
| rate limit | a token bucket per socket: 120 tokens, 60 more per second |

`src/index.ts` is the Worker (routing, `Origin`, room id, role), `src/room.ts` the Durable Object, `src/rate.ts` the bucket, `src/protocol.ts` the constants and validators.

## Where the protocol left a choice

- A socket the relay refuses (`4004`, `4029`) is upgraded and closed at once, without a `hello`.
- The Worker checks a request to a room path in this order: per-address limit (429; `HOSTS` for a host with the room's key, `UPGRADES` for the rest), `Origin` (403), room id (400), role (400), `Upgrade` header (426), host key (403 `bad host key`).
  So every request to a room path counts toward the limit, refused or not, and a plain GET with `role=host` and no key gets 426, not 403.
- A key is read in either case, like a room id, and hashed in upper case.
- A host that replaces another does not hear about the old guests: they are closed with `4000` and come back as new guests, which present their tokens again, as after a reload of the deck.
- Only a `deny` or `revoke` whose `to` names a guest removes it; one without `to` reaches every guest and removes nobody.
- A room id may be upper or lower case; both reach the same room.
- `GET /v1/health` needs no `Origin`.
  Other paths answer 404, a room path without an upgrade 426.
- A text frame that is not a JSON object with a string `t` is dropped; the socket stays open.
- A host frame whose `to` is not the id of a guest in the room is dropped, whatever its type.
- A host frame is forwarded byte for byte, `to` included.
  A guest frame is parsed and written again with `from` set, which adds 18 bytes, so it can reach the host longer than 2048 bytes.
- "No message for 2 hours" counts every text frame within the size limit, from the host or a guest, forwarded or dropped.
  A join or a leave is not a message.
  The two hours start when the host opens.
- "Sustained excess" is a run of dropped frames during which the bucket never refilled completely (a 2 second pause refills it).
  The socket is closed by the first frame dropped 10 seconds or more after the run began.
- "Host closes" includes the relay closing the host (`1008`, `1009`) and a host connection that drops: every guest gets `4000`.
- A frame over 2048 bytes is received in full before the relay can close the socket; Cloudflare itself accepts up to 32 MiB.

## What a client should know

- A frame from a guest always carries `from`; `hello`, `join`, and `leave` from the relay never do.
  A host that trusts `join` and `leave` only without `from` cannot be fooled by a guest that sends them.
- After a close the relay started, the close frame arrives at once, but the connection stays open until the room hibernates, about 10 seconds after its last event.
  Firefox and WebKit fire `close` with the code immediately, Chromium 2 seconds later.
  Node's built-in `WebSocket` fires it only when the connection ends; `scripts/smoke.mjs` uses `ws` for that reason.
- A host that reconnects while Cloudflare still counts its dropped connection as open takes the seat from it; the dropped connection gets `4009`, which it never reads.
  A live tab that gets `4009` lost the seat to another tab with the same key, and should not reconnect by itself, or the two tabs take the seat from each other in turn.

## Free plan

From the Cloudflare documentation ([Workers limits][workers-limits], [Durable Objects pricing][do-pricing]), read on 2026-11-12:

- Worker: 100,000 requests per day; every socket opened and every health check is one.
- Durable Object: 100,000 requests per day, made of socket opens, incoming messages, and alarms.
  Outgoing messages are free.
  For billing, 20 incoming messages count as one request; the documentation does not say whether the free daily limit counts them the same way.
- Durable Object duration: 13,000 GB-s per day, about 28 hours of one object awake.
  A hibernating room uses none.
- Storage: 100,000 rows written per day; a room writes one row when its host opens, one when it closes, and one for every 2 idle hours.
- Past a limit, requests of that kind fail until 00:00 UTC.
  Nothing is billed.
- Rate Limiting bindings: neither the [binding's page][rate-limit] nor the pricing and limits pages say which plans have them.
  This account is on the free plan; `wrangler deploy` accepted the binding on 2026-11-12 (version `fc1a2dc3-9ee4-4ba2-b2e4-a0eab5d55b53`), and `pnpm smoke --per-address` got 429 after about 60 requests from one address.
  It accepted the second binding, `HOSTS`, the same day (version `c597204b-f0a0-4704-99a8-26bbca06ff2c`).

What is still exposed on the free plan:

- The per-address limit is approximate and counted in each Cloudflare location, and it only slows one address.
  Many addresses can still spend the 100,000 daily requests, and with them the remote of every deck, until 00:00 UTC.
  The decks, their notes, and the notes link keep working.
- A guest connected to a room may send 60 messages a second, and each counts toward the Durable Object's daily requests.
  It needs the room id, which the projected QR shows; the presenter can deny it, which now closes it, but it can join again.
- Guests behind one address (a venue network) share its 60 requests a minute, the presenter's phone included.
  The client keeps that cost low: a guest refused with `4029` (room full) does not retry by itself, and one refused with `4004` (no host) waits up to a minute between tries.
  Still, more than about 60 phones opening within a minute, or one person sending requests on purpose, makes the presenter's phone wait until that minute is over; a phone on its mobile network is not affected.
  The deck's own connection counts on `HOSTS` and is not affected either.

[workers-limits]: https://developers.cloudflare.com/workers/platform/limits/
[do-pricing]: https://developers.cloudflare.com/durable-objects/platform/pricing/
[rate-limit]: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
