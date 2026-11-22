/** Exact hand-authored defender count for RTR Doorkeeper. */
import { describe, expect, it } from 'vitest';
import {
  CountFilterSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
} from '../src/index';

const DOORKEEPER_INPUT = {
  kind: 'creature',
  id: 'rtr-37-doorkeeper',
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
} as const;

describe('Doorkeeper DSL', () => {
  it('renders the exact current Oracle text outside model output', () => {
    const card = parseCard(DOORKEEPER_INPUT as unknown as CardInput);
    const ability = card.abilities[0];
    if (ability?.kind !== 'activated') throw new Error('Doorkeeper lost its activated ability');

    expect(renderOracleText(card)).toBe(
      'Defender\n{2}{U}, {T}: Target player mills X cards, where X is the number of creatures you control with defender.',
    );
    expect(ModelEffectSchema.safeParse(ability.effects[0]).success).toBe(false);
  });

  it('confines the new battlefield-count predicate to defender', () => {
    expect(
      CountFilterSchema.safeParse({
        cardTypes: ['creature'],
        keywordAbilities: ['defender'],
      }).success,
    ).toBe(true);
    expect(CountFilterSchema.safeParse({ keywordAbilities: ['flying'] }).success).toBe(false);
    expect(CountFilterSchema.safeParse({ keywordAbilities: ['defender', 'defender'] }).success).toBe(false);
  });

  it('confines the printed X spelling to the mill template', () => {
    const wrongTemplate = safeParseCard({
      kind: 'sorcery',
      id: 'rtr-doorkeeper-printed-variable-boundary',
      name: 'Doorkeeper Printed Variable Boundary',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 37 },
      colors: [],
      manaCost: {},
      effects: [
        {
          kind: 'dealDamage',
          amount: {
            kind: 'countMatching',
            filter: { cardTypes: ['creature'], keywordAbilities: ['defender'] },
          },
          target: { kind: 'targetOpponent' },
          printedVariable: 'X',
        },
      ],
    });

    expect(wrongTemplate.ok).toBe(false);
    if (wrongTemplate.ok) return;
    expect(wrongTemplate.violations.map((entry) => entry.code)).toContain('SCHEMA_INVALID');

    const literalMill = safeParseCard({
      kind: 'sorcery',
      id: 'rtr-doorkeeper-literal-printed-variable-boundary',
      name: 'Doorkeeper Literal Printed Variable Boundary',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 38 },
      colors: [],
      manaCost: {},
      effects: [
        {
          kind: 'millCards',
          count: 3,
          target: { kind: 'targetOpponent' },
          printedVariable: 'X',
        },
      ],
    });

    expect(literalMill.ok).toBe(false);
    if (literalMill.ok) return;
    expect(literalMill.violations.map((entry) => entry.code)).toContain('MILL_PRESENTATION_INVALID');
  });
});
