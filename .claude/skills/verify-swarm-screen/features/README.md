# Swarm Screen verification map

One file per user-facing feature. Each names the `drive.mjs` check(s) that prove it and the
observable end state that counts as proof on the real `npm start` build.

## Baseline

- Run from the repo root; the script launches `npm start` on a free port in 4550-4560 and runs Doctor.
- Default transport is `lan` (the relay). `--transport local` reruns the same checks over
  BroadcastChannel to tell an app bug from a relay bug.
- Every check makes its own room in a fresh browser; never drive a server another agent started.

## Feature entry contract

H1 and one paragraph, then four H2s: `Sub-features`, `How to get to it (user POV)`,
`Driving it with drive.mjs` (starts with `Preconditions:`), `Gotchas`. User paths and proof only.

## Features

- [Landing page](./landing.md): `landing`
- [LAN relay](./lan-relay.md): `lan`, `host-moved`, `doctor`
- [Locate](./locate.md): `scan`, `real-camera`, `seat-grid`, `drag`
- [Music](./music.md): `play-song [file]`, `slow-song`, `tones`
- [Big screen](./big-screen.md): `cards`, `camera`, `big-room`, `screen-share`, `captions`
- [Poll](./poll.md): `poll`
- [Show](./show.md): `show`, `countdown`, `first-dance`
- [Card stunt](./card-stunt.md): `stunt`, `templates`, `record`, `slow-flip`
- [Live screen](./live-screen.md): `live`
- [Wave](./wave.md): `wave`
- [Territory](./territory.md): `territory`
- [Hot Potato](./hot-potato.md): `potato`
- [Reconnect and seat keep](./reconnect.md): `reconnect`
