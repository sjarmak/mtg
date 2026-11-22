/** Exact authoring for Turn to Slag's live attached-permanent destruction. */
import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
  type CardInput,
} from '../src/index';

const TURN_TO_SLAG_INPUT = {
  kind: 'sorcery',
  id: 'm13-turn-to-slag',
  name: 'Turn to Slag',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 153 },
  manaCost: { generic: 3, R: 2 },
  colors: ['R'],
  effects: [
    { kind: 'dealDamage', amount: 5, target: { kind: 'targetCreature' } },
    {
      kind: 'destroyAttachedPermanents',
      target: { kind: 'thatCreature' },
      filter: { subtypes: ['Equipment'] },
    },
  ],
} as unknown as CardInput;

describe('Turn to Slag authoring', () => {
  it('accepts and renders the exact two-instruction Oracle text', () => {
    expect(validateCard(TURN_TO_SLAG_INPUT)).toEqual([]);
    expect(renderOracleText(parseCard(TURN_TO_SLAG_INPUT))).toBe(
      'Turn to Slag deals 5 damage to target creature. Destroy all Equipment attached to that creature.',
    );
  });

  it('keeps attachment destruction outside the generator vocabulary', () => {
    const effect = TURN_TO_SLAG_INPUT.effects?.[1];
    expect(CardEffectSchema.safeParse(effect).success).toBe(true);
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });

  it('requires a filter and one earlier creature target', () => {
    expect(
      CardEffectSchema.safeParse({
        kind: 'destroyAttachedPermanents',
        target: { kind: 'thatCreature' },
      }).success,
    ).toBe(false);
    expect(
      validateCard({
        ...TURN_TO_SLAG_INPUT,
        effects: [TURN_TO_SLAG_INPUT.effects![1]!],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ILLEGAL_REFERENT_TARGET', path: 'effects[0].target.kind' }),
      ]),
    );
  });
});
