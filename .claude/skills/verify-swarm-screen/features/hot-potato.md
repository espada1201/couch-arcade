# Hot Potato

A fireball flies between neighbours; the holder taps before the fuse burns out or is out.

## Sub-features

- `potato-throw` the holder sees TAP!; a tap throws it ("· 1 throw").
- `potato-burn` an untapped fuse knocks a phone out ("4 still in" or "last one standing").

## How to get to it (user POV)

- Tab "Hot Potato": "Start Hot Potato".

## Driving it with drive.mjs

Preconditions: five phones scanned.

- **Run.** `drive.mjs potato`. Readings `score after one throw`, `score after a burn`; `phone-potato.png`, `host-potato.png`.

## Gotchas

- The holder tab is brought to front before tapping.
