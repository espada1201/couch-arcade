# Territory

Two halves of the room tap to push a front line; phones it passes switch to the winners' colour.

## Sub-features

- `territory-tap` phones show TAP; taps from the left push the line; the host announces "Amber wins"; overrun right-hand phones turn amber.
- `territory-masher` a phone mashing 15 taps a second while a 24 MB song downloads in the background stays inside the relay's limit: no 1008 close, and the song still reaches both phones.

## How to get to it (user POV)

- Tab "Territory": Round length, "Start Territory".

## Driving it with drive.mjs

Preconditions: five phones scanned, two left, one centre, two right.

- **Run.** `drive.mjs territory`. Readings `taps to win`, `overrun right phone colour` (red > 150); `host-territory.png`.
- **Masher.** `drive.mjs masher` (two phones). Readings `taps in 15 s` (225), `relay closes per phone` (no 1008), `masher messages per second` (WebSocket sends, at most the phone's budget of 25 a second plus its burst), `song on both phones`; `host-after-mashing.png`.

## Gotchas

- The tapping phone is brought to front; background tabs get no animation frames in headless Chrome.
