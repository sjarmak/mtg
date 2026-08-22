/**
 * The equip clause: what a named weapon may say, and what it may not.
 *
 * Decision 12 of the set design document is "attachment is for the
 * named weapons only, roughly eight cards. No twenty-Equipment support
 * structure, no durability mechanic." So the DSL grows one field on the
 * activated ability rather than a fourth ability kind, and every rule below is
 * a coded violation carrying a path a repair loop can act on.
 *
 * CR 702.6b is the whole of the printed shape: "Equip [cost]" means "[cost]:
 * Attach this permanent to target creature you control. Activate only as a
 * sorcery." The target restriction and the timing restriction both belong to
 * the keyword rather than to this card, which is why neither is a new member of
 * `TARGET_KINDS` or a new field on every activated ability. The member
 * `targetCreatureYouControl` is not that member: it is a mode an effect names,
 * and an equip ability prints no effect.
 */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText, validateCard } from '@mtg/dsl';
import type { CardInput, Violation, ViolationCode } from '@mtg/dsl';

const SET = { code: 'XMP', collectorNumber: 1 };

function weapon(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'artifact',
    id: 'xmp-moonblade',
    name: 'Moonblade',
    rarity: 'rare',
    set: SET,
    manaCost: { generic: 2 },
    subtypes: ['Equipment'],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 2 } },
        attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
        effects: [],
      },
    ],
    ...overrides,
  };
}

function codes(violations: readonly Violation[]): ViolationCode[] {
  return violations.map((v) => v.code);
}

function expectViolation(input: unknown, code: ViolationCode): Violation {
  const violations = validateCard(input);
  const match = violations.find((v) => v.code === code);
  expect(match, `expected ${code}, got ${JSON.stringify(codes(violations))}`).toBeDefined();
  if (match === undefined) throw new Error('unreachable');
  return match;
}

describe('an equip clause', () => {
  it('parses on an Equipment artifact and carries the modification', () => {
    expect(validateCard(weapon())).toEqual([]);
    const card = parseCard(weapon() as CardInput);
    const ability = card.abilities[0];
    if (ability?.kind !== 'activated') throw new Error('the equip ability did not parse as activated');
    expect(ability.attach).toStrictEqual({
      modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }],
    });
    // The clause replaces the effect list rather than joining it: an equip
    // ability does one thing, and CR 702.6b says which.
    expect(ability.effects).toStrictEqual([]);
  });

  it("prints Magic's two lines from one ability", () => {
    expect(renderOracleText(parseCard(weapon() as CardInput))).toBe(
      'Equipped creature gets +2/+0.\nEquip {2}',
    );
  });

  it('prints the keyword form with has rather than gets', () => {
    const bow = weapon({
      id: 'xmp-savage-direhorn-bow',
      name: 'Savage Direhorn Bow',
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          attach: { modifications: [{ kind: 'grantKeyword', keyword: 'firstStrike' }] },
          effects: [],
        },
      ],
    });
    expect(renderOracleText(parseCard(bow as CardInput))).toBe(
      'Equipped creature has first strike.\nEquip {1}',
    );
  });

  it('refuses an activated ability that neither attaches nor does anything', () => {
    const empty = weapon({
      abilities: [{ kind: 'activated', cost: { mana: { generic: 2 } }, effects: [] }],
    });
    expectViolation(empty, 'ABILITY_WITHOUT_EFFECT');
  });

  it('refuses an equip clause that also prints an effect', () => {
    const both = weapon({
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 2 } },
          attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    expectViolation(both, 'EQUIP_ABILITY_INVALID');
  });

  it('refuses an equip clause on a card that is not an Equipment', () => {
    expectViolation(weapon({ subtypes: ['Sword'] }), 'EQUIP_ABILITY_INVALID');
  });

  /**
   * CR 301.5e: an Equipment that is also a creature cannot equip a creature. A
   * creature card printing the clause is that state with no way out of it, so
   * the refusal is at the card, and the kernel holds the animated case
   * (`packages/kernel/test/equip.test.ts`).
   */
  it('refuses an equip clause on a creature card', () => {
    const living = weapon({
      kind: 'creature',
      id: 'xmp-living-blade',
      name: 'Living Blade',
      power: 2,
      toughness: 2,
    });
    expectViolation(living, 'EQUIP_ABILITY_INVALID');
  });

  /**
   * The source is in its owner's graveyard the moment a `sacrificeSelf` cost is
   * paid (CR 601.2h), so an equip ability priced that way attaches a permanent
   * that is no longer on the battlefield. The tap symbol and a named sacrifice
   * are refused with it for a smaller reason: `Equip {1}, {T}` is not a line
   * Magic prints, and no weapon in this set wants one.
   */
  it('refuses an equip cost that is not mana', () => {
    for (const cost of [
      { mana: { generic: 2 }, sacrificeSelf: true },
      { mana: { generic: 2 }, tapSelf: true },
      { mana: { generic: 2 }, sacrificeOther: { count: 1, subtype: 'Key' } },
    ]) {
      const priced = weapon({
        abilities: [
          {
            kind: 'activated',
            cost,
            attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
            effects: [],
          },
        ],
      });
      expectViolation(priced, 'EQUIP_ABILITY_INVALID');
    }
  });

  /** The repeatability rule reaches an equip cost like any other activation. */
  it('refuses a free equip', () => {
    const free = weapon({
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 0 } },
          attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
          effects: [],
        },
      ],
    });
    expectViolation(free, 'ABILITY_COST_INVALID');
  });

  /**
   * Last-Blow Obliterator, the card the list exists for: the playtester's design is
   * `+99/-3` and deathtouch, which is one clause about one weapon and was
   * unspellable while the field was singular.
   *
   * The printed sentence says the subject once and joins the two verbs with
   * "and", which is how Magic templates "gets +1/+1 and has flying". It is
   * derived here rather than typed, because the set fixture the lab opens
   * derives it too.
   */
  it('prints a stat bonus and a granted keyword as one sentence', () => {
    const obliterator = weapon({
      id: 'xmp-last-blow-obliterator',
      name: 'Last-Blow Obliterator',
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          attach: {
            modifications: [
              { kind: 'statBonus', power: 99, toughness: -3 },
              { kind: 'grantKeyword', keyword: 'deathtouch' },
            ],
          },
          effects: [],
        },
      ],
    });
    expect(validateCard(obliterator)).toEqual([]);
    expect(renderOracleText(parseCard(obliterator as CardInput))).toBe(
      'Equipped creature gets +99/-3 and has deathtouch.\nEquip {1}',
    );
  });

  /**
   * Order is printed order and nothing else. Listing the keyword first is a
   * different card *face* and the same card in play, which is the half
   * `packages/kernel/test/equip.test.ts` proves: CR 613's layers decide what
   * happens, the array decides what is read.
   */
  it('prints the modifications in the order the card lists them', () => {
    const reversed = weapon({
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          attach: {
            modifications: [
              { kind: 'grantKeyword', keyword: 'deathtouch' },
              { kind: 'statBonus', power: 99, toughness: -3 },
            ],
          },
          effects: [],
        },
      ],
    });
    expect(renderOracleText(parseCard(reversed as CardInput))).toBe(
      'Equipped creature has deathtouch and gets +99/-3.\nEquip {1}',
    );
  });

  /** Two keywords share the verb, the way Magic prints "has flying and vigilance". */
  it('shares one verb between two granted keywords', () => {
    const pair = weapon({
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          attach: {
            modifications: [
              { kind: 'grantKeyword', keyword: 'flying' },
              { kind: 'grantKeyword', keyword: 'vigilance' },
            ],
          },
          effects: [],
        },
      ],
    });
    expect(renderOracleText(parseCard(pair as CardInput))).toBe(
      'Equipped creature has flying and vigilance.\nEquip {1}',
    );
  });

  /**
   * The encoding rule, from both ends: there is no absent field and no empty
   * list, so an equip clause has exactly one spelling and `canonicalJson`
   * cannot see two shapes where the card has one. A third modification is
   * refused for the reason a third effect is.
   */
  it('refuses an empty modification list and a third modification', () => {
    const empty = weapon({
      abilities: [
        { kind: 'activated', cost: { mana: { generic: 1 } }, attach: { modifications: [] }, effects: [] },
      ],
    });
    expectViolation(empty, 'SCHEMA_INVALID');
    const three = weapon({
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          attach: {
            modifications: [
              { kind: 'statBonus', power: 2, toughness: 0 },
              { kind: 'grantKeyword', keyword: 'deathtouch' },
              { kind: 'grantKeyword', keyword: 'trample' },
            ],
          },
          effects: [],
        },
      ],
    });
    expectViolation(three, 'SCHEMA_INVALID');
  });

  /**
   * `DUPLICATE_MODIFICATION` is `DUPLICATE_EFFECT` one record in: the kernel
   * applies both, so the card plays as one modification of double the size
   * while printing the line twice.
   *
   * Identity is coarser than the record for a stat bonus, because two of them
   * are one layer-7c record whatever numbers they carry, and exact for a
   * keyword, because two different keywords are the whole point of the list.
   */
  it('refuses a clause that says the same thing twice', () => {
    for (const modifications of [
      [
        { kind: 'statBonus', power: 2, toughness: 0 },
        { kind: 'statBonus', power: 1, toughness: 1 },
      ],
      [
        { kind: 'grantKeyword', keyword: 'deathtouch' },
        { kind: 'grantKeyword', keyword: 'deathtouch' },
      ],
    ]) {
      const repeated = weapon({
        abilities: [
          {
            kind: 'activated',
            cost: { mana: { generic: 1 } },
            attach: { modifications },
            effects: [],
          },
        ],
      });
      const found = expectViolation(repeated, 'DUPLICATE_MODIFICATION');
      expect(found.path).toBe('abilities[0].attach.modifications[1]');
    }
  });

  /** Two different keywords are two grants, and the clause the list exists for. */
  it('accepts two different granted keywords', () => {
    const pair = weapon({
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          attach: {
            modifications: [
              { kind: 'grantKeyword', keyword: 'deathtouch' },
              { kind: 'grantKeyword', keyword: 'trample' },
            ],
          },
          effects: [],
        },
      ],
    });
    expect(validateCard(pair)).toEqual([]);
  });

  /** The same range check a static's bonus gets; a +0/+0 weapon is a no-op. */
  it('refuses a modification that changes nothing', () => {
    const blunt = weapon({
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 2 } },
          attach: { modifications: [{ kind: 'statBonus', power: 0, toughness: 0 }] },
          effects: [],
        },
      ],
    });
    const found = expectViolation(blunt, 'STATIC_MODIFICATION_OUT_OF_RANGE');
    expect(found.path).toBe('abilities[0].attach.modifications[0]');
  });
});
