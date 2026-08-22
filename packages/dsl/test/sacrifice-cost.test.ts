/**
 * Sacrifice as an activation cost, at the DSL layer (`mtg-bc2.132.11`).
 *
 * Slice C settled the shape of an activation cost: mana plus an optional tap
 * symbol, with every other printed cost named as its own bead. This is the
 * first of those to land, and it is the one the flagship set's Fuse needs —
 * `Fuse {cost}: Sacrifice this. Put a <part> counter on target creature you
 * control.` (the set design document §Fuse). The counter half is a
 * separate bead; what is proved here is that the cost half parses, prints and
 * validates.
 *
 * The scope is `sacrificeSelf` and nothing wider. Sacrificing another permanent
 * needs the action to carry which permanent, an enumeration over the choices,
 * and a legality rule about the chosen one; none of that falls out of a boolean
 * and none of it is what a part token does.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { ActivationCostSchema, parseCard, renderAbility, renderOracleText, validateCard } from '@mtg/dsl';

/**
 * `{1}, Sacrifice CARDNAME: CARDNAME deals 2 damage to any target.`
 *
 * A sac-for-value artifact, which is Fuse's exact shape with a payload the DSL
 * already has: pay a cost that includes giving up the permanent, then one
 * effect that lands elsewhere. The counter payload is its own bead.
 */
function bombBag(): CardInput {
  return {
    kind: 'artifact',
    id: 'xmp-bomb-bag',
    name: 'Bomb Bag',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 11 },
    manaCost: { generic: 2 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 1 }, sacrificeSelf: true },
        effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
      },
    ],
  };
}

/** `Sacrifice CARDNAME: You gain 2 life.` A cost of nothing but the permanent. */
function keepsakeChime(): CardInput {
  return {
    kind: 'artifact',
    id: 'xmp-keepsake-chime',
    name: 'Keepsake Chime',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 12 },
    manaCost: { generic: 1 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {}, sacrificeSelf: true },
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
    ],
  };
}

describe('the activation cost schema', () => {
  it('defaults sacrificeSelf to false, the way it defaults tapSelf', () => {
    expect(ActivationCostSchema.parse({ mana: { generic: 1 } })).toEqual({
      mana: { generic: 1, W: 0, U: 0, B: 0, R: 0, G: 0, hasX: false },
      tapSelf: false,
      sacrificeSelf: false,
    });
  });

  it('carries a sacrifice beside the mana and the tap symbol', () => {
    const cost = ActivationCostSchema.parse({ mana: {}, tapSelf: true, sacrificeSelf: true });
    expect(cost.tapSelf).toBe(true);
    expect(cost.sacrificeSelf).toBe(true);
  });
});

describe('printed text', () => {
  it('prints the sacrifice last in the cost clause, before the colon', () => {
    const card = parseCard(bombBag());
    expect(renderOracleText(card)).toBe('{1}, Sacrifice Bomb Bag: Bomb Bag deals 2 damage to any target.');
  });

  it('prints mana, then the tap symbol, then the sacrifice', () => {
    const card = parseCard({
      ...bombBag(),
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1, R: 1 }, tapSelf: true, sacrificeSelf: true },
          effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
        },
      ],
    });
    const line = renderOracleText(card);
    expect(line.slice(0, line.indexOf(':'))).toBe('{1}{R}, {T}, Sacrifice Bomb Bag');
  });

  /**
   * A sacrifice-only cost prints the sacrifice and never `{0}`.
   *
   * `activationCostText` falls back to `formatManaCost` when it has nothing
   * else to print, and that fallback is the shape of a card `checkAbilities`
   * refuses. A cost that is only a sacrifice must not reach it.
   */
  it('prints a sacrifice-only cost without a mana symbol', () => {
    const card = parseCard(keepsakeChime());
    expect(renderOracleText(card)).toBe('Sacrifice Keepsake Chime: You gain 2 life.');
    expect(renderOracleText(card)).not.toContain('{0}');
  });

  /** Forge reads the same renderer with `CARDNAME` in the name slot. */
  it('fills the name slot the caller gives it', () => {
    const card = parseCard(bombBag());
    const ability = card.abilities[0];
    expect(ability).toBeDefined();
    if (ability === undefined) return;
    expect(renderAbility(ability, 'CARDNAME')).toBe(
      '{1}, Sacrifice CARDNAME: CARDNAME deals 2 damage to any target.',
    );
  });
});

describe('validation', () => {
  it('accepts a sacrifice cost with mana', () => {
    expect(validateCard(bombBag())).toEqual([]);
  });

  /**
   * The rule `checkActivationCost` actually holds is "not free and repeatable",
   * and a sacrifice is what makes a free ability non-repeatable: paying it puts
   * the source in the graveyard, so the kernel cannot enumerate it a second
   * time. Reading the rule as "mana or a tap symbol" refuses `Sacrifice this:`,
   * which is a card Magic prints and the flagship set's Fuse is built on.
   */
  it('accepts a cost that is nothing but the sacrifice', () => {
    expect(validateCard(keepsakeChime())).toEqual([]);
  });

  it('still refuses a cost that is free and repeatable', () => {
    const free: CardInput = {
      ...keepsakeChime(),
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, tapSelf: false, sacrificeSelf: false },
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    };
    const found = validateCard(free);
    expect(found.map((issue) => issue.code)).toEqual(['ABILITY_COST_INVALID']);
    expect(found[0]?.message).toContain('sacrifice');
  });
});
