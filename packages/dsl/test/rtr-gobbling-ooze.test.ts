/** Exact hand-authored source-excluding sacrifice for RTR Gobbling Ooze. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import {
  MechanicModelAbilitySchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  safeParseCard,
} from '../src/index';

const GOBBLING_OOZE_INPUT = {
  kind: 'creature',
  id: 'rtr-126-gobbling-ooze',
  name: 'Gobbling Ooze',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 126 },
  colors: ['G'],
  manaCost: { generic: 4, G: 1 },
  subtypes: ['Ooze'],
  power: 3,
  toughness: 3,
  abilities: [
    {
      kind: 'activated',
      cost: {
        mana: { G: 1 },
        sacrificeMatching: {
          count: 1,
          filter: { cardTypes: ['creature'] },
          excludeSource: true,
        },
      },
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
} as const;

describe('Gobbling Ooze DSL', () => {
  it('renders the exact current Oracle text outside model output', () => {
    const card = parseCard(GOBBLING_OOZE_INPUT as unknown as CardInput);
    const ability = card.abilities[0];

    expect(renderOracleText(card)).toBe(
      '{G}, Sacrifice another creature: Put a +1/+1 counter on this creature.',
    );
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
    expect(MechanicModelAbilitySchema.safeParse(ability).success).toBe(false);
  });

  it('admits one canonical true-only source exclusion', () => {
    const falseSpelling = safeParseCard({
      ...GOBBLING_OOZE_INPUT,
      abilities: [
        {
          ...GOBBLING_OOZE_INPUT.abilities[0],
          cost: {
            ...GOBBLING_OOZE_INPUT.abilities[0].cost,
            sacrificeMatching: {
              ...GOBBLING_OOZE_INPUT.abilities[0].cost.sacrificeMatching,
              excludeSource: false,
            },
          },
        },
      ],
    } as unknown as CardInput);

    expect(falseSpelling.ok).toBe(false);
  });

  it('keeps source exclusion off spell additional costs', () => {
    const spell = safeParseCard({
      kind: 'instant',
      id: 'rtr-gobbling-ooze-spell-cost-boundary',
      name: 'Gobbling Ooze Spell Cost Boundary',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      colors: [],
      manaCost: {},
      additionalCost: {
        sacrificeMatching: {
          count: 1,
          filter: { cardTypes: ['creature'] },
          excludeSource: true,
        },
      },
      effects: [{ kind: 'scry', count: 1 }],
    });

    expect(spell.ok).toBe(false);
  });
});
