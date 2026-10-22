# LAN relay

`npm start` serves the app and a WebSocket relay, so phones on the same Wi-Fi join with no internet. The QR code points at the computer's LAN address.

## Sub-features

- `relay-info` `/relay.json` gives the LAN URL on the served port.
- `relay-autopick` a host page with no `?transport` uses the relay (badge "Wi-Fi").
- `relay-qr` the QR code and join link use the LAN address.
- `relay-join` a phone opening the join link talks through `ws://<lan>/relay?room=…&role=phone`.
- `relay-guard` a second host without the room key gets 409; a phone for an unhosted room gets 404.
- `relay-host-left` closing the host page drops its phones into reconnecting.
- `relay-host-moved` opening the same room in a second host tab moves every phone to it; the first tab says "This room moved to another tab".

## How to get to it (user POV)

- `npm install && npm start`, open the printed link, Host a room; phones scan the QR code.

## Driving it with drive.mjs

Preconditions: Doctor healthy (it already proves the 404 refusal).

- **Run.** `drive.mjs lan`; `drive.mjs host-moved` for a second host tab.
- **Proof.** Readings `relay.json lanUrl`, `join url` (starts with lanUrl), `phone websockets` (relay URL with frames received), `second host, wrong key = 409`, `phone, unknown room = 404`; `host-lan.png`, `phone-lan.png`, `phone-host-left.png`. host-moved: `phones in the new tab after ms`, `old tab says`, every phone shows the new tab's card.

## Gotchas

- The LAN address in a container may be a test address (192.0.2.x); it is still this machine.
- An HTTPS proxy in the environment 403s the LAN WebSocket; the driver launches Chromium with `--no-proxy-server`.
- Relay restarts are covered in [reconnect](./reconnect.md).
