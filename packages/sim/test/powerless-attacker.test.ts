/**
 * Reported from a played game: the bot attacked with a 0/4 Kraken Hatchling.
 *
 * `attackValue` prices an attack as damage dealt plus the exchange the defender
 * would take, and both halves of that are zero for a creature with no power:
 * it deals nothing when unblocked, and no block of it is worth the defender's
 * bar, so the worst case stays zero and zero clears `acceptableTradeLoss`. What
 * the scoring never counted is the cost that is paid whatever the defender
 * does: the creature taps, and a wall that taps is a wall that does not block.
 */
import { eligibleAttackers, scenario } from '@mtg/kernel';
import type { GameState, ObjectId } from '@mtg/kernel';
import { chooseAttackers, DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { creature, creatureWithStatic } from './cards';

const HATCHLING = creature('Kraken Hatchling', 0, 4);

/** A powerless body whose attack is worth something anyway. */
const HERALD: Card = parseCard({
  kind: 'creature',
  id: 'tst-powerless-herald',
  name: 'Silent Herald',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 900 },
  colors: ['W'],
  manaCost: { generic: 1, W: 1 },
  power: 0,
  toughness: 3,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'targetPlayer' } }],
    },
  ],
} as unknown as CardInput);

function board(mine: readonly Card[], theirs: readonly Card[] = []): GameState {
  return scenario({
    active: 0,
    step: 'declareAttackers',
    battlefield: [
      ...mine.map((card) => ({ card, controller: 0 as const })),
      ...theirs.map((card) => ({ card, controller: 1 as const })),
    ],
  }).state;
}

function attackerNames(state: GameState): readonly string[] {
  return chooseAttackers(state, 0, eligibleAttackers(state), DEFAULT_GREEDY_CONFIG).map(
    (declaration: { readonly oid: ObjectId }) => state.objects[declaration.oid]?.card.name ?? '?',
  );
}

describe('an attacker with no power', () => {
  it('stays home against an empty board', () => {
    expect(attackerNames(board([HATCHLING]))).toEqual([]);
  });

  it('stays home beside a real attacker that still swings', () => {
    expect(attackerNames(board([HATCHLING, creature('Hill Giant', 3, 3)]))).toEqual(['Hill Giant']);
  });

  it('attacks when attacking is what its own trigger asks for', () => {
    expect(attackerNames(board([HERALD]))).toEqual(['Silent Herald']);
  });

  it('still attacks when CR 508.1d compels it', () => {
    const berserker = creatureWithStatic('Reckless Barnacle', 0, 4, { kind: 'attacksEachCombatIfAble' });
    expect(attackerNames(board([berserker]))).toEqual(['Reckless Barnacle']);
  });

  it('joins a lethal swing rather than sitting one out', () => {
    const state = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [20, 3],
      battlefield: [
        { card: HATCHLING, controller: 0 as const },
        { card: creature('Closer', 4, 4), controller: 0 as const },
      ],
    }).state;
    expect([...attackerNames(state)].sort()).toEqual(['Closer', 'Kraken Hatchling']);
  });
});
