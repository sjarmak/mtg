/** Civic Saber against Forge master ac8c59a8442de8c594d7336021072b8531e2cb36. */
import { parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CIVIC_SABER = parseCard({
  kind: 'artifact',
  id: 'rtr-civic-saber',
  name: 'Civic Saber',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 227 },
  manaCost: { generic: 1 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      attach: { modifications: [{ kind: 'statBonusPerColor', power: 1, toughness: 0 }] },
      effects: [],
    },
  ],
});

describe('Civic Saber in Forge', () => {
  it('writes the checked-in live equipped-card color count exactly', () => {
    const script = mustTranspile(CIVIC_SABER);
    expect(script).toContain('K:Equip:1');
    expect(script).toContain(
      'S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ AffectedX | Description$ Equipped creature gets +1/+0 for each of its colors.',
    );
    expect(script).toContain('SVar:AffectedX:Count$CardNumColors');
    expect(script).toContain(`Oracle:${renderOracleText(CIVIC_SABER).replace('\n', '\\n')}`);
  });
});
