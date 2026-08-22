/**
 * The cost that names what it eats: what it accepts, what it refuses, and who
 * is allowed to write it.
 *
 * `sacrificeSelf` needed no rules beyond the ones a cost already had, because
 * the permanent it spends is the one printing the ability. `sacrificeOther`
 * spends permanents chosen off the board, so it carries a count and a subtype,
 * and both are checkable here rather than on the board: a count outside the
 * range no chest tier reaches, and a subtype that is not a subtype at all.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput } from '../src';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard } from '../src';

function chest(cost: unknown): CardInput {
  return {
    kind: 'artifact',
    id: 'tst-chest',
    name: 'Small Chest',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2 },
    abilities: [
      { kind: 'activated', cost, effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }] },
    ],
  } as CardInput;
}

function violations(cost: unknown): readonly { code: string; path: string }[] {
  const result = safeParseCard(chest(cost));
  return result.ok ? [] : result.violations.map((found) => ({ code: found.code, path: found.path }));
}

describe('an activation cost that sacrifices permanents it names', () => {
  it('accepts a cost that is only the sacrifice, exactly as it accepts Fuse', () => {
    expect(violations({ mana: {}, sacrificeOther: { count: 2, subtype: 'Key' } })).toEqual([]);
  });

  it('refuses a count no chest tier reaches', () => {
    expect(violations({ mana: {}, sacrificeOther: { count: 5, subtype: 'Key' } })).toEqual([
      { code: 'ABILITY_COST_INVALID', path: 'abilities[0].cost.sacrificeOther.count' },
    ]);
    expect(violations({ mana: {}, sacrificeOther: { count: 0, subtype: 'Key' } })).toEqual([
      { code: 'ABILITY_COST_INVALID', path: 'abilities[0].cost.sacrificeOther.count' },
    ]);
  });

  it('refuses a subtype that is not a capitalized word', () => {
    expect(violations({ mana: {}, sacrificeOther: { count: 1, subtype: 'key' } })).toEqual([
      { code: 'INVALID_SUBTYPE', path: 'abilities[0].cost.sacrificeOther.subtype' },
    ]);
  });

  it('reports the named clause beside the mana rule rather than instead of it', () => {
    // A negative pip short-circuits the mana-value checks (`checkActivationCost`
    // returns early so it cannot report a bogus mana value on top of a broken
    // one), and the clause's own violation must survive that early return.
    expect(violations({ mana: { generic: -1 }, sacrificeOther: { count: 9, subtype: 'Key' } })).toEqual([
      { code: 'ABILITY_COST_INVALID', path: 'abilities[0].cost.sacrificeOther.count' },
      { code: 'ABILITY_COST_INVALID', path: 'abilities[0].cost.mana.generic' },
    ]);
  });

  it('is unreachable from the set generator', () => {
    const ability: AbilityInput = {
      kind: 'activated',
      cost: { mana: { generic: 1 }, sacrificeOther: { count: 2, subtype: 'Key' } },
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    };
    // The model's cost has no such field, so an answer carrying one is sent back
    // naming it rather than quietly honored as the cheaper ability that is left
    // once the key is gone: the generator's output space stays inside what
    // `@mtg/setgen`'s prompt describes, and says so when it is asked to leave.
    const parsed = ModelAbilitySchema.safeParse(ability);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('sacrificeOther'),
    );

    // The same ability without the clause parses, so the refusal is about the
    // field and not about the shape around it.
    expect(ModelAbilitySchema.safeParse({ ...ability, cost: { mana: { generic: 1 } } }).success).toBe(true);
  });
});

/** The chest above, parsed, with whatever cost the case is about. */
function printed(cost: unknown): string {
  return renderOracleText(parseCard(chest(cost)));
}

describe('what a chest prints', () => {
  it('names the permanents the cost eats, after the mana', () => {
    // Magic prints the mana symbols first and every other cost after them, in
    // comma-separated order, so this is the same rule `{T}` and `Sacrifice
    // CARDNAME` already follow.
    expect(printed({ mana: { generic: 1 }, sacrificeOther: { count: 2, subtype: 'Key' } })).toBe(
      '{1}, Sacrifice two Keys: You gain 2 life.',
    );
  });

  it('prints one of them with an article rather than a numeral', () => {
    expect(printed({ mana: { generic: 1 }, sacrificeOther: { count: 1, subtype: 'Key' } })).toBe(
      '{1}, Sacrifice a Key: You gain 2 life.',
    );
  });

  it('prints the clause alone when the sacrifice is the whole cost', () => {
    // The `{0}` fallback is for a cost that prints nothing at all. A cost that
    // is only Keys prints the Keys, and a chest whose ability read "{0}: You
    // gain 2 life." would be a card lying about its price.
    expect(printed({ mana: {}, sacrificeOther: { count: 3, subtype: 'Key' } })).toBe(
      'Sacrifice three Keys: You gain 2 life.',
    );
  });

  it('prints the source and the named permanents as two clauses', () => {
    expect(printed({ mana: {}, sacrificeSelf: true, sacrificeOther: { count: 1, subtype: 'Key' } })).toBe(
      'Sacrifice Small Chest, Sacrifice a Key: You gain 2 life.',
    );
  });
});
