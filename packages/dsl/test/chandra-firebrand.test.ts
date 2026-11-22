/** Exact authored vocabulary for M13 Chandra, the Firebrand. */
import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  ModelEffectSchema,
  ModelTargetSpecSchema,
  parseCard,
  renderOracleText,
  TargetSpecSchema,
} from '@mtg/dsl';

const CHANDRA_INPUT = {
  kind: 'planeswalker',
  id: 'm13-123-chandra-the-firebrand',
  name: 'Chandra, the Firebrand',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 123 },
  manaCost: { generic: 3, R: 1 },
  colors: ['R'],
  supertypes: ['legendary'],
  subtypes: ['Chandra'],
  startingLoyalty: 3,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -2,
      effects: [{ kind: 'copyNextInstantOrSorceryThisTurn' }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -6,
      effects: [
        {
          kind: 'dealDamage',
          amount: 6,
          target: { kind: 'anyTarget', count: 6 },
          division: { kind: 'each' },
        },
      ],
    },
  ],
} as const;

describe('Chandra, the Firebrand authored DSL', () => {
  it('prints all three current Oracle abilities exactly', () => {
    const card = parseCard(CHANDRA_INPUT);
    expect(renderOracleText(card)).toBe(
      '[+1]: Chandra deals 1 damage to any target.\n' +
        '[−2]: When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.\n' +
        '[−6]: Chandra deals 6 damage to each of up to six targets.',
    );
  });

  it('keeps delayed copying and counted targets outside the generator vocabulary', () => {
    const delayed = CHANDRA_INPUT.abilities[1]!.effects[0];
    expect(CardEffectSchema.safeParse(delayed).success).toBe(true);
    expect(ModelEffectSchema.safeParse(delayed).success).toBe(false);
    expect(TargetSpecSchema.safeParse({ kind: 'anyTarget', count: 6 }).success).toBe(true);
    expect(TargetSpecSchema.safeParse({ kind: 'anyTarget', count: 7 }).success).toBe(false);
    expect(ModelTargetSpecSchema.safeParse({ kind: 'anyTarget', count: 6 }).success).toBe(false);
  });

  it('refuses the source-bound delayed-copy effect on an ordinary spell', () => {
    expect(() =>
      parseCard({
        kind: 'sorcery',
        id: 'tst-delayed-copy-spell',
        name: 'Delayed Copy Spell',
        rarity: 'rare',
        set: { code: 'TST', collectorNumber: 1 },
        manaCost: { generic: 1 },
        colors: [],
        effects: [{ kind: 'copyNextInstantOrSorceryThisTurn' }],
      }),
    ).toThrow(/copyNextInstantOrSorceryThisTurn.*permanent ability/u);
  });
});
