# contour-relay

The relay of [docs/PROTOCOL.md](../../docs/PROTOCOL.md): a Cloudflare Worker and one Durable Object per room.
It forwards frames between a deck (the host) and up to four phones (the guests), and stores and logs none of them.

Deployed at:

```text
https://contour-relay.wayne930242.workers.dev
wss://contour-relay.wayne930242.workers.dev/v1/room/<room>?role=host|guest
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

## Configuration

`ALLOWED_ORIGINS` in `wrangler.jsonc` is the comma-separated list of origins that may open a socket.
A request whose `Origin` is missing or not in the list gets HTTP 403 before the upgrade.
An entry that ends in `:*` allows any port of that host.
Production has no such entry; `pnpm dev` replaces the list with `http://localhost:*,http://127.0.0.1:*`.

The `Origin` check stops other web pages from using the relay.
It does not stop a script, which can send any `Origin`; the room id and the pairing code are what protect a deck.

Workers Logs are off (`observability.enabled: false`), because request URLs carry the room id.
The code has no `console` call.

## How the rules map to Cloudflare

| Rule | Here |
| --- | --- |
| one object per room | `env.ROOM.idFromName(room)`, after the room id passed its pattern; the class is SQLite-backed (`new_sqlite_classes`), which the free plan requires |
| sockets | WebSocket Hibernation API (`ctx.acceptWebSocket`): the object leaves memory between messages and the sockets stay connected |
| role, id, rate state | each socket's attachment (`serializeAttachment`), read back on every event; the host and guests are found by tag |
| 2 hours idle | an alarm set when the host opens; when it fires it reads the last-message time of every socket and either closes the room or re-arms for the remaining time, so messages cost no storage writes |
| rate limit | a token bucket per socket: 120 tokens, 60 more per second |

`src/index.ts` is the Worker (routing, `Origin`, room id, role), `src/room.ts` the Durable Object, `src/rate.ts` the bucket, `src/protocol.ts` the constants and validators.

## Where the protocol left a choice

- A socket the relay refuses (`4009`, `4004`, `4029`) is upgraded and closed at once, without a `hello`.
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
- While Cloudflare still counts a dropped host connection as open, a host that reconnects to the same room gets `4009`.

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

[workers-limits]: https://developers.cloudflare.com/workers/platform/limits/
[do-pricing]: https://developers.cloudflare.com/durable-objects/platform/pricing/
