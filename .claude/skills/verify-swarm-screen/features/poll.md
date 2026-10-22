# Poll

A ballot on every phone; votes count live on the host; Reveal turns the room itself into the chart.

## Sub-features

- `poll-vote` every phone gets the question; changing a vote keeps one vote.
- `poll-count` host bars and leader line update.
- `poll-close` closed ballots go inert.
- `poll-reveal` the room splits into answer zones by position; a phone outside its pick's zone is told "You voted A".
- `poll-anon` Anonymous hides counts until Reveal.

## How to get to it (user POV)

- Tab "Poll": Question, Answer A/B, Anonymous, Start the poll / Close voting / Reveal / Reopen voting.

## Driving it with drive.mjs

Preconditions: three phones scanned in a row (the check does it).

- **Run.** `drive.mjs poll`. Bars read `2 votes · 67%` / `1 vote · 33%`; after Reveal phones are amber, amber, blue; reading `reveal labels = A 67%, A 67%, B 33%`; `phone-ballot.png`, `host-reveal.png`, `phone-reveal.png`.

## Gotchas

- A reloaded host page resumes a running poll in its tab; start each check from a fresh room.
