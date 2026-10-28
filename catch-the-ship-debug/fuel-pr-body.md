Follows #10, which is merged, so this targets main.

From round 5, a fast booster with a high catch height cannot stop between the fixed ignition height and the arms, so it arrives at speed and crashes. From round 7 the hover is also too short and fast for a 1.2 s window. The ship in double rounds flies the same descent.

- The burn lights early once stopping by the catch height would take 130 px/s² (`A_MAX` is 135).
- The hover stops shrinking at 11 px (round 6) and stops speeding up at 2.5 m/s (round 8).
- New test: sweeps entry speed and catch height in rounds 1 to 10 (difficulty stops rising at 10) and fails if any unsteered booster gives under 1.2 s to catch.

No-steer catch window in seconds, 288 spawns per round (entry speed × catch height, over the tower, calm air):

| Round | Before, min / median | Before, zero-window spawns | After, min / median |
|---|---|---|---|
| 1 | 4.55 / 4.57 | 0 | 4.55 / 4.57 |
| 2 | 3.67 / 3.72 | 0 | 3.67 / 3.72 |
| 3 | 2.97 / 2.98 | 0 | 2.97 / 2.98 |
| 4 | 2.25 / 2.42 | 0 | 2.38 / 2.42 |
| 5 | 0.00 / 1.92 | 7 | 1.88 / 1.92 |
| 6 | 0.00 / 1.50 | 50 | 1.48 / 1.50 |
| 7 | 0.00 / 1.13 | 102 | 1.35 / 1.40 |
| 8 | 0.00 / 0.00 | 155 | 1.27 / 1.28 |
| 9 | 0.00 / 0.00 | 207 | 1.27 / 1.28 |
| 10+ | 0.00 / 0.00 | 262 | 1.27 / 1.28 |

After the fix, no spawn has a zero window, and the ship gets the same window as the booster for every spawn. Rounds 1 to 3 fly exactly as before. In round 4, 3 of 288 spawns change: 2 that arrived fast gain up to 0.17 s (to the round median), and 1 loses one frame.

Before the fix, the new test fails with `shortest window per round: 4.40, 3.68, 2.98, 2.25, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00 s`. After, the shortest is 1.28 s.

Checked: `npm test` (21 sim, 7 API), `check:card` 46/46, and `author-demo --check` same as main (4 catches, score 6923, checksum 208481772). No unsteered burn runs out of fuel. Round 1 keeps the tightest margin (2.0%), and round 10 has 8.9%. The most fuel at a catch is still 43.9% (+285), so a catch stays under the 1,800 bound.
