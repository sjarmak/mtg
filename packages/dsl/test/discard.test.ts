/**
 * The hand primitives: what they accept, what they print, and the two doors
 * they are deliberately not behind.
 *
 * `discardCards` and `chooseDiscard` are both unpriced, so the generator cannot
 * reach either, and `ActivationCost.discard` is stripped out of the model's
 * cost for the same reason `sacrificeOther` is. That triple is the whole of the
 * containment claim for this lane and it is asserted three times below, once
 * per door, because each is a different schema and a widening of any one of
 * them would be silent in the other two.
 *
 * The two effect kinds are one vocabulary entry apart and print completely
 * different sentences, which is the other thing worth pinning. CR 701.8a is one
 * clause; CR 701.16a followed by a choice followed by CR 701.8a is three, and
 * Coercion prints all three.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput, Effect } from '../src/index';
import {
  CardEffectSchema,
  MAX_DISCARD_COUNT,
  ModelAbilitySchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
} from '../src/index';

function sorceryInput(effects: readonly Effect[], name = 'Mind Rot'): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-discard-spell',
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, B: 1 },
    colors: ['B'],
    effects: [...effects],
  } as unknown as CardInput;
}

function printed(effects: readonly Effect[], name?: string): string {
  return renderOracleText(parseCard(sorceryInput(effects, name)));
}

describe('the discard effects', () => {
  it('accepts exactly the bounded counts', () => {
    expect(MAX_DISCARD_COUNT).toBe(4);
    for (const kind of ['discardCards', 'chooseDiscard'] as const) {
      const target = { kind: 'targetOpponent' } as const;
      for (const count of [1, 2, 3, 4]) {
        expect(CardEffectSchema.parse({ kind, count, target })).toEqual({ kind, count, target });
      }
      for (const count of [0, 5, -1, 1.5]) {
        expect(CardEffectSchema.safeParse({ kind, count, target }).success, `${kind} ${String(count)}`).toBe(
          false,
        );
      }
    }
  });

  it('is unreachable from the generator schema', () => {
    const target = { kind: 'targetOpponent' } as const;
    expect(ModelEffectSchema.safeParse({ kind: 'discardCards', count: 2, target }).success).toBe(false);
    expect(ModelEffectSchema.safeParse({ kind: 'chooseDiscard', count: 1, target }).success).toBe(false);
  });

  it('refuses a reveal-and-choose aimed at anybody but an opponent', () => {
    // The narrow one. `revealHand` reaches a player and only an opponent, and
    // this is that row with a rider on it: "reveal your own hand and choose a
    // card you discard" is a clause no card in this vocabulary wants.
    const card = sorceryInput([{ kind: 'chooseDiscard', count: 1, target: { kind: 'targetPlayer' } }]);
    const result = safeParseCard(card);
    const violations = result.ok ? validateCard(parseCard(card)) : result.violations;
    expect(violations.map((found) => found.code)).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  it('allows a plain discard at either player, which is what a looting spell needs', () => {
    for (const kind of ['targetPlayer', 'targetOpponent'] as const) {
      const card = parseCard(sorceryInput([{ kind: 'discardCards', count: 2, target: { kind } }]));
      expect(validateCard(card)).toEqual([]);
    }
  });
});

describe('what a discard spell prints', () => {
  it('prints CR 701.8 in one clause, with the article for one', () => {
    expect(printed([{ kind: 'discardCards', count: 2, target: { kind: 'targetPlayer' } }])).toBe(
      'Target player discards two cards.',
    );
    expect(printed([{ kind: 'discardCards', count: 1, target: { kind: 'targetOpponent' } }])).toBe(
      'Target opponent discards a card.',
    );
  });

  it('prints the reveal, the choice and the discard as three sentences', () => {
    // Coercion's own template. The three are one effect and not three, because
    // anything printed between the reveal and the choice could change the hand
    // that was shown -- so the primitive that shows the cards is the primitive
    // that takes them.
    expect(
      printed([{ kind: 'chooseDiscard', count: 1, target: { kind: 'targetOpponent' } }], 'Coercion'),
    ).toBe('Target opponent reveals their hand. You choose a card from it. That player discards that card.');
    expect(
      printed([{ kind: 'chooseDiscard', count: 2, target: { kind: 'targetOpponent' } }], 'Coercion'),
    ).toBe(
      'Target opponent reveals their hand. You choose two cards from it. That player discards those cards.',
    );
  });
});

function lens(cost: unknown): CardInput {
  return {
    kind: 'artifact',
    id: 'tst-sifting-lens',
    name: 'Sifting Lens',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 2 },
    manaCost: { generic: 2 },
    abilities: [
      { kind: 'activated', cost, effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] },
    ],
  } as CardInput;
}

function costViolations(cost: unknown): readonly { code: string; path: string }[] {
  const result = safeParseCard(lens(cost));
  return result.ok ? [] : result.violations.map((found) => ({ code: found.code, path: found.path }));
}

describe('a discard paid as an activation cost', () => {
  it('accepts the discard as the whole cost, exactly as a sacrifice may be', () => {
    expect(costViolations({ mana: {}, discard: 1 })).toEqual([]);
    expect(costViolations({ mana: { generic: 1 }, discard: 2 })).toEqual([]);
  });

  it('refuses a count outside the two cards a player may be asked for', () => {
    // Narrower than `MAX_DISCARD_COUNT`, and the two numbers answer different
    // questions: an effect's ceiling is what a card may print at an opponent,
    // and this is what a player may be asked to pay out of their own hand at
    // instant speed, over and over, in a format where a hand is seven cards.
    expect(costViolations({ mana: {}, discard: 3 })).toEqual([
      { code: 'ABILITY_COST_INVALID', path: 'abilities[0].cost.discard' },
    ]);
    expect(costViolations({ mana: {}, discard: 0 })).toEqual([
      { code: 'ABILITY_COST_INVALID', path: 'abilities[0].cost.discard' },
    ]);
  });

  it('prints after the mana and beside every other named clause', () => {
    const text = (cost: unknown): string => renderOracleText(parseCard(lens(cost)));
    expect(text({ mana: {}, discard: 1 })).toBe('Discard a card: Draw a card.');
    expect(text({ mana: { generic: 1 }, discard: 2 })).toBe('{1}, Discard two cards: Draw a card.');
    expect(text({ mana: { generic: 1 }, tapSelf: true, discard: 1 })).toBe(
      '{1}, {T}, Discard a card: Draw a card.',
    );
    expect(text({ mana: {}, sacrificeSelf: true, discard: 1 })).toBe(
      'Sacrifice Sifting Lens, Discard a card: Draw a card.',
    );
  });

  it('is unreachable from the set generator', () => {
    const ability: AbilityInput = {
      kind: 'activated',
      cost: { mana: { generic: 1 }, discard: 1 },
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    };
    // The model's cost declares no such field, so a model that answered with
    // one is refused by name and sent back rather than honored as a cheaper
    // ability than the one it printed (`mtg-nhyv.69`): `sacrificeOther`'s
    // sentence, one field over.
    const parsed = ModelAbilitySchema.safeParse(ability);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('discard'),
    );
  });
});
