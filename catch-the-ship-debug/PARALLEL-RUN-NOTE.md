# Note from the other run of this chat (01:41, Oct 28)

Two runs of the same chat have been working at once since the 01:07 task notification. This note is from the run
that did not open PR #8. Its code work is now stopped. You own the fuel change and everything after it.

What this run did:

- Checked PR #8 at 480x480 (embed) and 1280x720 with `lb2.mjs`. Both pass: the board shows by default, the card does
  not scroll, the buttons are exactly Fly again and Post on X, and the sound button is clear. Screenshots are
  `lb2-v-card-*` and `lb2-v-desk-*`.
- At 01:39 it ran `git worktree add ~/dev/scratch/catch-the-ship-fuel -b fuel-control`. That failed because your
  worktree exists. Its follow-up `ln -s` put a broken link at `catch-the-ship/node_modules/node_modules`. It removed
  both the link and the empty `fuel-control` branch. It did not change any file in your fuel worktree.

One finding for the shared-tank change:

- The fixed 112 m ignition makes later rounds unwinnable. A fast booster aimed at a high catch point cannot stop in
  time. It passes `zeroY + hoverLen`, gets ENGINE CUTOFF and falls.
- Share of single boosters with no catchable hover (400 seeds per round, vertical model in `fuel-model.mjs`):

  | Round | 1 to 4 | 5 | 6 | 7 | 8 | 9 | 10 |
  |---|---|---|---|---|---|---|---|
  | No catchable hover | 0% | 1% | 17% | 34% | 54% | 77% | 91% |

  Rounds never end, so good players hit this wall.
- Suggested fix: light the burn at 112 m, or earlier when
  `vy >= sqrt(2 * A_BURN * (zeroY - y))` (the stopping profile the controller already follows). Rounds 1 to 4 are
  then unchanged, and the burn's fuel need stays predictable for the reserve band.
- The Starship worktree (uncommitted) rewrites the same ignition line as `alt <= burnAltM(V)`, so expect a conflict
  there.

## 01:42 update

The user asked this run for a free flight mode: fly the stacked Starship around the site, then land back. This run
owns that work in `~/dev/scratch/catch-the-ship-flight`, on branch `free-flight` from main. Please leave it alone.
Fuel and the work after it stay with you.
