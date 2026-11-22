import { describe, expect, it } from 'vitest';
import {
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
  type CardInput,
} from '@mtg/dsl';

const IZZET_CHARM_INPUT = {
  kind: 'instant',
  id: 'rtr-172-izzet-charm-dsl',
  name: 'Izzet Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 172 },
  manaCost: { U: 1, R: 1 },
  colors: ['U', 'R'],
  effects: [],
  modes: [
    {
      effects: [
        {
          kind: 'counterSpell',
          spellFilter: { excludeCardTypes: ['creature'] },
          unlessCost: { generic: 2 },
        },
      ],
    },
    {
      effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }],
    },
    {
      effects: [
        { kind: 'drawCards', count: 2, target: { kind: 'noTarget' } },
        { kind: 'discardCards', count: 2, target: { kind: 'noTarget' } },
      ],
    },
  ],
} as unknown as CardInput;

describe('RTR #172 Izzet Charm', () => {
  it('renders all three source-attested modes in exact current Oracle order', () => {
    const card = parseCard(IZZET_CHARM_INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      [
        'Choose one —',
        '• Counter target noncreature spell unless its controller pays {2}.',
        '• Izzet Charm deals 2 damage to target creature.',
        '• Draw two cards, then discard two cards.',
      ].join('\n'),
    );
  });

  it('keeps the mode-local toll outside the generator output vocabulary', () => {
    const card = parseCard(IZZET_CHARM_INPUT);
    expect(ModelEffectSchema.safeParse(card.modes?.[0]?.effects[0]).success).toBe(false);
  });

  it('rejects free and variable mode-local counter tolls', () => {
    for (const unlessCost of [{}, { hasX: true }]) {
      const input = structuredClone(IZZET_CHARM_INPUT) as unknown as {
        modes: { effects: Record<string, unknown>[] }[];
      };
      const counter = input.modes[0]?.effects[0];
      if (counter === undefined) throw new Error('counter mode missing');
      counter.unlessCost = unlessCost;
      const parsed = safeParseCard(input);
      expect(parsed.ok).toBe(false);
      expect((parsed.ok ? [] : parsed.violations).map((violation) => violation.code)).toContain(
        'hasX' in unlessCost ? 'UNLESS_COST_IS_VARIABLE' : 'UNLESS_COST_IS_FREE',
      );
    }
  });

  it('rejects an effect-local counter toll inside a permanent ability', () => {
    const parsed = safeParseCard({
      kind: 'creature',
      id: 'invalid-ability-counter-toll',
      name: 'Invalid Ability Counter Toll',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { U: 1 },
      colors: ['U'],
      power: 1,
      toughness: 1,
      effects: [],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'counterSpell', unlessCost: { generic: 2 } }],
        },
      ],
    });

    expect(parsed.ok).toBe(false);
    expect((parsed.ok ? [] : parsed.violations).map((violation) => violation.code)).toContain(
      'UNLESS_ILLEGAL_ON_CARD_TYPE',
    );
  });

  it('rejects competing card-level and effect-local counter tolls', () => {
    const parsed = safeParseCard({
      kind: 'instant',
      id: 'invalid-duplicated-counter-toll',
      name: 'Invalid Duplicated Counter Toll',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { U: 1 },
      colors: ['U'],
      effects: [{ kind: 'counterSpell', unlessCost: { generic: 2 } }],
      unless: { payer: 'targetController', cost: { generic: 3 } },
    });

    expect(parsed.ok).toBe(false);
    expect((parsed.ok ? [] : parsed.violations).map((violation) => violation.code)).toContain(
      'UNLESS_DUPLICATED',
    );
  });
});
