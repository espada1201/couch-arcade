# Big screen

Every phone shows the whole picture: typed text cards, the host camera, the host's shared screen, or live captions of the host's microphone.

## Sub-features

- `cards` empty deck refused; cards shown on every phone; Next, ArrowRight, PageUp step; late joiner sees the current card; Stop returns phones to the lobby.
- `camera` phones show JPEG frames under 60 KB with real picture content.
- `screen-share` same, from `getDisplayMedia`.
- `captions` phones show the words the recogniser hears.

## How to get to it (user POV)

- Tab "Big screen": source Text cards / Share my screen / Camera / Live captions, "Show on phones", Stop.

## Driving it with drive.mjs

Preconditions: none (phones need not be placed).

- **Cards.** `drive.mjs cards`. Phones' `.follow-text` matches each step; reading `phone font px`; `phone-card.png`.
- **Camera / screen.** `drive.mjs camera`, `drive.mjs screen-share`. Readings per phone `{type: image/jpeg, kb, spread}`; host status "Showing … on 2 phones".
- **Captions.** `drive.mjs captions`. Part 1 uses the real recogniser and is INCONCLUSIVE headless (reading shows the host's error, e.g. `audio-capture`). Part 2 replaces only the browser recogniser and must show the words on every phone (`phone-captions-stub.png`).

## Gotchas

- Headless "screen" and "camera" are Chrome's fake capture source; this proves the pipeline, not real screen content.
- Captions need a microphone and the browser's online speech service: verify for real on a desktop Chrome.
