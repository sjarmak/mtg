/** RTR Keyrunes animate their exact artifact source through layers 4, 5, 6, and 7b. */
import { describe, expect, it } from 'vitest';
import { basicLand, parseCard } from '@mtg/dsl';
import {
  beginTrace,
  characteristicsOf,
  cleanupTurnEffects,
  eligibleAttackers,
  hasCardType,
  hasKeyword,
  legalActions,
  moveObject,
  pendingDecision,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';

const KEYRUNE = parseCard({
  kind: 'artifact',
  id: 'rtr-225',
  name: 'Azorius Keyrune',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 225 },
  manaCost: { generic: 3 },
  colors: [],
  subtypes: [],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { W: 1, U: 1 }, tapSelf: false },
      effects: [
        {
          kind: 'animateSourceUntilEndOfTurn',
          power: 2,
          toughness: 2,
          colors: ['W', 'U'],
          subtypes: ['Bird'],
          keywords: ['flying'],
          target: { kind: 'selfPermanent' },
        },
      ],
    },
  ],
});

const IZZET_KEYRUNE = parseCard({
  kind: 'artifact',
  id: 'rtr-230',
  name: 'Izzet Keyrune',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 230 },
  manaCost: { generic: 3 },
  colors: [],
  subtypes: [],
  abilities: [
    {
      kind: 'activated',
      printedSourceReference: 'thisArtifact',
      cost: { mana: { U: 1, R: 1 }, tapSelf: false },
      effects: [
        {
          kind: 'animateSourceUntilEndOfTurn',
          power: 2,
          toughness: 1,
          colors: ['U', 'R'],
          subtypes: ['Elemental'],
          keywords: [],
          printedDurationFirst: true,
          target: { kind: 'selfPermanent' },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      printedSourceReference: 'thisArtifact',
      optional: true,
      effects: [
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
        { kind: 'discardCards', count: 1, target: { kind: 'noTarget' } },
      ],
    },
  ],
});

function oidOf(state: GameState, name: string): ObjectId {
  const oid = state.battlefield.find((candidate) => state.objects[candidate]?.card.name === name);
  if (oid === undefined) throw new Error(`no ${name} on battlefield`);
  return oid;
}

function activationFor(state: GameState, oid: ObjectId): Extract<Action, { type: 'activateAbility' }> {
  const action = legalActions(state).find(
    (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
      candidate.type === 'activateAbility' && candidate.oid === oid,
  );
  if (action === undefined) throw new Error('Keyrune animation is not payable');
  return action;
}

function resolveActivation(start: ReduceResult, oid: ObjectId): ReduceResult {
  const activated = reduce(start.state, activationFor(start.state, oid));
  const resolved = reduceAll(activated.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  return { state: resolved.state, events: [...start.events, ...activated.events, ...resolved.events] };
}

function keyruneBoard(
  summoningSick: boolean,
  landPairs = 1,
  card = KEYRUNE,
  extra: {
    readonly hands?: readonly [readonly ReturnType<typeof basicLand>[], readonly []];
    readonly libraries?: readonly [readonly ReturnType<typeof basicLand>[], readonly []];
  } = {},
): ReduceResult {
  const partnerLand = card.id === IZZET_KEYRUNE.id ? 'Mountain' : 'Plains';
  const lands = Array.from({ length: landPairs }, (_, index) => [
    { card: basicLand(partnerLand, 'TST', 10 + index * 2), controller: 0 as const },
    { card: basicLand('Island', 'TST', 11 + index * 2), controller: 0 as const },
  ]).flat();
  return scenario({
    battlefield: [{ card, controller: 0, summoningSick }, ...lands],
    ...extra,
    step: 'precombatMain',
  });
}

describe('an RTR Keyrune animation in the kernel', () => {
  it('writes exact layered characteristics until cleanup and preserves artifact', () => {
    const start = keyruneBoard(false);
    const keyrune = oidOf(start.state, KEYRUNE.name);
    expect(hasCardType(start.state, keyrune, 'artifact')).toBe(true);
    expect(hasCardType(start.state, keyrune, 'creature')).toBe(false);

    const resolved = resolveActivation(start, keyrune);
    const current = characteristicsOf(resolved.state, keyrune);
    expect(current.cardTypes).toEqual(['artifact', 'creature']);
    expect(current.colors).toEqual(['W', 'U']);
    expect(current.subtypes).toEqual(['Bird']);
    expect(powerOf(resolved.state, keyrune)).toBe(2);
    expect(toughnessOf(resolved.state, keyrune)).toBe(2);
    expect(hasKeyword(resolved.state, keyrune, 'flying')).toBe(true);
    expect(resolved.state.continuous.map((effect) => effect.layer)).toEqual(['4', '5', '6', '7b']);
    expect(resolved.state.continuous.every((effect) => effect.duration === 'endOfTurn')).toBe(true);

    const cleaned = cleanupTurnEffects(beginTrace(resolved.state));
    expect(hasCardType(cleaned.state, keyrune, 'artifact')).toBe(true);
    expect(hasCardType(cleaned.state, keyrune, 'creature')).toBe(false);
    expect(hasKeyword(cleaned.state, keyrune, 'flying')).toBe(false);
  });

  it('obeys summoning sickness after becoming a creature', () => {
    for (const [summoningSick, expected] of [
      [true, false],
      [false, true],
    ] as const) {
      const start = keyruneBoard(summoningSick);
      const keyrune = oidOf(start.state, KEYRUNE.name);
      const resolved = resolveActivation(start, keyrune);
      const combat = {
        ...resolved.state,
        turn: { ...resolved.state.turn, step: 'declareAttackers' as const },
      };
      expect(eligibleAttackers(combat).includes(keyrune)).toBe(expected);
    }
  });

  it('deduplicates characteristics across repeated activations', () => {
    const start = keyruneBoard(false, 2);
    const keyrune = oidOf(start.state, KEYRUNE.name);
    const once = resolveActivation(start, keyrune);
    const twice = resolveActivation(once, keyrune);
    const current = characteristicsOf(twice.state, keyrune);
    expect(current.cardTypes).toEqual(['artifact', 'creature']);
    expect(current.subtypes).toEqual(['Bird']);
    expect(current.keywords).toEqual(['flying']);
  });

  it('does nothing when that source incarnation leaves before resolution', () => {
    const start = keyruneBoard(false);
    const keyrune = oidOf(start.state, KEYRUNE.name);
    const activated = reduce(start.state, activationFor(start.state, keyrune));
    const departed = moveObject(beginTrace(activated.state), keyrune, 'graveyard');
    const resolved = reduceAll(departed.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(resolved.state.continuous).toHaveLength(0);
  });

  it('lets Izzet Keyrune draw, then choose one card to discard after combat damage', () => {
    const held = basicLand('Forest', 'TST', 30);
    const drawn = basicLand('Plains', 'TST', 31);
    const start = keyruneBoard(false, 1, IZZET_KEYRUNE, {
      hands: [[held], []],
      libraries: [[drawn], []],
    });
    const keyrune = oidOf(start.state, IZZET_KEYRUNE.name);
    const animated = resolveActivation(start, keyrune);
    let current = animated;
    for (let guard = 0; guard < 12; guard += 1) {
      const decision = pendingDecision(current.state);
      if (decision?.kind === 'declareAttackers') break;
      if (decision?.kind !== 'priority') {
        throw new Error(`Izzet animation did not reach combat (${decision?.kind ?? 'nothing'})`);
      }
      current = reduce(current.state, { type: 'passPriority', player: decision.player });
    }
    current = reduce(current.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: keyrune, defender: 1 }],
    });
    for (let guard = 0; guard < 40; guard += 1) {
      const decision = pendingDecision(current.state);
      if (decision?.kind === 'optionalTrigger') break;
      if (decision?.kind === 'declareBlockers') {
        current = reduce(current.state, { type: 'declareBlockers', player: 1, blocks: [] });
        continue;
      }
      if (decision?.kind === 'priority') {
        current = reduce(current.state, { type: 'passPriority', player: decision.player });
        continue;
      }
      throw new Error(`Izzet loot stopped on ${decision?.kind ?? 'nothing'}`);
    }
    const optional = pendingDecision(current.state);
    if (optional?.kind !== 'optionalTrigger') throw new Error('Izzet loot was not optional');
    current = reduce(current.state, {
      type: 'answerOptionalTrigger',
      player: optional.player,
      oid: optional.oid,
      accept: true,
    });
    const discard = pendingDecision(current.state);
    if (discard?.kind !== 'handDiscard') {
      throw new Error(
        `Izzet loot offered no discard choice (${discard?.kind ?? 'nothing'}; hand ${String(current.state.players[0].hand.length)}; graveyard ${String(current.state.players[0].graveyard.length)})`,
      );
    }
    expect(current.state.players[0].hand.map((oid) => current.state.objects[oid]?.card.name)).toEqual([
      held.name,
      drawn.name,
    ]);
    current = reduce(current.state, {
      type: 'chooseDiscards',
      player: discard.player,
      oids: [discard.hand[0] as ObjectId],
    });
    expect(current.state.players[0].hand).toHaveLength(1);
    expect(current.state.players[0].graveyard).toHaveLength(1);
  });
});
