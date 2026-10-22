---
name: verify-swarm-screen
description: Drive the real Swarm Screen build (`npm start`: built app plus the LAN WebSocket relay) with a host tab and phone tabs in Playwright, and prove a feature works the way a host and a room of phones use it. Use to verify any change to Locate, Music, Big screen, Poll, Show, Card stunt, Live screen, Wave, Territory, Hot Potato, reconnects, the relay or the landing page, beyond unit tests and the e2e suite.
---

# Verify Swarm Screen

The artifact is `npm start` (vite build, then `node server/relay.mjs`). One browser plays the host
computer (1440x900 tab) and every phone (390x844 tabs). Phones in the same browser stand in for real
phones; `?sim=x,y` gives each tab its own identity and a spot the simulated camera films.

All driving goes through one script, run from the repo root:

```
node .claude/skills/verify-swarm-screen/drive.mjs [options] <check> [<check> ...]
node .claude/skills/verify-swarm-screen/drive.mjs all                 # every check, ~6 min
node .claude/skills/verify-swarm-screen/drive.mjs play-song ~/song.mp3
node .claude/skills/verify-swarm-screen/drive.mjs help                # list checks
```

Options: `--transport lan|local` (default `lan`, the relay), `--port N` (default: first free port in
4550-4560), `--url http://localhost:N/` (drive a server you already started; no launch, no cleanup),
`--out DIR` (evidence root, default `/tmp/verify-swarm-screen`; env `VERIFY_OUT` too), `--headed`.

## Launch

The script launches for you: `PORT=<free 4550-4560> npm start` in its own process group, logging to
`<out>/server.log` and writing `<pid> <port>` to `<out>/server.pid`. Ready means the log printed
`Swarm Screen is running` and `GET /relay.json` answers, then Doctor passes. To keep a server up for
manual driving: `drive.mjs serve` (Ctrl-C stops it), then point other runs at it with `--url`.
Each check opens its own fresh browser and its own room, so checks never share state. Two runs can go
side by side on different ports and `--out` dirs.

## Doctor

`drive.mjs doctor` (or `drive.mjs --url http://localhost:N/ doctor`) prints JSON and exits non-zero
unless all hold: our server pid is alive, `/` answers 200 with title `Swarm Screen`, `/relay.json`
gives a `lanUrl` on the same port, and a phone WebSocket to `/relay?room=ZZZZ9` is refused with 404
(the relay itself is answering, not a dev server). It also prints the commit and `dist/` build time.
Every check run starts with Doctor and stops if it fails.

## Drive

Each check is a function in `drive.mjs` (`CHECKS`), one per feature-map entry. Shared levers:
`openRoom(run, { sims, transport, camera, args, init, phone })` joins a host and phones and returns
`{ host, phones, seats, code, addPhone }`; `scan(room)` from `e2e/room.ts` runs the simulated-camera
scan; `bg(page)` reads a phone's colour; `png()` makes test pictures; `AUDIO_TAP` records every Web
Audio note a phone schedules; `watchScreens(phones)` + `flipMoments(phones)` time each phone's
3-2-1 flip; `colours(page, ms)` counts the colours a phone shows. Handles are ARIA roles and names (`getByRole('tab', { name: /Poll/ })`,
`'Join the swarm'`, `'Scan the room'`) plus the app's stable hooks: `[data-room]`, `.count`, phone
`.status` / `.label` / `.screen`, `tr[data-seat]` with `data-x/y`, `data-raw-x/y`, `data-source`,
`.nowplaying[data-state|data-anchor|data-pos]`, `.follow-text`, `.follow-picture`, `.score`.
To add a check: add a function to `CHECKS`, add its feature file, keep it driving the user path.

## Evidence

Per check: `<out>/<check>/*.png` (host and phone screenshots of the action and the result),
`result.json` (status, notes, readings such as position errors, sync spread, colours), downloaded
keepsakes, and `failure-tab*.png` on failure. `<out>/results.md` gets a table per run.
Status: PASS, ISSUES (an assertion failed, a reading was out of bounds, or a page logged an error)
or INCONCLUSIVE (the headless browser cannot exercise it; the note says why).
Proof standards: drive the UI a host and a phone guest use, never internal setters; read the result
on the phones (colour, label, audio schedule, picture), not only the host's status line; check side
effects (relay sockets, downloaded files). The only stand-ins are at real browser boundaries: the
simulated camera, Chrome's fake camera/microphone/screen, and (captions part 2) the speech recogniser.

## Cleanup

The script kills only the process group it started (`kill -- -<pid>` from `<out>/server.pid` if a
run was interrupted) and closes its browsers. Never `pkill node`/`npm`: other agents run servers.
Cleanup leaves `<out>` in place; that is the proof. Delete it yourself when done with it.

## Gotchas

- Chromium is launched with `--no-proxy-server`: an environment HTTPS proxy otherwise answers the
  phones' LAN-address WebSocket with 403 and phones sit at `disconnected`.
- Headless background tabs get no animation frames; a phone that must react to clicks is brought to
  front first (`bringToFront`), as the Territory and Hot Potato checks do.
- The feature map is in `features/`; read `features/README.md` before adding or changing a check.
