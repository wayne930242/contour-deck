# Remote protocol

How a deck (the **host**) and phones (**guests**) talk through the relay. The relay is a dumb, per-room forwarder; every decision about who may control the deck is made by the host. Version 1.

## Transport

```
wss://<relay>/v1/room/<room>?role=host|guest
```

- `room`: 26 characters of Crockford base32 (128 random bits), made by the host with `crypto.getRandomValues`. Anything else gets HTTP 400.
- Frames are UTF-8 JSON text, at most **2048 bytes**. A larger or binary frame closes the socket with `1009`.
- Every message has a string field `t` (its type). The relay reads only `t`, `to`, and the size; it never stores or logs message bodies.

## Relay rules

One Durable Object per room (`idFromName(room)`).

| Event | Relay does |
| --- | --- |
| socket opens | sends `{ "t": "hello", "id": "<8 chars>", "role": "host" \| "guest" }` to it. `id` is assigned by the relay. |
| host opens while a host is connected | closes the new socket with `4009` |
| guest opens with no host connected | closes it with `4004` |
| guest opens when 4 guests are connected | closes it with `4029` |
| guest opens / closes | sends `{ "t": "join", "id" }` / `{ "t": "leave", "id" }` to the host |
| host sends a message with `to` | forwards it to that guest only (unknown `to` is dropped) |
| host sends a message without `to` | forwards it to every guest |
| guest sends a message | forwards it to the host only, with `from` set to the guest's id (overwriting any `from` the guest sent) |
| host closes | closes every guest with `4000`; the room is gone |
| no message in the room for 2 hours | closes everyone with `4000` |
| a socket exceeds 60 messages/s (burst 120) | extra messages are dropped; above 10 s of sustained excess, closes with `1008` |
| request `Origin` not in `ALLOWED_ORIGINS` | HTTP 403 before the upgrade |

`ALLOWED_ORIGINS` is a comma-separated Worker variable (e.g. `https://www.wayneh.tw,https://wayne930242.github.io,http://localhost:4321`). Guests never reach other guests.

`GET /v1/health` answers `200 ok` (no upgrade) for monitoring.

## Application messages

The relay does not interpret these. Coordinates are normalised to the stage viewport: `x`, `y` in `[0, 1]`, origin at the top left.

### Pairing

1. Host opens the room and shows a QR for `<page URL>?view=remote&room=<room>`.
2. Guest connects; host gets `join` and sends `{ "t": "pair", "to": id, "code": "1234" }` — a fresh 4-digit code per guest.
3. Guest shows the code large. Host shows "a phone asks for control: code 1234 — allow / deny".
4. Presenter compares the two screens and answers:
   - allow → `{ "t": "grant", "to": id, "token": "<22 chars>" }` (random, kept by the guest in `sessionStorage` for this room)
   - deny → `{ "t": "deny", "to": id }`
5. A reconnecting guest sends `{ "t": "resume", "token" }`; if it matches a token the host granted in this room, the host grants again without asking.
6. The host can take control back: `{ "t": "revoke", "to": id }`. At most one guest holds control; granting a second revokes the first.

A guest that is not granted gets `state` messages only if the host chooses (default: none), and its commands are ignored. A projected QR scanned by the audience therefore only produces a request the presenter denies.

### Host → granted guest

| Message | Fields |
| --- | --- |
| `state` | `mode` (`overview` \| `stage`), `at` (`b.s.p`, 1-based), `step`, `steps`, `elapsed` (s), `total` (s or `null`), `block` (title), `blockElapsed` (s), `blockMinutes` (or `null`) |

Sent on every position change and every 15 s. Notes are not sent: the phone has the same page and reads them from its own DOM.

### Granted guest → host

| Message | Fields | Host does |
| --- | --- | --- |
| `cmd` | `c`: `next` \| `prev` \| `slideNext` \| `slidePrev` \| `pageNext` \| `pagePrev` \| `overview` \| `open`; `at` with `open` | same as the keyboard |
| `ptr` | `x`, `y`, `on` (bool) | shows or hides the laser pointer |
| `ink` | `s` (stroke id, number), `pts` ([x, y, x, y, …], at most 64 points), `end` (bool, optional) | draws the stroke on the overlay |
| `ink-clear` | — | clears the overlay |
| `ping` | — | answers `{ "t": "pong", "to": from }` |

Ink is cleared when the page changes. The host rate-limits `ptr` rendering to one per animation frame.

## Same machine

The presenter window on the same computer uses `BroadcastChannel("contour-deck:<room>")` with the same messages, without `pair` (same browser, trusted).

## Close codes

| Code | Meaning |
| --- | --- |
| `4000` | room closed (host left or idle) |
| `4004` | no host in this room |
| `4009` | room already has a host |
| `4029` | room full |
| `1008` | rate limit |
| `1009` | message too large |
