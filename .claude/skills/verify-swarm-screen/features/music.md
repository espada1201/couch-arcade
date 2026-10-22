# Music

Party speaker plays the host's song file on every phone in step; Spatial tones make each phone a note so sound travels across the room.

## Sub-features

- `party-load` the file reaches every phone ("N of N phones ready"), screens untouched until Play.
- `party-sync` Play: every phone `data-state=playing`, start anchors within 50 ms, position advancing.
- `party-late` a phone joining mid-song downloads it and falls in step.
- `party-pause` Pause lands on every phone.
- `tones` Spatial tones "Pluck sweep": every phone schedules notes, left before centre before right.

## How to get to it (user POV)

- Tab "Music": mode "Party speaker" (default), pick or drop a file, Play/Pause; mode "Spatial tones", pick a sound, Play.

## Driving it with drive.mjs

Preconditions: none for the party speaker; `tones` scans first.

- **Party speaker.** `drive.mjs play-song [path/to/song.mp3]` (no file: a 12 s generated WAV). Readings `anchor spread ms`, `position advance in 1 s`, `late joiner in step`; `host-ready.png`, `phone-playing.png`, `host-paused.png`.
- **Spatial tones.** `drive.mjs tones`. `AUDIO_TAP` records each phone's scheduled Web Audio starts; readings `notes scheduled per phone`, `first note ms (left, centre, right)` must increase.

## Gotchas

- Headless audio plays to no device; proof is the playback state and the Web Audio schedule, not a recording.
- MP3/M4A decoding depends on the browser build; if a real file fails, retry with a WAV to tell codec from sync.
