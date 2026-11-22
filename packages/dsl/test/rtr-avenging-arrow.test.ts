/** Exact hand-authored current-turn damage target for RTR Avenging Arrow. */
import { describe, expect, it } from 'vitest';
import {
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  TargetFilterSchema,
  type CardInput,
} from '../src/index';

const INPUT = {
  kind: 'instant',
  id: 'rtr-4-avenging-arrow',
  name: 'Avenging Arrow',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 4 },
  colors: ['W'],
  manaCost: { generic: 2, W: 1 },
  effects: [
    {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', filter: { dealtDamageThisTurn: true } },
    },
  ],
} as const;

describe('Avenging Arrow DSL', () => {
  it('renders exact current Oracle without widening model targets', () => {
    const card = parseCard(INPUT as unknown as CardInput);

    expect(renderOracleText(card)).toBe('Destroy target creature that dealt damage this turn.');
    expect(ModelEffectSchema.safeParse(card.effects[0]).success).toBe(false);
  });

  it('admits only the positive current-turn damage predicate', () => {
    expect(TargetFilterSchema.safeParse({ dealtDamageThisTurn: true }).success).toBe(true);
    expect(TargetFilterSchema.safeParse({ dealtDamageThisTurn: false }).success).toBe(false);
  });

  it('reuses the predicate in a battlefield cohort without losing its printed clause', () => {
    const sweep = parseCard({
      ...INPUT,
      kind: 'sorcery',
      id: 'rtr-damage-history-sweep',
      name: 'Damage History Sweep',
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'noTarget' },
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'], dealtDamageThisTurn: true },
        },
      ],
    } as unknown as CardInput);

    expect(renderOracleText(sweep)).toBe('Destroy all creatures that dealt damage this turn.');
  });

  it('refuses the live-incarnation predicate in graveyard and stack filters', () => {
    const graveyard = safeParseCard({
      ...INPUT,
      effects: [
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetCardInYourGraveyard',
            filter: { dealtDamageThisTurn: true },
          },
        },
      ],
    } as unknown as CardInput);
    const stack = safeParseCard({
      ...INPUT,
      effects: [{ kind: 'counterSpell', spellFilter: { dealtDamageThisTurn: true } }],
    } as unknown as CardInput);

    expect(graveyard.ok).toBe(false);
    expect(stack.ok).toBe(false);
    if (graveyard.ok || stack.ok) throw new Error('live damage history escaped its battlefield boundary');
    expect(graveyard.violations.map((violation) => violation.code)).toContain('ILLEGAL_TARGET_FILTER');
    expect(stack.violations.map((violation) => violation.code)).toContain('ILLEGAL_TARGET_FILTER');
  });
});
