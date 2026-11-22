/** Ajani Goldmane's one-shot counter cohort and temporary vigilance rider. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { CardEffectSchema, EffectSchema, ModelEffectSchema, renderOracleText, safeParseCard } from '@mtg/dsl';
import { parseCard } from '../src/parse';

const AJANI_COUNTERS = {
  kind: 'putCounters',
  counter: 'plusOnePlusOne',
  count: 1,
  keyword: 'vigilance',
  target: { kind: 'noTarget' },
  scope: 'permanentsYouControl',
  scopeFilter: { cardTypes: ['creature'] },
} as const;

function ajaniInput(effect: unknown = AJANI_COUNTERS): CardInput {
  return {
    kind: 'planeswalker',
    id: 'm11-ajani-counter-rider',
    name: 'Ajani Goldmane',
    rarity: 'mythic',
    set: { code: 'M11', collectorNumber: 1 },
    manaCost: { generic: 2, W: 2 },
    colors: ['W'],
    supertypes: ['legendary'],
    subtypes: ['Ajani'],
    startingLoyalty: 4,
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {} },
        loyaltyCost: -1,
        effects: [effect],
      },
    ],
  } as CardInput;
}

describe('the temporary keyword rider on putCounters', () => {
  it("is available only to a card's hand-authored effect union", () => {
    const authored = CardEffectSchema.parse(AJANI_COUNTERS);
    expect(authored.kind === 'putCounters' && authored.keyword).toBe('vigilance');

    for (const schema of [EffectSchema, ModelEffectSchema]) {
      const parsed = schema.safeParse(AJANI_COUNTERS);
      expect(parsed.success).toBe(false);
    }
  });

  it('prints one retained group in the two sentences Ajani prints', () => {
    expect(renderOracleText(parseCard(ajaniInput()))).toBe(
      '[−1]: Put a +1/+1 counter on each creature you control. Those creatures gain vigilance until end of turn.',
    );
  });

  it('refuses the rider without a scope that binds the referenced group', () => {
    const { scope: _scope, scopeFilter: _filter, ...unscoped } = AJANI_COUNTERS;
    const parsed = safeParseCard(ajaniInput({ ...unscoped, target: { kind: 'targetCreature' } }));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.violations.map((violation) => violation.code)).toContain(
      'ILLEGAL_EFFECT_SCOPE',
    );
  });
});
