import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';

const CREATURES_YOU_CONTROL = {
  kind: 'countMatching',
  filter: { cardTypes: ['creature'] },
} as const;

const CHORUS_OF_MIGHT = {
  kind: 'instant',
  id: 'rtr-119-chorus-of-might',
  name: 'Chorus of Might',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 119 },
  manaCost: { generic: 3, G: 1 },
  colors: ['G'],
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: { kind: 'ratePer', rate: 1, each: CREATURES_YOU_CONTROL },
      toughness: { kind: 'ratePer', rate: 1, each: CREATURES_YOU_CONTROL },
      keyword: 'trample',
      printedDurationFirst: true,
      target: { kind: 'targetCreature' },
    },
  ],
} as unknown as CardInput;

describe('RTR #119 Chorus of Might', () => {
  it('parses and renders the current Oracle sentence exactly', () => {
    expect(renderOracleText(parseCard(CHORUS_OF_MIGHT))).toBe(
      'Until end of turn, target creature gets +1/+1 for each creature you control and gains trample.',
    );
  });

  it('keeps the rate, keyword rider, and presentation flag outside the model vocabulary', () => {
    const card = parseCard(CHORUS_OF_MIGHT);
    if (card.kind !== 'instant') throw new Error('Chorus of Might did not parse as an instant');

    expect(card.effects).toHaveLength(1);
    expect(ModelEffectSchema.safeParse(card.effects[0]).success).toBe(false);
  });

  it('refuses duration-first as an alternate spelling for pumps outside this rate-plus-rider shape', () => {
    const result = safeParseCard({
      ...CHORUS_OF_MIGHT,
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 1,
          toughness: 1,
          keyword: 'trample',
          printedDurationFirst: true,
          target: { kind: 'targetCreature' },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('ordinary duration-first pump unexpectedly parsed');
    expect(result.violations.map((violation) => violation.code)).toContain('PUMP_PRESENTATION_INVALID');
  });
});
