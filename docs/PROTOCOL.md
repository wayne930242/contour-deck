# Remote protocol

How a deck (the **host**) and phones (**guests**) talk through the relay. The relay is a per-room forwarder; it decides who may hold the host seat, and the host decides who may control the deck. Version 1.

Version 1 changed before its first release (contour-deck 0.1.0 has no remote): the host seat needs a key, the relay removes a guest the host denied or revoked, it limits requests per client address, and `state` lost `block`. Nothing that spoke the earlier draft was published, so the version stays 1.

## Transport

```
wss://<relay>/v1/room/<room>?role=host&key=<key>
wss://<relay>/v1/room/<room>?role=guest
```

- `key`: the host key, 26 characters of Crockford base32 (128 random bits from `crypto.getRandomValues`). The host keeps it in `sessionStorage` and sends it to the relay only.
- `room`: the first 26 characters of the Crockford base32 encoding of SHA-256 of the key (its UTF-8 bytes, upper case), bits taken most significant first. The QR and every link carry the room, never the key. Anything that is not 26 Crockford characters gets HTTP 400.
- Test vector: key `0123456789ABCDEFGHJKMNPQRS` opens room `YQV9WCK1VFXD4486E3JKK6CYND`.
- Frames are UTF-8 JSON text, at most **2048 bytes**. A larger or binary frame closes the socket with `1009`.
- Every message has a string field `t` (its type). The relay reads only `t`, `to`, and the size; it never stores or logs message bodies.

## Relay rules

One Durable Object per room (`idFromName(room)`).

| Event | Relay does |
| --- | --- |
| host opens without a key, or with a key whose room is not this room | HTTP 403 before the upgrade |
| socket opens | sends `{ "t": "hello", "id": "<8 chars>", "role": "host" \| "guest" }` to it. `id` is assigned by the relay. |
| host opens while a host is connected | the new host takes the seat: the old host is closed with `4009`, its guests with `4000`; the room stays |
| guest opens with no host connected | closes it with `4004` |
| guest opens when 4 guests are connected | closes it with `4029` |
| guest opens / closes | sends `{ "t": "join", "id" }` / `{ "t": "leave", "id" }` to the host |
| host sends a message with `to` | forwards it to that guest only (unknown `to` is dropped) |
| host sends `deny` or `revoke` with `to` | forwards it, then closes that guest with `4003` (the guest leaves; the host gets `leave`) |
| host sends a message without `to` | forwards it to every guest |
| guest sends a message | forwards it to the host only, with `from` set to the guest's id (overwriting any `from` the guest sent) |
| host closes | closes every guest with `4000`; the room is gone |
| no message in the room for 2 hours | closes everyone with `4000` |
| a socket exceeds 60 messages/s (burst 120) | extra messages are dropped; above 10 s of sustained excess, closes with `1008` |
| request `Origin` not in `ALLOWED_ORIGINS` | HTTP 403 before the upgrade |
| more than 60 requests to room paths a minute from one client address, not counting host requests with the room's key | HTTP 429 before anything else is checked |
| more than 30 host requests with the room's key a minute from one client address | HTTP 429 before anything else is checked |

`ALLOWED_ORIGINS` is a comma-separated Worker variable (e.g. `https://www.wayneh.tw,https://wayne930242.github.io,http://localhost:4321`). Guests never reach other guests.

Only the key holder can be host, so only the deck's own tab receives what guests send, the resume token included. A host that reconnects while the relay still counts its old connection as open takes the seat back at once. Of two tabs with the same key (a duplicated tab copies `sessionStorage`), the newer one holds the seat; the older one is closed with `4009` and does not reconnect by itself.

`GET /v1/health` answers `200 ok` (no upgrade) for monitoring.

## Application messages

The relay does not interpret these, except that a `deny` or `revoke` with `to` removes that guest. Coordinates are normalised to the stage viewport: `x`, `y` in `[0, 1]`, origin at the top left.

### Pairing

1. Host opens the room with its key and shows a QR for `<page URL>?view=remote&room=<room>`.
2. Guest connects; host gets `join` and sends `{ "t": "pair", "to": id, "code": "1234" }` — a fresh 4-digit code per guest.
3. Guest shows the code large. Host shows "a phone asks for control: code 1234 — allow / deny".
4. Presenter compares the two screens and answers:
   - allow → `{ "t": "grant", "to": id, "token": "<22 chars>" }` (random, kept by the guest in `sessionStorage` for this room)
   - deny → `{ "t": "deny", "to": id }`; the relay then closes that guest with `4003`, so a denied guest cannot keep a place
5. A reconnecting guest sends `{ "t": "resume", "token" }`; if it matches a token the host granted in this room, the host grants again without asking.
6. The host can take control back: `{ "t": "revoke", "to": id }`, which also removes the guest from the room (`4003`). At most one guest holds control; granting a second revokes the first.

A guest that is not granted gets `state` messages only if the host chooses (default: none), and its commands are ignored. A projected QR scanned by the audience therefore only produces a request the presenter denies.

### Host → granted guest

| Message | Fields |
| --- | --- |
| `state` | `mode` (`overview` \| `stage`), `at` (`b.s.p`, 1-based), `step`, `steps`, `elapsed` (s), `total` (s or `null`), `blockElapsed` (s), `blockMinutes` (or `null`), `ratio` (optional: width over height of the stage), `width` (optional: the stage's width in CSS px), `scroll` (optional: CSS px the stage is scrolled below the top of the current page) |

Sent on every position change and every 15 s. No text of the page crosses the relay: the phone has the same page and reads the notes and the block title from its own DOM, at the position `at` names.

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
| `4000` | room closed (host left or idle, or a new host took the seat) |
| `4003` | removed by the host (after `deny` or `revoke`); the client does not reconnect by itself |
| `4004` | no host in this room; the client retries with a longer backoff (up to 60 s between tries) |
| `4009` | host replaced: a newer connection with the same key holds the host seat; the client does not reconnect by itself |
| `4029` | room full; the client does not reconnect by itself (each retry would count against the address's limit) |
| `1008` | rate limit |
| `1009` | message too large |
