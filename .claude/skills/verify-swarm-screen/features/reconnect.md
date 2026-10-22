# Reconnect and seat keep

Phones and the host survive reloads and network blips: a phone keeps its seat, the host keeps its room, and everyone comes back without rescanning.

## Sub-features

- `phone-reload` a reloaded phone rejoins in the same seat.
- `phone-blip` a dropped phone WebSocket shows "reconnecting…" and returns live in the same seat by itself.
- `host-reload` a reloaded host page keeps the room code and its phones.
- `relay-restart` after `npm start` is restarted on the same port, host and phones find each other again.

## How to get to it (user POV)

- Pull to refresh on a phone, Wi-Fi drop on a phone, refresh the host page, restart `npm start`.

## Driving it with drive.mjs

Preconditions: transport `lan`, and a server this run launched (not `--url`) for the relay restart.

- **Run.** `drive.mjs reconnect`. The blip is a Playwright `routeWebSocket` passthrough closed on both ends. Readings `phone reload keeps seat`, `socket drop -> back live ms`, `host reload keeps room`, `room recovers after relay restart (30 s)`; `phone-reconnecting.png`, `host-after-reload.png`, `host-after-relay-restart.png`, `phone-after-relay-restart.png`.

## Gotchas

- WebSocket errors in the console are expected here and allowed.
- The relay restart reuses the same port; if another process takes it in between, launch fails.
