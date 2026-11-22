/** Exact authoring for Public Execution's destroyed-target controller referent. */
import { describe, expect, it } from 'vitest';
import {
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
  type CardInput,
  type EffectInput,
} from '../src/index';

export const PUBLIC_EXECUTION_EFFECTS: readonly EffectInput[] = [
  {
    kind: 'destroyPermanent',
    target: { kind: 'targetCreatureOpponentControls' },
  },
  {
    kind: 'pumpUntilEndOfTurn',
    power: -2,
    toughness: 0,
    scope: 'creaturesThatPlayerControls',
    excludeReferent: true,
    target: { kind: 'thatCreaturesController' },
  },
];

export const PUBLIC_EXECUTION_INPUT: CardInput = {
  kind: 'instant',
  id: 'm13-public-execution',
  name: 'Public Execution',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 105 },
  manaCost: { generic: 5, B: 1 },
  colors: ['B'],
  effects: [...PUBLIC_EXECUTION_EFFECTS],
};

describe('Public Execution authoring', () => {
  it('accepts the reusable destroy-then-former-controller cohort shape', () => {
    expect(validateCard(PUBLIC_EXECUTION_INPUT)).toEqual([]);
  });

  it('renders the exact printed Oracle paragraph from the effect relationship', () => {
    expect(renderOracleText(parseCard(PUBLIC_EXECUTION_INPUT))).toBe(
      'Destroy target creature an opponent controls. Each other creature that player controls gets -2/-0 until end of turn.',
    );
  });

  it('renders the same referent when an independent instruction sits between the two effects', () => {
    const card = parseCard({
      ...PUBLIC_EXECUTION_INPUT,
      effects: [
        PUBLIC_EXECUTION_EFFECTS[0]!,
        { kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } },
        PUBLIC_EXECUTION_EFFECTS[1]!,
      ],
    });

    expect(renderOracleText(card)).toBe(
      'Destroy target creature an opponent controls. You gain 1 life. Each other creature that player controls gets -2/-0 until end of turn.',
    );
  });

  it('keeps the retained controller scope outside the model-facing generator schema', () => {
    expect(PUBLIC_EXECUTION_EFFECTS.every((effect) => !ModelEffectSchema.safeParse(effect).success)).toBe(
      true,
    );
  });

  it('refuses the exclusion marker without the proven destroyed-creature referent', () => {
    expect(
      validateCard({
        ...PUBLIC_EXECUTION_INPUT,
        effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }, PUBLIC_EXECUTION_EFFECTS[1]!],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ILLEGAL_REFERENT_TARGET', path: 'effects[1].excludeReferent' }),
      ]),
    );
  });
});
