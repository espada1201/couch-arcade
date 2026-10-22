# Big screen

Every phone shows the whole picture: typed text cards, the host camera, the host's shared screen, or live captions of the host's microphone.

## Sub-features

- `cards` empty deck refused; cards shown on every phone; Next, ArrowRight, PageUp step; late joiner sees the current card; Stop returns phones to the lobby.
- `camera` phones show JPEG frames under 60 KB with real picture content.
- `big-room` eight phones on the relay, camera frames near 50 KB each: every phone keeps getting frames.
- `slow-follow` a phone on 256 kbps Wi-Fi stays about one frame behind instead of drifting back.
- `lost-acks` a phone whose frame acks never reach the host still gets a new picture every 2 to 3 s instead of freezing on the first.
- `screen-share` same, from `getDisplayMedia`.
- `captions` phones show the words the recogniser hears.

## How to get to it (user POV)

- Tab "Big screen": source Text cards / Share my screen / Camera / Live captions, "Show on phones", Stop.

## Driving it with drive.mjs

Preconditions: none (phones need not be placed).

- **Cards.** `drive.mjs cards`. Phones' `.follow-text` matches each step; reading `phone font px`; `phone-card.png`.
- **Camera / screen.** `drive.mjs camera`, `drive.mjs screen-share`. Readings per phone `{type: image/jpeg, kb, spread}`; host status "Showing … on 2 phones".
- **Big room.** `drive.mjs big-room`. Chrome's fake camera plays a noise video (`noise.y4m` in the evidence dir) that JPEG can't shrink, so frames sit near the budget. Reading `frames per phone in 10 s` `[{frames, kb}]` for all eight phones; ISSUES if any phone got fewer than 5; `last-phone-picture.png`.
- **Slow Wi-Fi.** `drive.mjs slow-follow`. Two phones plus one through `impair.mjs` at 256 kbps; noise frames near 50 KB (about 1.7 s each on that link). Readings `host frames sent`, `slow phone frames`, `slow phone lag s over time` (host send to phone receive, per frame); ISSUES if the lag after 15 s exceeds 6 s.
- **Lost acks.** `drive.mjs lost-acks`. One phone drops every outgoing `ack`; reading `frames in 15 s with every ack lost`, ISSUES under 4; `phone-picture.png`.
- **Captions.** `drive.mjs captions`. Part 1 uses the real recogniser and is INCONCLUSIVE headless (reading shows the host's error, e.g. `audio-capture`). Part 2 replaces only the browser recogniser and must show the words on every phone (`phone-captions-stub.png`).

## Gotchas

- Headless "screen" and "camera" are Chrome's fake capture source; this proves the pipeline, not real screen content.
- Captions need a microphone and the browser's online speech service: verify for real on a desktop Chrome.
