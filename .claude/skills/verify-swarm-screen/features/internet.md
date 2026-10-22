# Internet mode

With no relay, phones reach the host over WebRTC data channels that the public PeerJS broker sets up. Songs, Big screen frames and every other message must get through at full size, and the host alone guards against an untrusted phone.

## Sub-features

- `internet-big` 60 KB song chunks and Big screen frames reach every phone (PeerJS binary serialization cuts them into 16 KB pieces).
- `internet-guard` the host closes a phone that floods (200 copies of its hello at once) or sends a piece over 2 KB, and the phone comes back into its seat.

## How to get to it (user POV)

- Open the app from the hosted site (no `npm start`), or add `?transport=internet`; phones scan the QR code from any network.

## Driving it with drive.mjs

Preconditions: none; `broker.mjs` stands in for `0.peerjs.com` at the browser's network boundary and the data flows tab to tab.

- **Run.** `drive.mjs --transport internet play-song big-room cards` reruns those checks over WebRTC; `drive.mjs internet-guard` always uses Internet mode.
- **Proof.** play-song `3 phones ready after s`; big-room `frames per phone in 10 s` (kb near 56); internet-guard `200 copies of its hello at once: link closed after ms`, `one 16 KB piece: link closed after ms`, `phone back in its seat each time`; `phone-back.png`.

## Gotchas

- Chromium runs with `--disable-features=WebRtcHideLocalIpsWithMdns`, so tabs reach each other by plain host candidates with no internet.
- `--transport internet` has no WebSocket to drop, so `reconnect` reports INCONCLUSIVE there; the slow-phone checks shape TCP only and stay on the relay.
