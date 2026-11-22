import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import type { ReduceResult } from '@mtg/kernel';
import { hasKeyword, pendingDecision, powerOf, reduce, reduceAll, scenario, toughnessOf } from '@mtg/kernel';
import { creature, FOREST } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const CREATURES_YOU_CONTROL = {
  kind: 'countMatching',
  filter: { cardTypes: ['creature'] },
} as const;

const CHORUS_OF_MIGHT = parseCard({
  kind: 'instant',
  id: 'rtr-119-chorus-of-might-kernel',
  name: 'Chorus of Might',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 119 },
  manaCost: { generic: 3, G: 1 },
  colors: ['G'],
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: { kind: 'ratePer', rate: 1, each: CREATURES_YOU_CONTROL },
      toughness: { kind: 'ratePer', rate: 1, each: CREATURES_YOU_CONTROL },
      keyword: 'trample',
      printedDurationFirst: true,
      target: { kind: 'targetCreature' },
    },
  ],
} as unknown as CardInput);

const FRIEND = creature('Chorus Friend', 2, 2);
const TARGET = creature('Chorus Target', 3, 3);
const OPPONENT = creature('Chorus Opponent', 4, 4);

function forests(count: number): readonly { card: Card; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: FOREST, controller: 0 as const }));
}

function passUntilTurn(from: ReduceResult, turn: number): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 400; guard += 1) {
    if (current.state.turn.number >= turn) return current;
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('the game ended before Chorus of Might expired');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`no option offered for ${decision.kind}`);
    current = apply(current, option);
  }
  throw new Error(`never reached turn ${String(turn)}`);
}

describe('RTR #119 Chorus of Might', () => {
  it('counts only the caster’s creatures, grants trample to that target, and expires both changes', () => {
    const start = scenario({
      battlefield: [
        ...forests(4),
        { card: FRIEND, controller: 0 },
        { card: TARGET, controller: 0 },
        { card: OPPONENT, controller: 1 },
      ],
      hands: [[CHORUS_OF_MIGHT], []],
    });
    const target = oidOf(start.state, TARGET.name);
    const spell = handOidOf(start.state, 0, CHORUS_OF_MIGHT.name);
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: spell,
      targets: [{ kind: 'permanent', oid: target }],
    });
    const resolved = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);

    expect(powerOf(resolved.state, target)).toBe(5);
    expect(toughnessOf(resolved.state, target)).toBe(5);
    expect(hasKeyword(resolved.state, target, 'trample')).toBe(true);

    const later = passUntilTurn(resolved, resolved.state.turn.number + 1);
    expect(powerOf(later.state, target)).toBe(3);
    expect(toughnessOf(later.state, target)).toBe(3);
    expect(hasKeyword(later.state, target, 'trample')).toBe(false);
  });
});
