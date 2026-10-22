# Music

Party speaker plays the host's song file on every phone in step; Spatial tones make each phone a note so sound travels across the room.

## Sub-features

- `party-load` the file reaches every phone ("N of N phones ready"), screens untouched until Play.
- `party-sync` Play: every phone `data-state=playing`, start anchors within 50 ms, and the moments each phone is really heard (`SPEAKER_TAP`: the patched `AudioBufferSourceNode.start` plus the output timestamp) within 50 ms, position advancing.
- `party-late` a phone joining mid-song downloads it and falls in step.
- `party-pause` Pause lands on every phone.
- `slow-song` a phone on slow Wi-Fi (25 KB/s) fetches the song on one link, without resent chunks piling up.
- `tones` Spatial tones "Pluck sweep": every phone schedules notes, left before centre before right.

## How to get to it (user POV)

- Tab "Music": mode "Party speaker" (default), pick or drop a file, Play/Pause; mode "Spatial tones", pick a sound, Play.

## Driving it with drive.mjs

Preconditions: none for the party speaker; `tones` scans first.

- **Party speaker.** `drive.mjs play-song [path/to/song.mp3]` (no file: a 12 s generated WAV). Readings `anchor spread ms`, `true spread ms (when each phone is really heard)`, `position advance in 1 s`, `late joiner in step`, `true spread ms with the late joiner`; `host-ready.png`, `phone-playing.png`, `host-paused.png`.
- **Slow Wi-Fi.** `drive.mjs slow-song`. One phone loads the page through `impair.mjs`, a TCP proxy capping it at 200 kbps with 40 ms latency and 30 ms jitter, so the relay's socket to it backs up as on weak Wi-Fi. Readings `slow phone sockets` (1 = never reconnected), `chunks the slow phone received / distinct`; ISSUES if it isn't ready in 120 s, on any reconnect, or on more than 25% resent chunks.
- **Spatial tones.** `drive.mjs tones`. `AUDIO_TAP` records each phone's scheduled Web Audio starts; readings `notes scheduled per phone`, `first note ms (left, centre, right)` must increase.

## Gotchas

- Headless audio plays to no device; proof is the playback state and the Web Audio schedule, not a recording.
- MP3/M4A decoding depends on the browser build; if a real file fails, retry with a WAV to tell codec from sync.
