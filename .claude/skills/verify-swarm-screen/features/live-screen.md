# Live screen

The crowd becomes a moving picture, one pixel per phone: a generated Aurora or Fire, the host camera, or a video file.

## Sub-features

- `live-aurora`, `live-fire`, `live-camera`, `live-video` each source keeps phones' colours changing, Fire in the top, middle and bottom of the room too.
- `live-switch` switching source while live keeps the current picture on the phones until the new one plays, then cuts over. Video with no file yet says "Choose a video file to switch to it" and keeps broadcasting; picking the file switches by itself.

## How to get to it (user POV)

- Tab "Live screen": Source Aurora / Fire / Camera / Video (file picker), Frame rate, Go live, Stop.

## Driving it with drive.mjs

Preconditions: three phones scanned at the top, middle and bottom of the room.

- **Run.** `drive.mjs live`. Reading `distinct colours per phone (top, middle, bottom) in 1.2 s` for each source; a phone with 1 colour is flagged. The video is a 3 s clip the browser records itself, picked as the source while the camera is live (reading `Video, no file yet` must still move), then uploaded through `#live-file` with no Go live press. Readings `picking the file goes live by itself` and `phones show the video (same colour everywhere)`. Screenshots per source and `host-live-video-no-file.png`.

## Gotchas

- "Choose a video file first." is only for pressing Go live on Video with no file; while live the panel keeps the old source instead.
