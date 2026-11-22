/** Exact RTR activation composition with paid-sacrifice toughness LKI. */
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const KOROZDA = {
  kind: 'creature' as const,
  id: 'rtr-176-korozda-guildmage',
  name: 'Korozda Guildmage',
  rarity: 'uncommon' as const,
  set: { code: 'RTR', collectorNumber: 176 },
  manaCost: { B: 1, G: 1 },
  colors: ['B', 'G'],
  subtypes: ['Elf', 'Shaman'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'activated' as const,
      cost: { mana: { generic: 1, B: 1, G: 1 } },
      effects: [
        {
          kind: 'pumpUntilEndOfTurn' as const,
          power: 1,
          toughness: 1,
          target: { kind: 'targetCreature' as const },
        },
        {
          kind: 'grantKeywordUntilEndOfTurn' as const,
          keyword: 'intimidate' as const,
          target: { kind: 'thatCreature' as const },
        },
      ],
    },
    {
      kind: 'activated' as const,
      cost: {
        mana: { generic: 2, B: 1, G: 1 },
        sacrificeMatching: {
          count: 1,
          filter: { cardTypes: ['creature' as const] },
          nontoken: true as const,
        },
      },
      effects: [
        {
          kind: 'createToken' as const,
          count: { kind: 'paidSacrificeToughness' as const },
          token: {
            name: 'Saproling',
            power: 1,
            toughness: 1,
            colors: ['G' as const],
            subtypes: ['Saproling'],
            keywords: [],
          },
        },
      ],
    },
  ],
};

describe('RTR #176 Korozda Guildmage', () => {
  it('renders both current Oracle abilities exactly and in source order', () => {
    expect(renderOracleText(parseCard(KOROZDA as unknown as CardInput))).toBe(
      "{1}{B}{G}: Target creature gets +1/+1 and gains intimidate until end of turn. (It can't be blocked except by artifact creatures and/or creatures that share a color with it.)\n" +
        "{2}{B}{G}, Sacrifice a nontoken creature: Create X 1/1 green Saproling creature tokens, where X is the sacrificed creature's toughness.",
    );
  });

  it('keeps both authored activation shapes outside model output', () => {
    const card = parseCard(KOROZDA as unknown as CardInput);
    expect(card.abilities.every((ability) => !ModelAbilitySchema.safeParse(ability).success)).toBe(true);
  });

  it('requires exactly one nontoken permanent sacrifice for paid toughness', () => {
    const tokenAbility = KOROZDA.abilities[1];
    if (tokenAbility === undefined) throw new Error('Korozda lost its token activation');
    const noCost = safeParseCard({
      ...KOROZDA,
      abilities: [KOROZDA.abilities[0], { ...tokenAbility, cost: { mana: { generic: 2 } } }],
    } as unknown as CardInput);
    const two = safeParseCard({
      ...KOROZDA,
      abilities: [
        KOROZDA.abilities[0],
        {
          ...tokenAbility,
          cost: {
            ...tokenAbility.cost,
            sacrificeMatching: { ...tokenAbility.cost.sacrificeMatching, count: 2 },
          },
        },
      ],
    } as unknown as CardInput);

    expect(noCost.ok ? '' : noCost.violations.map(({ message }) => message).join(' ')).toMatch(
      /paid-sacrifice-toughness|exactly one permanent/iu,
    );
    expect(two.ok ? '' : two.violations.map(({ message }) => message).join(' ')).toMatch(
      /paid-sacrifice-toughness|exactly one permanent/iu,
    );
  });
});
