# Photo & cards

Any picture, the host's words or an event template is spread across the crowd and all phones flip together after 3-2-1. There are two styles. In Photo wall (the default), phones laid side by side each show their own piece of the picture. In Stadium cards, every phone takes one colour of it. The host can film it.

## Sub-features

- `photo-wall` Photo wall style: three phones in a row show a red, green, blue picture across all three, each with its own picture filling its screen; four phones in a square show their quadrants.
- `line-up` "Line them up for me" in the note at the top (shown only while some connected phone is not on the map, next to "Go to Locate") puts every such phone into one left-to-right row in seat order, after any phones already on the map, which do not move. The panel says `Done. Phones 1 to 3 are in a row, phone 1 on the left. Ask your friends to hold or lay their phones in that order.` and focus goes to Flip if a picture is already chosen, else to the upload.
- `swap` once two phones are on the map, "Wrong order? Pick two phones to swap their places." shows the phones as numbered buttons in left-to-right order: pick one (`aria-pressed`), then another, and they trade places (`Swapped phones 1 and 3. Left to right: 3, 2, 1.`); picking the same phone again lets go. It works from the keyboard and keeps focus in the row. The line-up note ("phone 1 on the left") goes, since it is no longer true. The Photo wall cuts follow the new places.
- `place-first` Flip with no phone on the map shows the red "Place some phones on the map first." (with Go to Locate) in the footer; it goes away by itself as soon as a phone is on the map (Wave, Music, Show and Live screen do the same), while a different message stays.
- `flip-status` the line under Flip is cleared when the picture, words, template or style change; after a Photo wall flip it reads `3, 2, 1… 3 phones show their piece of the picture.`, or `… of the greeting.` when the stunt is words or an event template.
- `stunt-picture` Stadium cards style, an uploaded picture: each phone shows its quadrant's colour.
- `stunt-words` "Use words" flips a word image. The preview also follows the words as they are typed (about 0.3 s after the last key, like the Name field), so Use words is only a confirm; an emptied box leaves the last words showing.
- `templates` Names with a heart needs both names (message, focus on the empty field); Happy birthday needs a name; Just married needs none.
- `record` "Record the moment" films the flip and offers a `.webm` keepsake.
- `slow-flip` with a 5 MB song downloading in the background, a phone on 1 Mbps Wi-Fi still flips with the rest.

## How to get to it (user POV)

- Flip the cards and its status or red message are a footer pinned to the bottom of the panel (the panel scrolls above it; on a phone-width host the page scrolls and the footer stays at the bottom of the screen), so Flip is in view whatever is scrolled. Enter in a Name field, or in "Or your words" (which first uses the words, like "Use words"), moves focus to Flip.
- Tab "Photo & cards": Style (Photo wall / Stadium cards), picture thumbnails, event templates, name fields, "Or your words", "Or upload a picture", record checkbox, "Flip the cards".

## Driving it with drive.mjs

Preconditions: phones on the map (each check scans them, except the line-up part of `photo-wall`).

- **Photo wall.** `drive.mjs photo-wall` (three phones in a row, then four in a square, each in its own room). Readings `flip moment per phone` (all within 150 ms), `picture box per phone (px)` (each `390x844`, so the picture fills the screen), `own picture per phone (px, KB)` (each its own JPEG, at least 300x600, a few tens of KB), `screenshot centre per phone` read from a real screenshot of each phone (must be near red, green, blue from left to right), `Stadium cards: phone colours` (red, green, blue; no picture), and `square: screenshot centre per phone` (red, green, blue, yellow); `host-wall-preview.png` shows the outlined, numbered preview.
- **Line up, no scan.** The last part of `drive.mjs photo-wall`: three phones joined, nobody scanned, "Line them up for me", upload the strips, Flip. Reading `lined up, no scan: screenshot centre per phone` must be near red, green, blue from left to right (each phone its own third).
- **Picture and words.** `drive.mjs stunt` (picks Stadium cards first). Reading `flip moment per phone` (all within 150 ms); `phone colours` must equal red, red, green, blue, yellow, yellow; `distinct colours for "GO"` > 1.
- **Templates.** `drive.mjs templates` (12 phones in a 4x3 block, Stadium cards). Readings `flip moment per phone`, `Names with a heart: distinct colours`, `Just married: distinct colours` (> 1 each); `host-names.png`.
- **Slow Wi-Fi.** `drive.mjs slow-flip`. Two phones plus one loaded through `impair.mjs` at 1 Mbps (40 ms latency, 30 ms jitter); a 5 MB WAV is fetched in the background while the host flips. Reading `flip moment per phone` (last is the slow phone; all within 150 ms; null means the flip arrived after the countdown should have started), `slow phone sockets` (1).
- **Swap.** The end of `drive.mjs photo-wall`: after the line-up flip, pick Phone 1 then Phone 3, flip again. Reading `swapped 1 and 3: screenshot centre per phone` must be near blue, green, red; `host-swapped-wall.png`.
- **Record.** `drive.mjs record`. Reading `keepsake` (`swarm-moment-YYYY-MM-DD-HHMM.webm`, > 10 KB), saved in the check folder.

## Gotchas

- Words need enough phones in the right rows: three or six scattered phones can all land between letters and show one flat colour. That is sparse sampling, not a bug.
- Photo wall cuts the picture to fit the phones where they sit. Phones far apart show far-apart pieces, and the wall's shape follows the room (two columns with a gap show the picture's two outer strips). A phone that never reported its screen shape counts as an upright 9:19.5 phone. Every placed phone is cut for, so one that is away at the flip shows its piece when it returns. Cutting takes about 20 ms a phone: the status reads `Cutting the picture into N pieces…` and Flip shows `aria-disabled="true"` (it keeps keyboard focus) until the countdown starts. Stop, Lights off, a Wave or a Show, or changing the picture or style, drops a flip that is still being cut.
- After a scan each phone shows its seat number, so a `.label` of `1` is not proof of a countdown; the flip lever only counts a `3 … 1 → blank` run.
