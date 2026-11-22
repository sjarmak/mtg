# Forge sim transcripts

Each file is a line-filtered copy of what the installed Forge
(`Forge v.2.0.14-SNAPSHOT-08.08`) printed for one `sim` invocation on
2026-10-11. Nothing in them was typed or edited by hand. The decks are two of
Forge's own Commander precon files, so the player names carry Forge's deck
names (`Ai(1)-Draconic Domination [C17] [2017]`), where the head-to-head tool
writes its deck id as the name.

The filter kept, in order and unchanged, every line from `Simulation mode` on
that starts with one of:

- `Simulation mode`
- `Ai(1)-... vs Ai(2)-... of Commander` (the header, which ends in `seed <n>` when one was given)
- `Mulligan: `
- `Turn: Turn <n> (`
- `Stopping slow match as draw`
- `Game Outcome: `
- `Match Result: ` (Forge ends this line with a space)
- `Game Result: `

Everything before `Simulation mode` (Forge's startup log) and every other line
of a game (phases, mana, the stack, combat, a warning Forge prints about an AI
default) was dropped. A non-quiet game is about 32 KB before the filter.

| File | Invocation |
| --- | --- |
| `seed-20261011-three-games.txt` | `sim -d <a> <b> -f Commander -n 3 -s 20261011` |
| `seed-20261011-three-games-quiet.txt` | the same with `-q` |
| `seed-<n>-one-game.txt`, n = 1 to 6 | `sim -d <a> <b> -f Commander -n 1 -s <n>` |
| `unseeded-three-games.txt` | `sim -d <a> <b> -f Commander -n 3` |
| `unseeded-four-games-quiet.txt` | `sim -d <a> <b> -f Commander -n 4 -q` |
| `clock-one-second-two-games-quiet.txt` | `sim -d <a> <b> -f Commander -n 2 -c 1 -q` |

What they show, and what a parser has to get right:

- **Quiet output does not say who played first.** Only a non-quiet run prints
  `Turn: Turn 1 (<player>)`, and that line is the one statement of play order.
- **Listing order is not play order.** Seeds 1, 2 and 5 start `Ai(1)`; seeds 3,
  4 and 6 start `Ai(2)`. In both three-game files every game after the first
  was started by the player who lost the game before it.
- **A seed reproduces the games.** The seeded quiet and non-quiet files agree on
  every winner and every `Game Outcome: Turn` figure; only the millisecond
  timings differ between runs.
- **A game the clock stops is printed as a win.** With `-c 1` Forge prints
  `Stopping slow match as draw`, then `has won because all opponents have lost`
  for both players, then credits the game to `Ai(1)` in `Match Result` and in
  `Game Result: ... has won!`. No `ended in a Draw!` line appears.
- **`Game Outcome: Turn <n>` is not the number of turns logged.** Seed 3 logs
  sixteen `Turn:` lines and reports `Game Outcome: Turn 8`.
| `commander-damage-loss.txt` | the `Game Outcome:` and `Game Result:` lines of game 9 of `chaos-incarnate` vs `draconic-destruction` from the 2026-10-22 40-game run (seed 20261022), copied unchanged from the error the tool raised on it; the `Turn:` and `Mulligan:` lines of that game were not kept |
