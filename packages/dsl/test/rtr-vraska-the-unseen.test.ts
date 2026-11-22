/** Exact authored DSL and containment contract for RTR Vraska the Unseen. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '../src/index';

export const VRASKA_INPUT = {
  kind: 'planeswalker',
  id: 'rtr-208-vraska-the-unseen',
  name: 'Vraska the Unseen',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 208 },
  manaCost: { generic: 3, B: 1, G: 1 },
  colors: ['B', 'G'],
  supertypes: ['legendary'],
  subtypes: ['Vraska'],
  startingLoyalty: 5,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [],
      retaliateForCombatDamageUntilYourNextTurn: true,
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -3,
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { excludeCardTypes: ['land'] } },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -7,
      effects: [
        {
          kind: 'createToken',
          count: 3,
          token: {
            quoteAbilities: true,
            inlineQuotedAbilities: true,
            name: 'Assassin',
            colors: ['B'],
            subtypes: ['Assassin'],
            power: 1,
            toughness: 1,
            keywords: [],
            abilities: [
              {
                kind: 'triggered',
                condition: 'selfDealsCombatDamageToPlayer',
                effects: [{ kind: 'loseGame', target: { kind: 'triggeringPlayer' } }],
              },
            ],
          },
        },
      ],
    },
  ],
} as const;

describe('Vraska the Unseen authoring', () => {
  it('strictly parses and renders current Oracle text in printed order', () => {
    const card = parseCard(VRASKA_INPUT as unknown as CardInput);
    expect(renderOracleText(card)).toBe(
      '[+1]: Until your next turn, whenever a creature deals combat damage to Vraska, destroy that creature.\n' +
        '[−3]: Destroy target nonland permanent.\n' +
        '[−7]: Create three 1/1 black Assassin creature tokens with "Whenever this token deals combat damage to a player, that player loses the game."',
    );
  });

  it('keeps the temporary retaliation capability outside the generator vocabulary', () => {
    expect(ModelAbilitySchema.safeParse(VRASKA_INPUT.abilities[0]).success).toBe(false);
  });

  it('refuses the retaliation flag outside its closed +1 loyalty envelope', () => {
    const malformed = structuredClone(VRASKA_INPUT) as unknown as CardInput;
    const first = malformed.abilities?.[0];
    if (first?.kind !== 'activated') throw new Error('Vraska retaliation ability disappeared');
    first.loyaltyCost = 2;
    const parsed = safeParseCard(malformed);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('malformed retaliation ability unexpectedly parsed');
    expect(parsed.violations).toContainEqual(
      expect.objectContaining({ code: 'ABILITY_COST_INVALID', path: 'abilities[0]' }),
    );
  });

  it('refuses the inline token-rule presentation without quoted abilities', () => {
    const malformed = structuredClone(VRASKA_INPUT) as unknown as CardInput;
    const ultimate = malformed.abilities?.[2];
    const token = ultimate?.kind === 'activated' ? ultimate.effects[0] : undefined;
    if (token?.kind !== 'createToken') throw new Error('Vraska Assassin token disappeared');
    delete token.token.quoteAbilities;
    const parsed = safeParseCard(malformed);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unquoted inline token ability unexpectedly parsed');
    expect(parsed.violations).toContainEqual(
      expect.objectContaining({
        code: 'EFFECT_CONDITION_INVALID',
        path: 'abilities[2].effects[0].token.inlineQuotedAbilities',
      }),
    );
  });
});
