# Card stunt

Any picture, the host's words or an event template is spread across the crowd and all phones flip together after 3-2-1. Two styles: Photo wall (the default), where phones laid side by side each show their own piece of the picture, and Stadium cards, where every phone takes one colour of it. The host can film it.

## Sub-features

- `photo-wall` Photo wall style: three phones in a row show a red, green, blue picture across all three, each with its own picture filling its screen; four phones in a square show their quadrants.
- `stunt-picture` Stadium cards style, an uploaded picture: each phone shows its quadrant's colour.
- `stunt-words` "Use words" flips a word image.
- `templates` Names with a heart needs both names (message, focus on the empty field); Happy birthday needs a name; Just married needs none.
- `record` "Record the moment" films the flip and offers a `.webm` keepsake.
- `slow-flip` with a 5 MB song downloading in the background, a phone on 1 Mbps Wi-Fi still flips with the rest.

## How to get to it (user POV)

- Tab "Card stunt": Style (Photo wall / Stadium cards), picture thumbnails, event templates, name fields, "Or your words", "Or upload a picture", record checkbox, "Flip the cards".

## Driving it with drive.mjs

Preconditions: phones scanned (each check does it).

- **Photo wall.** `drive.mjs photo-wall` (three phones in a row, then four in a square, each in its own room). Readings `flip moment per phone` (all within 150 ms), `picture box per phone (px)` (each `390x844`: the picture fills the screen), `own picture per phone (px, KB)` (each its own JPEG, at least 300x600, a few tens of KB), `screenshot centre per phone` read from a real screenshot of each phone (must be near red, green, blue from left to right), `Stadium cards: phone colours` (red, green, blue; no picture), and `square: screenshot centre per phone` (red, green, blue, yellow); `host-wall-preview.png` shows the outlined, numbered preview.
- **Picture and words.** `drive.mjs stunt` (picks Stadium cards first). Reading `flip moment per phone` (all within 150 ms); `phone colours` must equal red, red, green, blue, yellow, yellow; `distinct colours for "GO"` > 1.
- **Templates.** `drive.mjs templates` (12 phones in a 4x3 block, Stadium cards). Readings `flip moment per phone`, `Names with a heart: distinct colours`, `Just married: distinct colours` (> 1 each); `host-names.png`.
- **Slow Wi-Fi.** `drive.mjs slow-flip`. Two phones plus one loaded through `impair.mjs` at 1 Mbps (40 ms latency, 30 ms jitter); a 5 MB WAV is fetched in the background while the host flips. Reading `flip moment per phone` (last is the slow phone; all within 150 ms; null means the flip arrived after the countdown should have started), `slow phone sockets` (1).
- **Record.** `drive.mjs record`. Reading `keepsake` (`swarm-moment-YYYY-MM-DD-HHMM.webm`, > 10 KB), saved in the check folder.

## Gotchas

- Words need enough phones in the right rows: three or six scattered phones can all land between letters and show one flat colour. That is sparse sampling, not a bug.
- Photo wall tiles the picture over the phones as they sit, so phones that are far apart show far-apart pieces and the wall's shape follows the room (two columns with a gap show the picture's two outer strips). Phones that never reported a screen shape are laid out as 9:19.5 upright phones.
- After a scan each phone shows its seat number, so a `.label` of `1` is not proof of a countdown; the flip lever only counts a `3 … 1 → blank` run.
