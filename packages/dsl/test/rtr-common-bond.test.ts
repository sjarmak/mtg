import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, type CardInput } from '@mtg/dsl';

const COMMON_BOND = {
  kind: 'instant',
  id: 'rtr-151-common-bond',
  name: 'Common Bond',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 151 },
  manaCost: { generic: 1, G: 1, W: 1 },
  colors: ['G', 'W'],
  printedEffectParagraphBreaks: [1],
  effects: [
    { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
    { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
  ],
} as unknown as CardInput;

describe('RTR #151 Common Bond', () => {
  it('parses and renders both current Oracle target clauses exactly', () => {
    const card = parseCard(COMMON_BOND);

    expect(renderOracleText(card)).toBe(
      ['Put a +1/+1 counter on target creature.', 'Put a +1/+1 counter on target creature.'].join('\n'),
    );
  });

  it('keeps both retained counter effects outside the model vocabulary', () => {
    const card = parseCard(COMMON_BOND);
    if (card.kind !== 'instant') throw new Error('Common Bond did not parse as an instant');

    expect(card.effects).toHaveLength(2);
    expect(card.effects.every((effect) => !ModelEffectSchema.safeParse(effect).success)).toBe(true);
  });
});
