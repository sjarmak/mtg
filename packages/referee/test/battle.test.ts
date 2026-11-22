import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { scenario } from '@mtg/kernel';
import { describeAction, describePermanent } from '../src/describe';

const BATTLE = parseCard({
  kind: 'battle',
  id: 'ref-open-front',
  name: 'Open Front',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  defense: 4,
});

describe('Battle referee framing', () => {
  it('states current defense and protector', () => {
    const state = scenario({ battlefield: [{ card: BATTLE, controller: 1, defense: 2 }] }).state;
    const oid = state.battlefield[0];
    if (oid === undefined) throw new Error('missing Battle');
    expect(describePermanent(state, oid)).toContain('2 defense');
    expect(describePermanent(state, oid)).toContain('protected by player 1');
  });

  it('calls a staged transformed cast free rather than alternative', () => {
    const state = scenario({ hands: [[BATTLE], []] }).state;
    const oid = state.players[0].hand[0];
    if (oid === undefined) throw new Error('missing Battle in hand');
    expect(
      describeAction(state, {
        type: 'beginCastSpell',
        player: 0,
        oid,
        targets: [null],
        castingCost: 'withoutMana',
      }),
    ).toContain('using no mana payment');
  });
});
