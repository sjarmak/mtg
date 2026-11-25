# Rollout look-ahead bot

## Question and policy

Does bounded future play find better native-simulator decisions than greedy or
the existing one-ply search?

The rollout policy starts from the greedy action. When a complete decision has
alternatives of the same action type whose one-ply position scores are within
the configured close margin, it keeps at most three candidates and plays each
forward twice with greedy controlling both seats. A rollout ends when the game
ends or after three more turns. Terminal positions use the existing finite
win/loss score; horizon positions use the same life, hand, and battlefield
evaluator as one-ply. The highest mean score wins. Exact ties, decisions with no
close alternative, incomplete decisions, and unavailable rollout support all
return the original greedy action.

The playable policy uses seeded determinization rather than the simulator's
real hidden state. Each future receives a possible world built from the closed
`AgentView` observation boundary:

- Its own library is a seeded permutation of its registered deck after cards it
  can currently see are removed. The player knows the list, but not its order.
- The opposing hand and library retain their public sizes. Their identities are
  sampled from the public format collation distribution after publicly visible
  opponent-owned cards are removed. No concealed card is subtracted or read.
- The fixture campaign's public source is `FIXTURE_FORMAT_POOL`, the DSL example
  set including basic lands. A caller without a public pool receives no rollout
  callback, so the policy falls back exactly to greedy.

The default work cap is six futures per decision: two rollouts times three
candidates. Configuration is rejected when its declared candidate work exceeds
that cap. Every candidate comparison uses one decision-scoped determinization;
every future uses a stream named by the concrete game seed, decision index,
candidate action key, and rollout index.

The old behavior is retained only as an explicitly named privileged diagnostic
comparator. It rolls forward the authoritative hidden cards and is an
omniscient ceiling, not a playable bot result.

## Head-to-head result

The comparison used `packages/sim/tools/head-to-head.ts`, the existing fixture
deck schedule, alternating candidate seats, and seed
`native-action-q/holdout-head-to-head/v1`. A greedy-versus-greedy mirror is the
seat and schedule control. Wilson intervals treat a draw as a non-win, matching
the reported raw candidate-win share.

The required first reading was 80 games. All four arms were rerun together after
the hidden-state repair:

| Policy | Candidate-reference-draw | Win share | Wilson 95% | Departures/game | ms/game |
| --- | ---: | ---: | ---: | ---: | ---: |
| fair rollout | 36-43-1 | 45.00% | 34.58%-55.88% | 6.413 | 1,497.7 |
| privileged rollout ceiling | 43-34-3 | 53.75% | 42.90%-64.25% | 1.325 | 1,557.4 |
| one-ply | 40-39-1 | 50.00% | 39.30%-60.70% | 1.088 | 144.3 |
| greedy mirror | 40-39-1 | 50.00% | 39.30%-60.70% | 0 | 67.9 |

The fair interval included 50%, so its seed stream was extended to 400 games.
The privileged and one-ply rows below are the already-recorded 400-game arms on
that identical deterministic stream; the repaired four-arm rerun reproduced
their 80-game outcomes exactly. The greedy row is the mirror control measured
beside the new fair extension.

| Policy | Candidate-reference-draw | Win share | Wilson 95% | Departures/game | ms/game |
| --- | ---: | ---: | ---: | ---: | ---: |
| fair rollout | 170-210-20 | 42.50% | 37.75%-47.39% | 7.185 | 2,040.8 |
| privileged rollout ceiling | 241-146-13 | 60.25% | 55.38%-64.93% | 1.828 | 945.9 |
| one-ply | 199-197-4 | 49.75% | 44.88%-54.63% | 1.003 | 148.3 |
| greedy mirror | 200-195-5 | 50.00% | 45.12%-54.88% | 0 | 57.7 |

The fair answer is no for this policy and fixture population: determinized
rollout is below the greedy mirror, and its Wilson interval excludes 50%. It
also costs about 35.4 times the mirror wall clock per game. The privileged
ceiling answers the narrower existence question: better choices are available
when future hidden cards are known, but that advantage is not available to a
legal player.

Perfect-information Monte Carlo has a known strategy-fusion limit: each sampled
world is played as though its hidden cards were known within that world, so the
averaged action can combine incompatible contingent strategies. Against the
fixed greedy continuation opponent that distortion matters less than it would
against an adaptive policy, but it still caps what either result can claim. The
large departure increase also says this belief model changes many decisions
without pricing uncertainty well enough to improve them.

## Verification boundary

Unit coverage fixes seed naming, hidden-state invariance, exact greedy fallback,
work-cap rejection, worker-serializable bot specification, and a delayed-payoff
decision where both greedy and one-ply agree but rollout selects the better
future. The hidden-state test varies the opponent's concealed hand and library
and the order of the player's own library while holding public state and the
rollout seed fixed. A separate revealed-top test proves determinization replaces
only concealed slots and preserves cards the observation boundary currently
shows. The head-to-head run exercises the real simulator callback and greedy
continuation.

No engine or DSL source, Forge integration, sweep roster, or balance baseline
changed.

## Combat-only rollout, 2026-11-23

**Question.** Does the fair rollout help when it refines only attack and block
declarations, and plays greedy exactly everywhere else?

**Why combat.** A privileged headroom diagnostic replayed sampled greedy
decisions with alternatives from the true state, greedy in both seats, on The
flagship set's 229-card pool with the balance gate's ten decks. Some
alternative did strictly better at 1.5% of every-eighth real choice over 30
games (0.6% at a pass of priority), and at 13 of 172 attack declarations (7.6%)
and 11 of 86 block declarations (12.8%) over 20 games. It reads the hidden cards
and takes the best of several futures, so the rates are a ceiling; the useful
fact is that combat carries roughly ten times the room a priority stop does. A
census over 60 greedy games on each of the three balance pools put priority,
attacks, blocks and mulligans at about 95% of the decisions with more than one
option.

**Policy.** `COMBAT_ROLLOUT_CONFIG` in `packages/sim/src/rollout-bot.ts`: the
default rollout configuration with `decisionKinds` set to `declareAttackers`
and `declareBlockers`. The same seeded determinization, candidate cap, two
rollouts per candidate and three-turn horizon apply. `decisionKinds` is
optional and absent from `DEFAULT_ROLLOUT_CONFIG`, so the policy measured
above is unchanged.

**Result.** 400 games per population, seats alternated, each candidate arm
beside a greedy mirror on the same seeds. Draws count as non-wins.

| Population | Policy | Candidate-reference-draw | Win share | Wilson 95% | Departures/game | ms/game |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| fixture decks | combat rollout | 181-203-16 | 45.25% | 40.4%-50.1% | 3.520 | 1,484.5 |
| fixture decks | greedy mirror | 200-195-5 | 50.00% | 45.1%-54.9% | 0 | 80.3 |
| the flagship set, 229 cards | combat rollout | 195-203-2 | 48.75% | 43.9%-53.6% | 2.545 | 2,473.7 |
| the flagship set, 229 cards | greedy mirror | 206-194-0 | 51.50% | 46.6%-56.4% | 0 | 125.1 |

The fixture population is `playHeadToHead`'s schedule at seed
`native-action-q/holdout-head-to-head/v1`, the stream of the table above; the
mirror reproduced that table's 200-195-5 exactly. the flagship set population
plays each pairing of the gate's ten decks in both seats, and samples the
opponent's concealed cards from the set's cards plus the five basic lands. Its
slowest candidate game took 37 seconds, against greedy's 0.8.

**Answer: no.** Neither population shows a gain, and both point estimates sit
below their mirror. Restricting the rollout to combat costs less than the full
rollout's 42.5% on the fixture stream, but a three-turn greedy continuation
scored by `evaluateState` does not recover the room the privileged diagnostic
found. The configuration is kept as a recorded negative arm. An outcome-scored
variant (play to the end of the game and score the result) is the untried
next step.

**A real defect found on the way.** When the kernel stages an attack
declaration one creature at a time (`combat.attacksSettled`), greedy rebuilt the
whole declaration and was refused with "o17 is already attacking and cannot be
taken back". It is the attack half of the staged-block defect fixed on
2026-09-15. Greedy now answers mid-sequence with the offered option nearest its
plan (`decideAttacks` in `packages/sim/src/greedy-bot.ts`), and
`packages/sim/test/greedy-staged-blocks.test.ts` replays a game that failed
without it. Greedy against itself answered no attack mid-sequence in 4,494
attack declarations across the three balance pools, so the balance gate's
games are unaffected.
