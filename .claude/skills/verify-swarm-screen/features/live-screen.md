# Live screen

The crowd becomes a moving picture, one pixel per phone: a generated Aurora or Fire, the host camera, or a video file.

## Sub-features

- `live-aurora`, `live-fire`, `live-camera`, `live-video` each source keeps phones' colours changing; switching source while live restarts it.

## How to get to it (user POV)

- Tab "Live screen": Source Aurora / Fire / Camera / Video (file picker), Frame rate, Go live, Stop.

## Driving it with drive.mjs

Preconditions: three phones scanned at the top, middle and bottom of the room.

- **Run.** `drive.mjs live`. Reading `distinct colours per phone (top, middle, bottom) in 1.2 s` for each source; a phone with 1 colour is flagged. The video is a 3 s clip the browser records itself, uploaded through `#live-file`, then Go live. Screenshots per source.

## Gotchas

- Switching to Video while live ends the broadcast with "Choose a video file first."; the host must pick a file and press Go live again.
