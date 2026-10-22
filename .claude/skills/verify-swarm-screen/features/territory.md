# Territory

Two halves of the room tap to push a front line; phones it passes switch to the winners' colour.

## Sub-features

- `territory-tap` phones show TAP; taps from the left push the line; the host announces "Amber wins"; overrun right-hand phones turn amber.

## How to get to it (user POV)

- Tab "Territory": Round length, "Start Territory".

## Driving it with drive.mjs

Preconditions: five phones scanned, two left, one centre, two right.

- **Run.** `drive.mjs territory`. Readings `taps to win`, `overrun right phone colour` (red > 150); `host-territory.png`.

## Gotchas

- The tapping phone is brought to front; background tabs get no animation frames in headless Chrome.
