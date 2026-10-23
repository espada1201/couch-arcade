# Locate

Step one for a host: find where every phone sits. Phones flash blink codes and the camera decodes them; without a camera, phones type their row and seat or the host drags them onto the map. A perspective correction turns an angled camera view into a floor plan.

## Sub-features

- `blink-scan` simulated camera films phone tabs; every phone placed to within 2.5 % / 3.5 %.
- `real-camera` the real getUserMedia path, fed a rendered room video (perspective, rolling shutter, blur, noise) by Chrome's fake camera; 9 phones placed to within 1.5 % / 2 %.
- `perspective` four corner clicks make the map a floor plan (each phone within 4 %).
- `back-focus` when a scan ends with every phone on the map and the host came here from another tab ("Go to Locate"), keyboard focus moves to the "Back to <tab>" button; with no banner it stays on Scan the room.
- `mirror` the checkbox "Camera faces the crowd (flip left and right)" has a line under it: tick it when the camera looks back at the crowd from the front, so the map is flipped left to right as the crowd sees the room.
- `seat-grid` "Ask phones for their seat": phones type row and seat; the seats go on the map by themselves once every phone has answered; "Use typed seats" does it early.
- `manual` tap a tray chip then the map to place; drag a placed phone; `]` picks and Shift+arrow nudges.

## How to get to it (user POV)

- Host console, tab "Locate": Start camera / Scan the room; "Camera at an angle? Correct perspective"; "No camera? Use seat numbers"; the "Not on the map yet" tray and the room map.

## Driving it with drive.mjs

Preconditions: none beyond Doctor; each check joins its own phones.

- **Blink scan.** `drive.mjs scan`. Reading `position error |dx|,|dy|` per phone; phones' status says `on the map`; `host-located.png`.
- **Real fake-camera video.** `drive.mjs real-camera` (writes `<out>/room.y4m` once). Readings `camera position error`, `floor-plan error`; `host-real-camera.png`, `host-perspective.png`.
- **Seat grid.** `drive.mjs seat-grid`. Phones answer 1-1, 1-3, 2-1, 2-3 in a 2x3 grid; `map x,y` must be `[[0,0],[1,0],[0,1],[1,1]]`, `data-source=grid`; `phone-seat-form.png`, `host-grid.png`.
- **Manual and keyboard.** `drive.mjs drag`. Readings: tap-to-place lands at 0.30,0.50, drag ends at 0.70,0.40, Shift+ArrowLeft moves x by -0.1; `host-manual.png`.

## Gotchas

- The real-camera phone tabs are 120x200 so software rasterising doesn't starve the host tab.
- Manual coordinates assume the 16:9 room box used once phones are placed by hand.
