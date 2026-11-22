/** RTR #109 as the proven temporary-control chain plus a retained pump rider. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, validateCard } from '@mtg/dsl';

const EFFECTS = [
  { kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } },
  { kind: 'untapPermanent', target: { kind: 'thatCreature' } },
  {
    kind: 'pumpUntilEndOfTurn',
    power: 2,
    toughness: 0,
    keyword: 'haste',
    target: { kind: 'thatCreature' },
  },
] as const;

const CARD = parseCard({
  kind: 'sorcery',
  id: 'rtr-109',
  name: 'Traitorous Instinct',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 109 },
  manaCost: { generic: 3, R: 1 },
  colors: ['R'],
  effects: EFFECTS,
});

describe('RTR Traitorous Instinct authoring', () => {
  it('renders the exact current Oracle paragraph over one retained target', () => {
    expect(validateCard(CARD)).toEqual([]);
    expect(renderOracleText(CARD)).toBe(
      'Gain control of target creature until end of turn. Untap that creature. Until end of turn, it gets +2/+0 and gains haste.',
    );
  });

  it('keeps the temporary-control primitive outside generator output', () => {
    expect(ModelEffectSchema.safeParse(EFFECTS[0]).success).toBe(false);
  });
});
