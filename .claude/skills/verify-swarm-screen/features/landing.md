# Landing page

The page at `/` explains the app, sends a host to a new room and lets a guest type a room code.

## Sub-features

- `landing-render` heading and pitch render with no page errors.
- `landing-host` "Host a room" opens a host console (Wi-Fi badge under `npm start`).
- `landing-join` a 4-character code opens that room's phone gate; a bad code is flagged.
- `host-narrow` the host console fits a 390 px screen without sideways scroll.

## How to get to it (user POV)

- Open the printed `http://localhost:<port>/` link.

## Driving it with drive.mjs

Preconditions: Doctor healthy.

- **Run.** `drive.mjs landing`.
- **Proof.** `landing.png`; `AB` + Join gives `aria-invalid=true` and "Room codes are 4 letters or numbers" (`landing-invalid.png`); `abcd` lands on `?room=ABCD` with "Join the swarm" (`phone-gate.png`); reading `host badge via landing = Wi-Fi`; `host console overflow at 390px = 0` (`host-390.png`).

## Gotchas

- The landing link carries no `transport`; the badge proves the app picked the relay by itself.
