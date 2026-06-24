# Proposal: track Eco Blox usage across all ExoFlex tests (not just EM)

Status: idea, not built yet. For discussion with Josh.

## The gap

We track how many times each Eco Blox has been tested, but that tracking only happens
for the EM test. Manual and Fatigue (and possibly Shear / Fuji) also press on the
ExoFlex block, and that wear is not being recorded anywhere. So our "times tested" per
block is undercounting real usage.

## How it works today

- The Eco Blox ID lives only in the EM Report Output tab. The operator types the ID
  (e.g. `240412_01`) into a field after the test.
- The report records `Run # Tested` (runs performed plus redo attempts) and
  `Run # Counted` (runs analyzed) for that one EM test.
- That row goes into the EM result spreadsheet for that single test folder. There is no
  central running total. The master "Eco Blox ID / Run # Tested" table is aggregated by
  hand across folders.
- Manual and Fatigue capture no Eco Blox ID at all.

## Proposed approach

1. Add an "Eco Blox ID" field to the Manual and Fatigue windows (same field EM already
   has, just surfaced in those windows too).
2. When any ExoFlex test finishes, append one line to a single central tracker file
   (one source of truth) with: date, Eco Blox ID, test type, and a usage count.
3. EM starts feeding the same central file, so everything lives in one place and we stop
   hand-aggregating.

## Open decisions (need Josh's input)

1. **Scope.** Manual and Fatigue for sure. Do Shear and Fuji also use the block and need
   tracking?
2. **What the count means for Manual and Fatigue.** EM counts discrete runs (3-6).
   Manual and Fatigue do not have EM-style runs. The big question: should a Fatigue test
   log its full cycle count (e.g. 28,800, the real wear) or just count as one session?
   And for Manual, count presses or count one per session? This matters because Fatigue
   is by far the heaviest wear on a block.
3. **Where the tally lives.** Recommend one central CSV (in the base save folder) that
   every test appends to. Alternative is per-test files that we keep aggregating by hand.

## Rough effort

Small to medium. Mostly a new input field in two windows, a shared "append a tracker
row" helper in the backend, and wiring each test's completion to call it. No hardware or
safety-path changes. The only real design work is settling decision #2 above.

## Why it is worth doing

Goal 3 in the project goals is data integrity and traceability. Right now a block's true
test history is incomplete, which makes "is this block worn out?" a guess. One central
tally fixes that and removes the manual aggregation step.
