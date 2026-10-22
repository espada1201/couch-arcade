# LAN relay

`npm start` serves the app and a WebSocket relay, so phones on the same Wi-Fi join with no internet. The QR code points at the computer's LAN address.

## Sub-features

- `relay-info` `/relay.json` gives the LAN URL on the served port.
- `relay-autopick` a host page with no `?transport` uses the relay (badge "Wi-Fi").
- `relay-qr` the QR code and join link use the LAN address.
- `relay-join` a phone opening the join link talks through `ws://<lan>/relay?room=…&role=phone`.
- `relay-guard` a second host without the room key gets 409; a phone for an unhosted room gets 404.
- `relay-room-held` when the host tab closes, its room code is held for it for ten minutes (another host gets 409; a room that never had a phone and lasted under 5 s is not held, and the relay keeps at most 64 held rooms, the oldest dropped first) and a reopened host tab gets its room and phones back, even when the relay is full of other rooms; if the relay restarts and another host takes the code first, the host says "Another host took this room code…" instead of reconnecting forever.
- `relay-untrusted` a phone socket that sends over 2 KB in one message (1009) or floods past 50 messages a second, twice an honest phone's own budget of 25 (1008) is closed; the real phones are untouched.
- `join-failure` a phone joining a code nobody hosts says "Room X is not open on this network. Check the room code, then try again." with a Try again button; the relay's own refusals (too many from one device, relay full) are read the same way, and anything else says to check the Wi-Fi, with the room code.
- `relay-crowd` one device on the Wi-Fi may hold 16 phone sockets and host 16 rooms (the seventeenth gets 429; `RELAY_PER_DEVICE` changes the 16, and an IPv6 device counts by its /64); the computer running the relay is not capped.
- `relay-squat` 40 sockets that ping but never say hello: a real phone still gets a seat at once, and the host closes every squatter about 10 s after it opened (past 32 waiting, a new link is refused unless the oldest has waited over 1.5 s, and then that one goes).
- `relay-host-left` closing the host page drops its phones into reconnecting.
- `relay-host-moved` opening the same room in a second host tab moves every phone to it; the first tab says "This room moved to another tab".

## How to get to it (user POV)

- `npm install && npm start`, open the printed link, Host a room; phones scan the QR code.

## Driving it with drive.mjs

Preconditions: Doctor healthy (it already proves the 404 refusal).

- **Run.** `drive.mjs lan`; `drive.mjs host-moved` for a second host tab; `drive.mjs room-taken` (needs a server the run launched, as it restarts the relay); `drive.mjs squat`.
- **Proof.** Readings `relay.json lanUrl`, `join url` (starts with lanUrl), `phone websockets` (relay URL with frames received), `second host, wrong key = 409`, `phone, unknown room = 404`, `phone sends 3 KB: close code` (1009), `phone sends 200 taps at once: close code` (1008), `fifth phone socket from one device` (429); `host-lan.png`, `phone-lan.png`, `phone-host-left.png`. host-moved: `phones in the new tab after ms`, `old tab says`, every phone shows the new tab's card. room-taken: `another host, host just left` (409), `host back in its room with its phone`, `host says the room was taken after ms`; `host-room-taken.png`. squat: `real phone seated among 40 squatters after ms`, `squatters closed after ms (first, last)` (ISSUES over 13 s); `real-phone-seated.png`.

## Gotchas

- The LAN address in a container may be a test address (192.0.2.x); it is still this machine.
- An HTTPS proxy in the environment 403s the LAN WebSocket; the driver launches Chromium with `--no-proxy-server`.
- Relay restarts are covered in [reconnect](./reconnect.md).
