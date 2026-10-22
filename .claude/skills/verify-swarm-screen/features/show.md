# Show

One button runs a looping choreography; event moments run on their own: a New Year countdown (optionally ending at midnight, optionally recorded) and a First dance warm wash.

## Sub-features

- `show-loop` Start the show walks the cues: Title card, then Amber sweep after 6.5 s; Stop says "Stopped.".
- `countdown` 10…1 on every phone in step, then the year in full light; works with phones not placed.
- `countdown-record` the host camera films it and offers "Download the keepsake".
- `countdown-midnight` timed to midnight by the wall clock, the host sees "Midnight in h:mm:ss"; more than 12 hours away it is refused, and it follows the wall clock if the host clock drifts or sleeps.
- `first-dance` a slow warm wash (red over blue) moving on the phones until Stop.

## How to get to it (user POV)

- Tab "Show": Title on the crowd, Start the show, Stop; "New Year countdown", "First dance"; record and midnight checkboxes.

## Driving it with drive.mjs

Preconditions: `show` and `first-dance` scan first; `countdown` deliberately does not.

- **Loop.** `drive.mjs show`. Reading `title card flip per phone` (within 150 ms), `cue after 6.5 s = Now: Amber sweep (2 of 8)`; `host-show.png`.
- **Countdown.** `drive.mjs countdown`. Readings `labels read together` (all equal), `burst brightness` (>300), `keepsake` file saved in the check folder, `timed to midnight`; `phone-countdown.png`, `phone-year.png`.
- **First dance.** `drive.mjs first-dance`. Readings `distinct colours in 3 s`, `warm (r > b) share = 1`; `phone-first-dance.png`.

## Gotchas

- The check sets the pages' wall clock (Date) to 22:00 at load (`wallClockAt` in `e2e/room.ts`), so the midnight step runs at any hour.
- The countdown takes ~17 s and the keepsake ~6 s more.
