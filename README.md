# Swarm Screen

Turn a room full of phones into one machine. Everyone scans a QR code; the host computer's
camera watches every phone flash a unique blink code and works out where each one physically
sits. Then the crowd is a giant display and speaker array.

- **Show**: one button runs a looping choreography: title card, waves with sound, live aurora and fire, pictures.
- **Card stunt**: any picture or your own words, split across the crowd, flipping on a 3-2-1.
- **Live screen**: the host camera, a video, or a generated animation, one pixel per phone.
- **Wave**: light sweeping, ping-ponging or rippling through real space.
- **Sound**: each phone is one speaker, scheduled on a shared clock so notes travel seat to seat.
- **Territory**: two halves of the room tap to push a front line; phones it passes defect.
- **Hot Potato**: a fireball flies between neighbours; tap before the fuse burns out.

No camera? Phones can type their row and seat, or you drag them onto the map. Camera at an angle?
Click the four corners of any rectangle on the floor in the camera picture and phones land on a true
floor plan. The host header shows how tightly phones are synced ("in sync to ±N ms").

## Run on your Mac

1. Install Homebrew from https://brew.sh, then open Terminal and run `brew install node`.
2. Download this repo (green **Code** button, **Download ZIP**) and unzip it.
3. In Terminal, type `cd ` (with a space), drag the unzipped folder onto the window, press Return.
4. Run `npm install && npm start`.
5. Open the printed `http://localhost:4321/` link and click **Host a room**. Phones on the same Wi-Fi scan the QR code.

`npm start` serves the app plus a tiny Wi-Fi relay, so it works with no internet at all. It uses
plain http, so phones can't keep their screens awake: set Auto-Lock to Never, or use the online version.

## Hosting it online

The GitHub Pages workflow publishes the app; phones then connect over the internet through the
free PeerJS broker, over https (so screens stay awake). Pages needs a public repository; the
workflow skips while the repo is private. (The repo name `couch-arcade` is a
leftover; feel free to rename it.)

## How it works

- `src/core/blinkcode.ts`: Manchester-coded 7-bit ids plus CRC-4, looping behind a sync mark (three lit, three dark half-slots).
- `src/core/localize.ts`: decodes every changing camera pixel on its own and groups them by id; the sync mark lets it recover any camera delay up to one loop (~3.4 s) without calibration.
- `src/core/homography.ts`: four clicked floor corners to a true floor plan.
- `src/core/clock.ts`: NTP-style offsets from the fastest round trips.
- `src/net/`: one `Transport` seam with PeerJS (internet), WebSocket relay (Wi-Fi) and BroadcastChannel (tests).
- `?camera=synthetic&transport=local` runs a whole room in browser tabs on one computer.

## Develop

`npm run dev`, `npm test` (unit), `npm run e2e` (Playwright: a host and up to six phone tabs filmed by the synthetic camera, plus an "outside judge" that renders a room video with perspective, blur, glare and rolling shutter and feeds it to Chrome's fake camera, so the real camera path must place 12 phones), `npm run typecheck`.

MIT licence.
