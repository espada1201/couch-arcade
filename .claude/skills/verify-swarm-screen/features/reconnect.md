# Reconnect and seat keep

Phones and the host survive reloads and network blips: a phone keeps its seat, the host keeps its room, and everyone comes back without rescanning.

## Sub-features

- `phone-reload` a reloaded phone rejoins in the same seat.
- `phone-blip` a dropped phone WebSocket shows "reconnecting…" and returns live in the same seat by itself.
- `host-reload` a reloaded host page keeps the room code and its phones.
- `ghost` a phone in a Wi-Fi dead spot (packets vanish, no FIN or reset) leaves the host's count within about 20 s.
- `relay-restart` while `npm start` is down the host says "Reconnecting to the room server…"; once it is back on the same port the host reclaims its room code and every phone returns to its old seat.

## How to get to it (user POV)

- Pull to refresh on a phone, Wi-Fi drop on a phone, refresh the host page, restart `npm start`.

## Driving it with drive.mjs

Preconditions: transport `lan`, and a server this run launched (not `--url`) for the relay restart.

- **Run.** `drive.mjs reconnect`. The blip is a Playwright `routeWebSocket` passthrough closed on both ends. Readings `phone reload keeps seat`, `socket drop -> back live ms`, `host reload keeps room`, `host warns while the relay is down`, `room recovers after relay restart, same seats (30 s)`, `relay back -> room whole ms`; `phone-reconnecting.png`, `host-relay-down.png`, `host-after-reload.png`, `host-after-relay-restart.png`, `phone-after-relay-restart.png`.

- **Dead spot.** `drive.mjs ghost`. A third phone loads through `impair.mjs`, which then drops every packet both ways. Reading `dead-spot phone dropped from the count after s`; ISSUES over 25 s.

## Gotchas

- WebSocket errors in the console are expected here and allowed.
- The relay restart reuses the same port; if another process takes it in between, launch fails.
