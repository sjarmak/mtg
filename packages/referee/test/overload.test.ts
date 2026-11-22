/** Referee wording for the selected CR 702.96 casting profile. */
import { parseCard } from '@mtg/dsl';
import { scenario, type Action, type CastingCostChoice } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { describeAction } from '../src/describe';

const SPELL = parseCard({
  kind: 'instant',
  id: 'rtr-38-downsize-referee',
  name: 'Downsize',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 38 },
  colors: ['U'],
  manaCost: { U: 1 },
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: -4,
      toughness: 0,
      target: { kind: 'targetCreatureYouDontControl' },
    },
  ],
  overload: {
    cost: { generic: 2, U: 1 },
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: -4,
        toughness: 0,
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
});

const EXPECTED: Readonly<Record<CastingCostChoice, string>> = {
  mana: 'using its printed mana cost',
  alternative: 'using its alternative cost',
  overload: 'using its overload cost',
  withoutMana: 'using no mana payment',
};

describe('Overload referee framing', () => {
  it.each(['castSpell', 'beginCastSpell'] as const)(
    'describes every %s casting-cost choice distinctly',
    (type) => {
      const state = scenario({ hands: [[SPELL], []] }).state;
      const oid = state.players[0].hand[0];
      if (oid === undefined) throw new Error('missing spell in hand');

      for (const castingCost of Object.keys(EXPECTED) as CastingCostChoice[]) {
        const action = {
          type,
          player: 0,
          oid,
          targets: [null],
          castingCost,
        } as Action;
        expect(describeAction(state, action)).toContain(EXPECTED[castingCost]);
      }
    },
  );
});
