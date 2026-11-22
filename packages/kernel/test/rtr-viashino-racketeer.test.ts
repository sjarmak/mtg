/** Native linked discard-and-draw probes for RTR Viashino Racketeer. */
import { parseCard, type Card } from '@mtg/dsl';
import { eventsOfType, pendingDecision, scenario, type ObjectId, type ReduceResult } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, lands, MOUNTAIN } from './cards';
import { apply, handOidOf } from './helpers';

const VIASHINO_RACKETEER = parseCard({
  kind: 'creature',
  id: 'rtr-112-viashino-racketeer-kernel',
  name: 'Viashino Racketeer',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 112 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  subtypes: ['Lizard', 'Rogue'],
  power: 2,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisCreature',
      optional: true,
      effects: [
        { kind: 'discardCards', count: 1, target: { kind: 'noTarget' } },
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      ],
    },
  ],
});

const HELD_ONE = creature('Racketeer Held One', 1, 1);
const HELD_TWO = creature('Racketeer Held Two', 1, 1);
const DRAWN = creature('Racketeer Drawn', 1, 1);

function untilOptional(hand: readonly Card[]): ReduceResult {
  let current = scenario({
    seed: 'rtr-viashino-racketeer',
    battlefield: lands(MOUNTAIN, 3).map((card) => ({ card, controller: 0 as const })),
    hands: [[VIASHINO_RACKETEER, ...hand], []],
    libraries: [[DRAWN], []],
  });
  current = apply(current, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(current.state, 0, VIASHINO_RACKETEER.name),
    targets: [],
  });
  for (let guard = 0; guard < 12; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'optionalTrigger') return current;
    if (decision?.kind !== 'priority') {
      throw new Error(`Racketeer stopped on ${decision?.kind ?? 'nothing'}`);
    }
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Racketeer did not reach its optional trigger');
}

function answer(start: ReduceResult, accept: boolean): ReduceResult {
  const decision = pendingDecision(start.state);
  if (decision?.kind !== 'optionalTrigger') throw new Error('Racketeer was not asking its controller');
  return apply(start, {
    type: 'answerOptionalTrigger',
    player: decision.player,
    oid: decision.oid,
    accept,
  });
}

describe('Viashino Racketeer linked trigger', () => {
  it('declines without changing the hand or library', () => {
    const asked = untilOptional([HELD_ONE]);
    const hand = [...asked.state.players[0].hand];
    const library = [...asked.state.players[0].library];
    const declined = answer(asked, false);

    expect(declined.state.players[0].hand).toEqual(hand);
    expect(declined.state.players[0].library).toEqual(library);
    expect(eventsOfType(declined.events, 'cardsDiscarded')).toEqual([]);
    expect(eventsOfType(declined.events, 'cardDrawn')).toEqual([]);
    expect(eventsOfType(declined.events, 'triggerDeclined')).toHaveLength(1);
  });

  it('cannot accept a discard from an empty hand and does not draw', () => {
    const accepted = answer(untilOptional([]), true);

    expect(pendingDecision(accepted.state)?.kind).not.toBe('handDiscard');
    expect(accepted.state.players[0].hand).toEqual([]);
    expect(accepted.state.players[0].library).toHaveLength(1);
    expect(eventsOfType(accepted.events, 'cardsDiscarded')).toEqual([]);
    expect(eventsOfType(accepted.events, 'cardDrawn')).toEqual([]);
  });

  it('chooses exactly one card, discards it, then draws exactly one card', () => {
    const accepted = answer(untilOptional([HELD_ONE, HELD_TWO]), true);
    const decision = pendingDecision(accepted.state);
    if (decision?.kind !== 'handDiscard') throw new Error('Racketeer did not ask for one discard');
    expect(decision.count).toBe(1);
    expect(decision.hand).toHaveLength(2);
    const chosen = decision.hand[1] as ObjectId;

    const done = apply(accepted, {
      type: 'chooseDiscards',
      player: decision.player,
      oids: [chosen],
    });
    const discarded = eventsOfType(done.events, 'cardsDiscarded');
    const drawn = eventsOfType(done.events, 'cardDrawn');
    const discardIndex = done.events.findIndex((event) => event.type === 'cardsDiscarded');
    const drawIndex = done.events.findIndex((event) => event.type === 'cardDrawn');

    expect(discarded.at(-1)?.oids).toEqual([chosen]);
    expect(drawn).toHaveLength(1);
    expect(discardIndex).toBeGreaterThanOrEqual(0);
    expect(drawIndex).toBeGreaterThan(discardIndex);
    expect(done.state.players[0].hand.map((oid) => done.state.objects[oid]?.card.name).sort()).toEqual(
      [HELD_ONE.name, DRAWN.name].sort(),
    );
    expect(done.state.players[0].library).toEqual([]);
  });
});
