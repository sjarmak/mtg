/** Exact RTR spell-copy ownership selection without widening model output. */
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
  type CardInput,
} from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const COPY_OWN_SPELL = {
  kind: 'copySpell',
  spellFilter: { cardTypes: ['instant', 'sorcery'] },
  spellSelection: 'targetSpellYouControl',
} as const;

export const NIVIX_GUILDMAGE_INPUT = {
  kind: 'creature' as const,
  id: 'rtr-182-nivix-guildmage',
  name: 'Nivix Guildmage',
  rarity: 'uncommon' as const,
  set: { code: 'RTR', collectorNumber: 182 },
  manaCost: { U: 1, R: 1 },
  colors: ['U', 'R'],
  subtypes: ['Human', 'Wizard'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'activated' as const,
      cost: { mana: { generic: 1, U: 1, R: 1 } },
      effects: [
        { kind: 'drawCards' as const, count: 1, target: { kind: 'noTarget' as const } },
        { kind: 'discardCards' as const, count: 1, target: { kind: 'noTarget' as const } },
      ],
    },
    {
      kind: 'activated' as const,
      cost: { mana: { generic: 2, U: 1, R: 1 } },
      effects: [COPY_OWN_SPELL],
    },
  ],
};

describe('Nivix Guildmage DSL', () => {
  it('renders both current Oracle abilities in their printed order', () => {
    const card = parseCard(NIVIX_GUILDMAGE_INPUT as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      '{1}{U}{R}: Draw a card, then discard a card.\n' +
        '{2}{U}{R}: Copy target instant or sorcery spell you control. You may choose new targets for the copy.',
    );
  });

  it('keeps the controller-restricted stack selector hand-authored', () => {
    expect(CardEffectSchema.safeParse(COPY_OWN_SPELL).success).toBe(true);
    expect(ModelEffectSchema.safeParse(COPY_OWN_SPELL).success).toBe(false);
  });

  it('refuses the ownership selector on an unrelated effect kind', () => {
    expect(
      CardEffectSchema.safeParse({
        kind: 'drawCards',
        count: 1,
        target: { kind: 'noTarget' },
        spellSelection: 'targetSpellYouControl',
      }).success,
    ).toBe(false);
  });
});
