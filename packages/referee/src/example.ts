/**
 * The position the recorded ruling was recorded on.
 *
 * It ships in `src` rather than in `test` because two things need to agree on
 * it exactly: `tools/record-ruling.ts`, which sends the frame to a live model,
 * and the replay test, which rebuilds the same frame and expects the same
 * fixture key. A fixture is keyed by `hash(system, prompt, schema)`, so if the
 * position drifts the key drifts and the replay fails loudly instead of
 * passing on a recording of a different question.
 *
 * The board is a blocking decision because that is the decision worth asking a
 * model about: a 3/3 and a 3/5 attacking into two 2/1s, with the defender's
 * life total high enough that chump blocking is not forced. Every option is
 * legal, and they differ in judgment rather than in rules.
 */
import { exampleCard } from '@mtg/dsl';
import type { ReduceResult } from '@mtg/kernel';
import { advanceToStep, opponentOf, reduce, scenario } from '@mtg/kernel';

/** Player 0 has attacked with two creatures; player 1 owes blocks. */
export function exampleBlockingPosition(): ReduceResult {
  const start = scenario({
    seed: 'referee-example',
    battlefield: [
      { card: exampleCard('slc-ironclad-golem'), controller: 0 },
      { card: exampleCard('slc-thornhide-guardian'), controller: 0 },
      { card: exampleCard('slc-emberflow-raider'), controller: 1 },
      { card: exampleCard('slc-skywatch-sentinel'), controller: 1 },
    ],
    hands: [[], [exampleCard('slc-lightning-lash')]],
    life: [20, 12],
    step: 'declareAttackers',
  });

  const attackers = start.state.battlefield
    .filter((oid) => start.state.objects[oid]?.controller === 0)
    .map((oid) => ({ oid, defender: opponentOf(0) }));
  const declared = reduce(start.state, { type: 'declareAttackers', player: 0, attackers });

  // Both players still get priority in the declare-attackers step; the blocking
  // decision is the one after it.
  return advanceToStep(
    { state: declared.state, events: [...start.events, ...declared.events] },
    'declareBlockers',
  );
}
