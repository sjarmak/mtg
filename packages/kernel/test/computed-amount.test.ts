/**
 * A quantity the card counts rather than prints, evaluated where it has to be.
 *
 * The only interesting question is *when*. "Damage equal to the number of cards
 * exiled this way" is a number that does not exist when the spell is cast, does
 * not exist when it goes on the stack, and is different after each earlier
 * effect of the same spell — so the evaluation point is the moment the effect
 * applies, and the span it counts is one resolution. Both halves have a wrong
 * answer that a single-effect test would never see, which is why the tests below
 * are all two-effect spells:
 *
 *  - Counting the whole game's log instead of one resolution makes the card grow
 *    every time anything was ever exiled.
 *  - Evaluating before the loop instead of inside it makes it always zero.
 *
 * The third assertion is about the word "cards": a token exiled by the sweep is
 * not a card, and Magic's wording is cards.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@mtg/kernel';
import { playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { creature, SWAMP, sorcery } from './cards';

const EXILED = { kind: 'exiledThisResolution' } as const;

/** The shape the mission's card has: sweep first, then count what the sweep took. */
const RECKONING = sorcery(
  'Void Reckoning',
  [
    { kind: 'exileTarget', scope: 'creaturesThatPlayerControls', target: { kind: 'targetOpponent' } },
    { kind: 'dealDamage', amount: EXILED, target: { kind: 'targetOpponent' } },
  ],
  { generic: 2, B: 1 },
);

/** The same two clauses in the other order, which is a different card. */
const REVERSED = sorcery(
  'Void Prelude',
  [
    { kind: 'dealDamage', amount: EXILED, target: { kind: 'targetOpponent' } },
    { kind: 'exileTarget', scope: 'creaturesThatPlayerControls', target: { kind: 'targetOpponent' } },
  ],
  { generic: 2, B: 1 },
);

function swamps(count: number, controller: 0 | 1): { card: typeof SWAMP; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: SWAMP, controller }));
}

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

function castAtThem(start: GameState, effectCount: number): GameState {
  const oid = playerOf(start, 0).hand[0] ?? '';
  const targets = Array.from({ length: effectCount }, () => ({ kind: 'player', player: 1 }) as const);
  const cast = reduce(start, { type: 'castSpell', player: 0, oid, targets });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
}

function board(
  spell: typeof RECKONING,
  bodies: readonly { readonly card: ReturnType<typeof creature>; readonly token?: boolean }[],
): GameState {
  return scenario({
    battlefield: [...swamps(3, 0), ...bodies.map((body) => ({ ...body, controller: 1 as const }))],
    hands: [[spell], []],
  }).state;
}

describe('an amount counted during resolution', () => {
  it('deals damage equal to what the same resolution exiled', () => {
    const after = castAtThem(
      board(RECKONING, [
        { card: creature('Void Scout', 1, 1) },
        { card: creature('Void Brute', 3, 3) },
        { card: creature('Void Runner', 2, 1) },
      ]),
      2,
    );
    expect(after.exile).toHaveLength(3);
    expect(playerOf(after, 1).life).toBe(17);
  });

  /**
   * Order is the card. Damage first counts an exile that has not happened, and
   * the answer is zero — which is the assertion that the amount is read inside
   * the resolution loop rather than once before it.
   */
  it('counts nothing when the counting clause comes first', () => {
    const after = castAtThem(
      board(REVERSED, [{ card: creature('Void Scout', 1, 1) }, { card: creature('Void Brute', 3, 3) }]),
      2,
    );
    expect(after.exile).toHaveLength(2);
    expect(playerOf(after, 1).life).toBe(20);
  });

  /**
   * "Cards exiled this way", and a token is not a card. The board below is two
   * creatures and one token, all three exiled, and the damage is two.
   */
  it('counts cards rather than objects, so an exiled token adds nothing', () => {
    const after = castAtThem(
      board(RECKONING, [
        { card: creature('Void Scout', 1, 1) },
        { card: creature('Void Spirit', 1, 1), token: true },
        { card: creature('Void Brute', 3, 3) },
      ]),
      2,
    );
    expect(after.exile).toHaveLength(3);
    expect(playerOf(after, 1).life).toBe(18);
  });

  /**
   * The span is one resolution, not the game. A creature exiled by an earlier
   * spell is already in exile when this one resolves, and counting the whole log
   * would add it — the failure mode that grows the card every turn.
   */
  it('counts one resolution rather than everything the game ever exiled', () => {
    const banish = sorcery('Void Call', [{ kind: 'exileTarget', target: { kind: 'targetCreature' } }], {
      generic: 1,
      B: 1,
    });
    const start = scenario({
      battlefield: [
        ...swamps(6, 0),
        { card: creature('Void Scout', 1, 1), controller: 1 },
        { card: creature('Void Brute', 3, 3), controller: 1 },
      ],
      hands: [[banish, RECKONING], []],
    }).state;

    const scout = start.battlefield.find((oid) => start.objects[oid]?.card.name === 'Void Scout') ?? '';
    const first = reduce(start, {
      type: 'castSpell',
      player: 0,
      oid: playerOf(start, 0).hand[0] ?? '',
      targets: [{ kind: 'permanent', oid: scout }],
    });
    const between = reduceAll(first.state, [pass(first.state), { type: 'passPriority', player: 1 }]).state;
    expect(between.exile).toHaveLength(1);

    const after = castAtThem(between, 2);
    // Two in exile, one of them from the earlier spell, and one point of damage.
    expect(after.exile).toHaveLength(2);
    expect(playerOf(after, 1).life).toBe(19);
  });
});
