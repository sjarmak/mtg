/**
 * The two shapes `@mtg/setgen` needed before it could commission an Aura or a
 * planeswalker, and the containment they have to keep.
 *
 * `AURA_MODIFICATION_KINDS` is a vocabulary the generator states a slot against;
 * `LoyaltyModelAbilitySchema` is a shape the generator answers in. Both are
 * subsets of what the engine already accepts, so both are checked in the
 * direction that can break: everything the model may propose is something a card
 * can print, read off the schemas rather than typed out beside them.
 */
import { describe, expect, it } from 'vitest';
import {
  AURA_MODIFICATION_KINDS,
  AuraModificationSchema,
  LoyaltyModelAbilitySchema,
  ModelAuraModificationSchema,
  loyaltyAbilityFromModel,
  parseCard,
  renderOracleText,
  safeParseCard,
} from '../src/index';
import type { CardInput, ModelAuraModificationKind } from '../src/index';

/**
 * One clause per kind, carrying exactly the fields that kind declares.
 *
 * Typed as a total record so a member added to the model union fails
 * `npm run typecheck` here rather than going unsampled. One sample carrying
 * every field of every member would do instead only while the leaves were
 * `z.object`s that dropped what they did not declare — `mtg-nhyv.69` made them
 * `z.strictObject`, so a `keyword` beside `statBonus`'s numbers is now a
 * clause the schema names and refuses.
 */
const AURA_MODIFICATION_SAMPLES: Record<ModelAuraModificationKind, unknown> = {
  statBonus: { kind: 'statBonus', power: 1, toughness: 1 },
  grantKeyword: { kind: 'grantKeyword', keyword: 'flying' },
  cantAttack: { kind: 'cantAttack' },
  cantBlock: { kind: 'cantBlock' },
  cantBeBlocked: { kind: 'cantBeBlocked' },
  grantLandwalk: { kind: 'grantLandwalk', landType: 'Forest' },
  gainControl: { kind: 'gainControl' },
};

describe('AURA_MODIFICATION_KINDS', () => {
  it('names every kind the Aura clause admits, and nothing else', () => {
    for (const kind of AURA_MODIFICATION_KINDS) {
      const parsed = AuraModificationSchema.safeParse(AURA_MODIFICATION_SAMPLES[kind]);
      expect(parsed.success, kind).toBe(true);
    }
    expect(new Set(AURA_MODIFICATION_KINDS).size).toBe(AURA_MODIFICATION_KINDS.length);
    expect([...AURA_MODIFICATION_KINDS].sort()).toStrictEqual([
      'cantAttack',
      'cantBeBlocked',
      'cantBlock',
      'gainControl',
      'grantKeyword',
      'grantLandwalk',
      'statBonus',
    ]);
  });

  it('refuses a kind the clause has no member for', () => {
    expect(AuraModificationSchema.safeParse({ kind: 'definePt', power: 2, toughness: 2 }).success).toBe(
      false,
    );
    expect(AURA_MODIFICATION_KINDS).not.toContain('definePt');
  });

  /**
   * The containment read in the direction that is allowed to be unequal. A card
   * may print `doesNotUntap`, the kernel's untap step reads it, and the
   * generator has no way to reach it: `ModelAuraModificationSchema` is the union
   * `@mtg/setgen` builds its answer schema out of, and it does not carry the
   * arm. That gap is deliberate rather than pending — the same shape
   * `putCounters` has on the effect side — and it is asserted here because the
   * only other thing keeping the two unions apart is that nobody has edited the
   * wrong one.
   */
  it('accepts an engine-only clause that the generator vocabulary does not offer', () => {
    expect(AuraModificationSchema.safeParse({ kind: 'doesNotUntap' }).success).toBe(true);
    expect(ModelAuraModificationSchema.safeParse({ kind: 'doesNotUntap' }).success).toBe(false);
    expect(AURA_MODIFICATION_KINDS).not.toContain('doesNotUntap');
  });
});

/** A walker whose abilities are whatever the caller hands it. */
function walker(abilities: readonly unknown[]): CardInput {
  return {
    kind: 'planeswalker',
    id: 'tst-loyal-witness',
    name: 'Loyal Witness',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 7 },
    manaCost: { generic: 3, G: 1 },
    colors: ['G'],
    supertypes: ['legendary'],
    subtypes: ['Witness'],
    startingLoyalty: 4,
    abilities,
  } as CardInput;
}

describe('loyaltyAbilityFromModel', () => {
  const plus = LoyaltyModelAbilitySchema.parse({
    loyaltyCost: 1,
    effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
  });
  const minus = LoyaltyModelAbilitySchema.parse({
    loyaltyCost: -3,
    effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }],
  });

  it('fills the cost the model never states, and the card the engine gets is legal', () => {
    const built = [plus, minus].map(loyaltyAbilityFromModel);
    expect(built[0]?.kind).toBe('activated');
    const card = parseCard(walker(built));
    expect(renderOracleText(card)).toBe(
      '[+1]: You gain 2 life.\n[−3]: Loyal Witness deals 3 damage to any target.',
    );
  });

  it('states no mana, tap or sacrifice, which is what a loyalty cost forbids', () => {
    const built = loyaltyAbilityFromModel(plus);
    expect(built.kind).toBe('activated');
    if (built.kind !== 'activated') throw new Error('expected an activated ability');
    expect(built.cost.tapSelf).toBe(false);
    expect(built.cost.sacrificeSelf).toBe(false);
    expect(built.cost.sacrificeOther).toBeUndefined();
    expect(built.loyaltyCost).toBe(1);
    // The same ability with a mana cost beside its loyalty cost is the card the
    // validator refuses, so the free cost above is the whole point of the
    // conversion rather than a default nobody reads.
    const paid = safeParseCard(
      walker([{ ...built, cost: { ...built.cost, mana: { generic: 1 } } }, loyaltyAbilityFromModel(minus)]),
    );
    expect(paid.ok).toBe(false);
    if (!paid.ok) expect(paid.violations.map((item) => item.code)).toContain('ABILITY_COST_INVALID');
  });

  it('offers no field the model could use to write a cost', () => {
    // The schema declares no `cost`, and since `mtg-nhyv.69` a key it does not
    // declare is a parse error naming the key rather than a key dropped on the
    // way through. A model that writes one is refused and retried; it never
    // becomes a walker whose printed face and whose paid cost disagree.
    const withCost = LoyaltyModelAbilitySchema.safeParse({
      loyaltyCost: 0,
      cost: { mana: { generic: 2 }, tapSelf: true },
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    });
    expect(withCost.success).toBe(false);
    expect(withCost.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('"cost"'),
    );
    expect(LoyaltyModelAbilitySchema.safeParse({ loyaltyCost: 1, effects: [] }).success).toBe(false);
  });
});
