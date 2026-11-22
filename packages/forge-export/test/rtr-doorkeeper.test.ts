/** Installed-Forge parity for RTR Doorkeeper's defender-counted mill. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-37-doorkeeper-forge',
  name: 'Doorkeeper',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 37 },
  colors: ['U'],
  manaCost: { generic: 1, U: 1 },
  subtypes: ['Homunculus'],
  power: 0,
  toughness: 4,
  keywordAbilities: [{ kind: 'defender' }],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2, U: 1 }, tapSelf: true },
      effects: [
        {
          kind: 'millCards',
          count: {
            kind: 'countMatching',
            filter: { cardTypes: ['creature'], keywordAbilities: ['defender'] },
          },
          target: { kind: 'targetPlayer' },
          printedVariable: 'X',
        },
      ],
    },
  ],
});

describe('RTR Doorkeeper Forge export', () => {
  it('matches the installed Mill and Count$Valid defender protocol', () => {
    const lines = mustTranspile(CARD).split('\n');

    expect(lines).toContain('K:Defender');
    expect(lines).toContain(
      'A:AB$ Mill | Cost$ 2 U T | ValidTgts$ Player | NumCards$ Y | SpellDescription$ Target player mills X cards, where X is the number of creatures you control with defender.',
    );
    expect(lines).toContain('SVar:Y:Count$Valid Creature.withDefender+YouCtrl');
  });
});
