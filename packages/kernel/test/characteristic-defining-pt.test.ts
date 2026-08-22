/**
 * CR 613.4a, end to end: a characteristic-defining power/toughness, Tarmogoyf's
 * own shape. "Tarmogoyf's power is equal to the number of card types among
 * cards in all graveyards and its toughness is equal to that number plus 1."
 *
 * `definePt` is the DSL's one production constructor for a CDA
 * (`vocabulary.ts`'s `PT_COUNT_SOURCES` names its one member,
 * `graveyardCardTypesEach`); `effectForModification` (`abilities.ts`) compiles
 * it to a layer-7a `PtDefiningEffect` whose `countOf` is a `graveyardCardTypes`
 * `PtCount`, and `characteristics.ts`'s `graveyardCardTypeCount` reads it off
 * `state.players[*].graveyard` through the CR 611.2c "printed values only, no
 * layer walk" path `zone-members.ts` provides. This file is the acceptance
 * test the bead names directly: cast a Tarmogoyf-equivalent, vary graveyard
 * contents across zones and players, and read the computed P/T back — plus a
 * live-recompute case proving the count is not baked in at registration, the
 * same live-resolution family as the control-effect fix in
 * `static-abilities.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { ReduceResult } from '@mtg/kernel';
import { effectsApplyingTo, powerOf, scenario, toughnessOf } from '@mtg/kernel';
import { artifact, creature, instant, lands, MOUNTAIN, sorcery, SWAMP } from './cards';
import { apply, handOidOf, inGraveyard, oidOf } from './helpers';

const GOYF = creature('Test Goyf', 0, 1, {
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: {
        kind: 'definePt',
        countOf: 'graveyardCardTypesEach',
        powerOffset: 0,
        toughnessOffset: 1,
      },
    },
  ],
});

const UNMAKE = instant('Unmake', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], {
  generic: 1,
});

const SCOUT = creature('Graveyard Scout', 1, 1);

function myLands(count: number): { card: Card; controller: 0 }[] {
  return lands(MOUNTAIN, count).map((land) => ({ card: land, controller: 0 as const }));
}

/** Casts player 0's named card from hand and lets it resolve, targeting nothing. */
function castAndResolve(start: ReduceResult, name: string): ReduceResult {
  const oid = handOidOf(start.state, 0, name);
  const cast = apply(start, { type: 'castSpell', player: 0, oid, targets: [] });
  const priority = cast.state.turn.priority;
  if (priority === null) throw new Error('nobody has priority after the cast');
  return apply(apply(cast, { type: 'passPriority', player: priority }), {
    type: 'passPriority',
    player: 1,
  });
}

describe('CR 613.4a, cast and resolved end to end', () => {
  it('registers a layer-7a effect and takes its power/toughness from the graveyard count', () => {
    const start = scenario({
      seed: 'cda/cast',
      battlefield: [...myLands(1)],
      hands: [[GOYF], []],
      // Player 0's graveyard: a creature and a land (2 types). Player 1's: an
      // artifact (1 more). Three distinct card types among cards in all
      // graveyards, none of them repeated.
      graveyards: [[SCOUT, SWAMP], [artifact('Graveyard Idol')]],
    });
    const resolved = castAndResolve(start, 'Test Goyf');
    const goyf = oidOf(resolved.state, 'Test Goyf');
    expect(powerOf(resolved.state, goyf)).toBe(3);
    expect(toughnessOf(resolved.state, goyf)).toBe(4);
    expect(effectsApplyingTo(resolved.state, goyf).map((effect) => effect.layer)).toEqual(['7a']);
  });
});

describe('CR 613.4a, the count over varied graveyard contents', () => {
  function built(graveyards: readonly [readonly Card[], readonly Card[]]) {
    return scenario({ seed: 'cda/count', battlefield: [{ card: GOYF, controller: 0 }], graveyards }).state;
  }

  it('is the printed offsets alone with nothing in any graveyard', () => {
    const state = built([[], []]);
    const goyf = oidOf(state, 'Test Goyf');
    expect(powerOf(state, goyf)).toBe(0);
    expect(toughnessOf(state, goyf)).toBe(1);
  });

  it('counts a type once no matter how many cards of it sit in one graveyard', () => {
    const state = built([[creature('Body A', 1, 1), creature('Body B', 2, 2), creature('Body C', 3, 3)], []]);
    const goyf = oidOf(state, 'Test Goyf');
    expect(powerOf(state, goyf)).toBe(1);
    expect(toughnessOf(state, goyf)).toBe(2);
  });

  it("sums both players' graveyards, and a type repeated across them still counts once", () => {
    const state = scenario({
      seed: 'cda/count-both',
      battlefield: [{ card: GOYF, controller: 0 }],
      graveyards: [
        [creature('Mine', 1, 1), SWAMP],
        [
          creature('Theirs', 2, 2),
          artifact('Their Idol'),
          instant('Their Bolt', [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }]),
          sorcery('Their Doom', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }]),
        ],
      ],
    }).state;
    // creature, land, artifact, instant, sorcery: every CARD_KINDS member,
    // each counted once even though "creature" appears in both graveyards.
    const goyf = oidOf(state, 'Test Goyf');
    expect(powerOf(state, goyf)).toBe(5);
    expect(toughnessOf(state, goyf)).toBe(6);
  });
});

describe('CR 613.4a, recomputed live as the graveyard changes mid-game', () => {
  it('goes up the moment a permanent dies, with no re-registration involved', () => {
    const start = scenario({
      seed: 'cda/live',
      battlefield: [{ card: GOYF, controller: 0 }, { card: SCOUT, controller: 1 }, ...myLands(1)],
      hands: [[UNMAKE], []],
      graveyards: [[], []],
    });
    const goyf = oidOf(start.state, 'Test Goyf');
    expect(powerOf(start.state, goyf)).toBe(0);
    expect(toughnessOf(start.state, goyf)).toBe(1);

    const oid = handOidOf(start.state, 0, 'Unmake');
    const scout = oidOf(start.state, 'Graveyard Scout');
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [{ kind: 'permanent', oid: scout }],
    });
    const priority = cast.state.turn.priority;
    if (priority === null) throw new Error('nobody has priority after the cast');
    const done = apply(apply(cast, { type: 'passPriority', player: priority }), {
      type: 'passPriority',
      player: 1,
    });

    expect(inGraveyard(done.state, scout)).toBe(true);
    // Two graveyard entries now: the destroyed Scout (creature) and Unmake
    // itself, an instant that goes to its caster's graveyard on resolution
    // the way every spell does. Two distinct types, read the instant
    // `moveObject` puts each card there, off the same `state.continuous`
    // record that registered when Goyf entered — nothing re-registers it.
    expect(powerOf(done.state, goyf)).toBe(2);
    expect(toughnessOf(done.state, goyf)).toBe(3);
  });
});
