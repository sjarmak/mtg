/** Exact hand-authored land mana-ability grant for RTR Chromatic Lantern. */
import { describe, expect, it } from 'vitest';
import { CardSchema, ModelAbilitySchema, parseCard, renderOracleText, validateCard } from '../src/index';

const GRANT = {
  kind: 'static',
  scope: 'landsYouControl',
  subtype: null,
  modification: { kind: 'grantAnyColorManaAbility' },
} as const;

const LANTERN = {
  kind: 'artifact',
  id: 'rtr-226-chromatic-lantern',
  name: 'Chromatic Lantern',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 226 },
  manaCost: { generic: 3 },
  subtypes: [],
  abilities: [
    GRANT,
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'addMana', produces: ['W', 'U', 'B', 'R', 'G'], amount: 1 }],
    },
  ],
} as const;

describe('RTR #226 Chromatic Lantern', () => {
  it('renders current Oracle in its exact source order', () => {
    expect(renderOracleText(parseCard(LANTERN))).toBe(
      'Lands you control have "{T}: Add one mana of any color."\n{T}: Add one mana of any color.',
    );
  });

  it('keeps the layer-6 grant outside model output', () => {
    expect(ModelAbilitySchema.safeParse(GRANT).success).toBe(false);
  });

  it('refuses the grant on every broader or reflexive scope', () => {
    for (const scope of ['self', 'creaturesYouControl', 'otherCreaturesYouControl', 'allLands']) {
      const card = CardSchema.parse({ ...LANTERN, abilities: [{ ...GRANT, scope }, LANTERN.abilities[1]] });
      expect(validateCard(card).map((entry) => entry.code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
    }
  });
});
