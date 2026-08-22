/**
 * Positions the referee tests rule on.
 *
 * Every one is built with the kernel's own `scenario` and advanced with real
 * actions, so a test never rules on a board the engine could not have reached.
 */
import { BASIC_LANDS, exampleCard, parseCard } from '@mtg/dsl';
import type { AgentView, GameState, ReduceResult, ScenarioPermanent } from '@mtg/kernel';
import { opponentOf, pendingDecision, reduce, scenario } from '@mtg/kernel';
import { exampleBlockingPosition } from '@mtg/referee';

/** The view for whoever owes the pending decision. */
export function viewFor(state: GameState): AgentView {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('positions: the kernel is not waiting for a decision');
  return { state, player: decision.player, decision };
}

/** Player 1 owes blocks against a two-creature attack. */
export function blockingView(): AgentView {
  return viewFor(exampleBlockingPosition().state);
}

/**
 * The same shape with the defender at six life, so declining to block loses the
 * game on this combat step and a refereed run finishes in a handful of rulings.
 */
export function lethalBlockingPosition(): ReduceResult {
  const start = scenario({
    battlefield: [
      { card: exampleCard('slc-ironclad-golem'), controller: 0 },
      { card: exampleCard('slc-thornhide-guardian'), controller: 0 },
      { card: exampleCard('slc-emberflow-raider'), controller: 1 },
    ],
    life: [20, 6],
    step: 'declareAttackers',
  });
  const attackers = start.state.battlefield
    .filter((oid) => start.state.objects[oid]?.controller === 0)
    .map((oid) => ({ oid, defender: opponentOf(0) }));
  const declared = reduce(start.state, { type: 'declareAttackers', player: 0, attackers });
  return { state: declared.state, events: [...start.events, ...declared.events] };
}

/**
 * A two-target spell on a twenty-four creature board, which the kernel cannot
 * enumerate.
 *
 * Each of the two damage effects may name any creature, so the cast's target
 * space is 24 x 24 = 576 and `DEFAULT_ENUMERATION_CAP` stops the cartesian
 * product at 512. The priority decision that comes back therefore reports
 * `complete: false` — the gap the kernel admits to, and the only thing the
 * compile-down backlog is built from.
 *
 * This used to be six attackers into six blockers. `mtg-tb7v` stage 2 made
 * declarations ask one creature at a time instead of truncating, so no board
 * of any size makes a declaration report an incomplete list any more; target
 * combinations are stage 3 and still truncate, so the referee's one honest
 * subject moved there.
 */
export function cappedTargetingPosition(): ReduceResult {
  const mountain = BASIC_LANDS.find((card) => card.name === 'Mountain');
  if (mountain === undefined) throw new Error('positions: the DSL prints no Mountain');
  const volley = parseCard({
    kind: 'instant',
    id: 'referee-twin-volley',
    name: 'Twin Volley',
    rarity: 'common',
    set: { code: 'REF', collectorNumber: 9 },
    manaCost: { R: 1 },
    colors: ['R'],
    // Two different amounts, because the DSL refuses a card that repeats one
    // effect exactly.
    effects: [
      { kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } },
      { kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } },
    ],
  });
  const crowd: readonly ScenarioPermanent[] = Array.from({ length: 24 }, (_unused, at) => ({
    card: exampleCard(at % 2 === 0 ? 'slc-ironclad-golem' : 'slc-thornhide-guardian'),
    controller: (at % 2) as 0 | 1,
  }));

  return scenario({
    battlefield: [{ card: mountain, controller: 0 }, ...crowd],
    hands: [[volley], []],
    active: 0,
    step: 'precombatMain',
  });
}
