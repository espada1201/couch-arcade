# Wave

Light sweeps, ping-pongs or ripples through the real positions of the phones.

## Sub-features

- `wave-sweep` default sweep reaches the left of the room before the centre before the right.

## How to get to it (user POV)

- Tab "Wave": direction, colour, shape controls, "Start the wave", Stop.

## Driving it with drive.mjs

Preconditions: three phones scanned in a row (left, centre, right).

- **Run.** `drive.mjs wave`. Reading `peak ms (left, centre, right)` strictly increasing with each peak brightness > 300; `host-wave.png`.

## Gotchas

- Reads colours as fast as Playwright allows (~2.6 s); a loaded machine blurs peaks, so rerun before calling it a bug.
