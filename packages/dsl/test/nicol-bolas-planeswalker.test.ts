/** Exact authored DSL for M13 Nicol Bolas and its generator-containment seam. */
import { describe, expect, it } from 'vitest';
import {
  LoyaltyModelAbilitySchema,
  ModelEffectSchema,
  ModelTargetSpecSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
} from '../src/index';

const ULTIMATE_TARGET = { kind: 'targetPlayerOrPlaneswalker' } as const;
const LINKED_PLAYER = { kind: 'thatPlayerOrPlaneswalkerController' } as const;

export const NICOL_BOLAS_INPUT = {
  kind: 'planeswalker',
  id: 'm13-199-nicol-bolas-planeswalker',
  name: 'Nicol Bolas, Planeswalker',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 199 },
  colors: ['U', 'B', 'R'],
  manaCost: { generic: 4, U: 1, B: 2, R: 1 },
  supertypes: ['legendary'],
  subtypes: ['Bolas'],
  startingLoyalty: 5,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 3,
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { excludeCardTypes: ['creature'] } },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -2,
      effects: [{ kind: 'gainControl', target: { kind: 'targetCreature' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -9,
      effects: [
        { kind: 'dealDamage', amount: 7, target: ULTIMATE_TARGET },
        { kind: 'discardCards', count: 7, target: LINKED_PLAYER },
        {
          kind: 'sacrificePermanent',
          count: 7,
          filter: {},
          target: LINKED_PLAYER,
        },
      ],
    },
  ],
} as const;

describe('Nicol Bolas, Planeswalker authoring', () => {
  it('strictly parses all three loyalty abilities and renders current Oracle text', () => {
    const card = parseCard(NICOL_BOLAS_INPUT as unknown as CardInput);
    expect(renderOracleText(card)).toBe(
      '[+3]: Destroy target noncreature permanent.\n' +
        '[−2]: Gain control of target creature.\n' +
        '[−9]: Nicol Bolas deals 7 damage to target player or planeswalker. ' +
        "That player or that planeswalker's controller discards seven cards, then sacrifices seven permanents of their choice.",
    );
  });

  it('admits a third authored effect only on a loyalty ability', () => {
    const ordinary = safeParseCard({
      kind: 'artifact',
      id: 'tst-three-effect-activation',
      name: 'Three Effect Engine',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 3 },
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          effects: [
            { kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } },
            { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
            { kind: 'scry', count: 1 },
          ],
        },
      ],
    } as CardInput);
    expect(ordinary.ok).toBe(false);
    if (ordinary.ok) throw new Error('ordinary three-effect activation unexpectedly parsed');
    expect(ordinary.violations).toContainEqual(
      expect.objectContaining({ code: 'ABILITY_COUNT_INVALID', path: 'abilities[0].effects' }),
    );
  });

  it('requires the linked-seat phrase to follow the one player-or-planeswalker selector', () => {
    const malformed = structuredClone(NICOL_BOLAS_INPUT) as unknown as CardInput;
    const ultimate = malformed.abilities?.[2];
    if (ultimate?.kind !== 'activated') throw new Error('Nicol Bolas ultimate disappeared');
    ultimate.effects[0] = {
      kind: 'dealDamage',
      amount: 7,
      target: { kind: 'targetPlayer' },
    };
    const parsed = safeParseCard(malformed);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('mismatched linked-seat source unexpectedly parsed');
    expect(parsed.violations).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_REFERENT_TARGET',
        path: 'abilities[2].effects[1].target.kind',
      }),
    );
  });

  it('keeps the linked target, counts, effects, and three-effect ability outside model schemas', () => {
    const ultimate = NICOL_BOLAS_INPUT.abilities[2];
    expect(LoyaltyModelAbilitySchema.safeParse(ultimate).success).toBe(false);
    expect(ModelTargetSpecSchema.safeParse(LINKED_PLAYER).success).toBe(false);
    for (const effect of ultimate.effects) expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });
});
