# Card stunt

Any picture, the host's words or an event template is split across the crowd; every phone takes its patch and all flip together after 3-2-1. The host can film it.

## Sub-features

- `stunt-picture` an uploaded picture: each phone shows its quadrant's colour.
- `stunt-words` "Use words" flips a word image.
- `templates` Names with a heart needs both names (message, focus on the empty field); Happy birthday needs a name; Just married needs none.
- `record` "Record the moment" films the flip and offers a `.webm` keepsake.

## How to get to it (user POV)

- Tab "Card stunt": picture thumbnails, event templates, name fields, "Or your words", "Or upload a picture", record checkbox, "Flip the cards".

## Driving it with drive.mjs

Preconditions: phones scanned (each check does it).

- **Picture and words.** `drive.mjs stunt`. Reading `phone colours` must equal red, red, green, blue, yellow, yellow; `distinct colours for "GO"` > 1.
- **Templates.** `drive.mjs templates` (12 phones in a 4x3 block). Readings `Names with a heart: distinct colours`, `Just married: distinct colours` (> 1 each); `host-names.png`.
- **Record.** `drive.mjs record`. Reading `keepsake` (`swarm-moment-YYYY-MM-DD-HHMM.webm`, > 10 KB), saved in the check folder.

## Gotchas

- Words need enough phones in the right rows: three or six scattered phones can all land between letters and show one flat colour. That is sparse sampling, not a bug.
