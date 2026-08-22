import { describe, expect, it } from 'vitest';
import {
  CardValidationError,
  exaltedAbility,
  MAX_TARGET_COUNT,
  parseCard,
  safeParseCard,
  validateCard,
  validateCards,
} from '@mtg/dsl';
import type { Violation, ViolationCode } from '@mtg/dsl';

const SET = { code: 'SLC', collectorNumber: 1 };

function legalInstant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'slc-test-bolt',
    name: 'Test Bolt',
    rarity: 'common',
    set: SET,
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }],
    ...overrides,
  };
}

function legalCreature(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'slc-test-bear',
    name: 'Test Bear',
    rarity: 'common',
    set: SET,
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    subtypes: ['Bear'],
    keywords: ['trample'],
    power: 2,
    toughness: 2,
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
  expect(match.message.length).toBeGreaterThan(10);
  return match;
}

describe('legal baselines', () => {
  it('accepts the fixtures used to build the illegal cases', () => {
    expect(validateCard(legalInstant())).toEqual([]);
    expect(validateCard(legalCreature())).toEqual([]);
  });
});

describe('schema-shape violations', () => {
  it('off-vocabulary effect kind', () => {
    // A real Magic mechanic the DSL has no word for, the way the keyword case
    // below uses `doubleStrike`. It used to be `exileGraveyard`, which the
    // vocabulary has since grown — the wrong kind of stale, because a kind that
    // exists but is missing a field reports `SCHEMA_INVALID` and the assertion
    // stops describing what it is named for.
    const v = expectViolation(legalInstant({ effects: [{ kind: 'proliferate' }] }), 'UNKNOWN_EFFECT_KIND');
    expect(v.path).toBe('effects[0].kind');
  });

  it('off-vocabulary keyword', () => {
    const v = expectViolation(legalCreature({ keywords: ['doubleStrike'] }), 'UNKNOWN_KEYWORD');
    expect(v.path).toBe('keywords[0]');
  });

  it('off-vocabulary target kind', () => {
    const v = expectViolation(
      legalInstant({ effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetLand' } }] }),
      'UNKNOWN_TARGET_KIND',
    );
    expect(v.path).toBe('effects[0].target.kind');
  });

  it('unknown card kind', () => {
    expectViolation(legalInstant({ kind: 'battle' }), 'UNKNOWN_CARD_KIND');
  });

  it('unknown rarity', () => {
    expectViolation(legalInstant({ rarity: 'special' }), 'UNKNOWN_RARITY');
  });

  it('malformed mana cost (non-integer pip)', () => {
    const v = expectViolation(legalInstant({ manaCost: { generic: 1, R: 1.5 } }), 'MALFORMED_MANA_COST');
    expect(v.path).toBe('manaCost.R');
  });

  it('malformed card id', () => {
    expectViolation(legalInstant({ id: 'Test Bolt!' }), 'SCHEMA_INVALID');
  });
});

describe('mana cost and color identity', () => {
  it('negative pip', () => {
    const v = expectViolation(legalInstant({ manaCost: { generic: 1, R: -1 } }), 'MANA_COST_NEGATIVE');
    expect(v.path).toBe('manaCost.R');
  });

  // A free spell is legal DSL. The floor that used to live here said "DSL v0 has
  // no free spells", which is a statement about what the generator prints, and
  // it now lives in the generator: no slot may state a cost window below 1, and
  // `checkSlotConformance` fails a card outside its slot's window. The kernel's
  // half of the claim is `kernel/test/free-spell.test.ts`.
  it('accepts a total cost of zero', () => {
    expect(validateCard(legalInstant({ manaCost: {}, colors: [] }))).toStrictEqual([]);
  });

  it('cost above the slice ceiling', () => {
    expectViolation(legalInstant({ manaCost: { generic: 20, R: 1 } }), 'MANA_COST_OUT_OF_RANGE');
  });

  it('declared colors disagree with the cost', () => {
    const v = expectViolation(legalInstant({ colors: ['U'] }), 'COLOR_IDENTITY_MISMATCH');
    expect(v.message).toContain('[R]');
  });

  it('colored noncreature artifact', () => {
    expectViolation(
      {
        kind: 'artifact',
        id: 'slc-gilded-idol',
        name: 'Gilded Idol',
        rarity: 'common',
        set: SET,
        manaCost: { generic: 1, W: 1 },
        colors: ['W'],
      },
      'ARTIFACT_NOT_COLORLESS',
    );
  });

  it('token color outside the card color identity', () => {
    expectViolation(
      legalInstant({
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: { name: 'Bear', power: 2, toughness: 2, colors: ['G'], subtypes: ['Bear'] },
          },
        ],
      }),
      'TOKEN_COLOR_OFF_IDENTITY',
    );
  });
});

describe('type-line legality', () => {
  it('creature stats on an instant', () => {
    const violations = validateCard(legalInstant({ power: 2, toughness: 2 }));
    expect(codes(violations)).toEqual(['CREATURE_STATS_ON_NONCREATURE', 'CREATURE_STATS_ON_NONCREATURE']);
    expect(violations[0]?.path).toBe('power');
    expect(violations[0]?.message).toContain('instant');
  });

  it('creature stats out of range', () => {
    expectViolation(legalCreature({ toughness: 0 }), 'CREATURE_STATS_OUT_OF_RANGE');
    expectViolation(legalCreature({ power: 99 }), 'CREATURE_STATS_OUT_OF_RANGE');
  });

  it('keywords on a sorcery', () => {
    const v = expectViolation(
      {
        kind: 'sorcery',
        id: 'slc-flying-lesson',
        name: 'Flying Lesson',
        rarity: 'common',
        set: SET,
        manaCost: { generic: 1, U: 1 },
        colors: ['U'],
        keywords: ['flying'],
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      },
      'KEYWORD_ILLEGAL_ON_CARD_TYPE',
    );
    expect(v.message).toContain('flying');
  });

  it('duplicate keyword', () => {
    expectViolation(legalCreature({ keywords: ['flying', 'flying'] }), 'DUPLICATE_KEYWORD');
  });

  it('lowercase subtype', () => {
    expectViolation(legalCreature({ subtypes: ['bear'] }), 'INVALID_SUBTYPE');
  });

  it('subtype on an instant', () => {
    expectViolation(legalInstant({ subtypes: ['Arcane'] }), 'SUBTYPE_ILLEGAL_ON_CARD_TYPE');
  });

  it('legendary instant', () => {
    expectViolation(legalInstant({ supertypes: ['legendary'] }), 'SUPERTYPE_ILLEGAL_ON_CARD_TYPE');
  });

  it('basic land type present without the Basic supertype', () => {
    expectViolation(
      {
        kind: 'land',
        id: 'slc-wastes',
        name: 'Mountain',
        rarity: 'common',
        set: SET,
        basicLandType: 'Mountain',
        producesMana: ['R'],
      },
      'LAND_BASIC_TYPE_MISMATCH',
    );
  });

  it('land producing the wrong color', () => {
    expectViolation(
      {
        kind: 'land',
        id: 'slc-broken-isle',
        name: 'Island',
        rarity: 'common',
        set: SET,
        supertypes: ['basic'],
        basicLandType: 'Island',
        producesMana: ['G'],
      },
      'LAND_MANA_MISMATCH',
    );
  });
});

describe('effect legality', () => {
  it('negative damage', () => {
    const v = expectViolation(
      legalInstant({ effects: [{ kind: 'dealDamage', amount: -2, target: { kind: 'anyTarget' } }] }),
      'EFFECT_PARAM_OUT_OF_RANGE',
    );
    expect(v.path).toBe('effects[0].amount');
    expect(v.message).toContain('damage must be between 1');
  });

  it('zero-count draw', () => {
    expectViolation(
      legalInstant({ effects: [{ kind: 'drawCards', count: 0, target: { kind: 'noTarget' } }] }),
      'EFFECT_PARAM_OUT_OF_RANGE',
    );
  });

  it('no-op pump', () => {
    expectViolation(
      legalInstant({
        effects: [{ kind: 'pumpUntilEndOfTurn', power: 0, toughness: 0, target: { kind: 'targetCreature' } }],
      }),
      'EFFECT_PARAM_OUT_OF_RANGE',
    );
  });

  /**
   * A player slot is legal on this row now, and what makes it a card is the
   * `scope` beside it: "destroy all creatures target player controls" targets
   * the player and sweeps the group (CR 115.1). Without the scope the sentence
   * has no object, so the refusal moved from the target table to the scope
   * check rather than going away.
   */
  it('destroy aimed at a player with no group beside it', () => {
    const v = expectViolation(
      legalInstant({ effects: [{ kind: 'destroyPermanent', target: { kind: 'targetPlayer' } }] }),
      'ILLEGAL_EFFECT_SCOPE',
    );
    expect(v.path).toBe('effects[0].target.kind');
    expect(v.message).toContain('reaches the permanent it targets');
  });

  it('destroy aimed at a slot the table refuses outright', () => {
    const v = expectViolation(
      legalInstant({ effects: [{ kind: 'destroyPermanent', target: { kind: 'anyTarget' } }] }),
      'ILLEGAL_TARGET_FOR_EFFECT',
    );
    expect(v.path).toBe('effects[0].target.kind');
    expect(v.message).toContain('legal targets are targetCreature');
  });

  /**
   * Refused by the scope rule rather than by the target table, which is where
   * this case moved when the board sweep landed: `noTarget` is on this row now,
   * because Pyroclasm chooses nothing and reads a region of the board instead.
   * What is still illegal is damage that chooses nothing *and* names no region,
   * which resolves into no game action at all.
   */
  it('damage that chooses nothing with no region beside it', () => {
    const v = expectViolation(
      legalInstant({ effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'noTarget' } }] }),
      'ILLEGAL_EFFECT_SCOPE',
    );
    expect(v.path).toBe('effects[0].target.kind');
    expect(v.message).toContain('chooses nothing');
  });

  it('draw aimed at a creature', () => {
    expectViolation(
      legalInstant({ effects: [{ kind: 'drawCards', count: 1, target: { kind: 'targetCreature' } }] }),
      'ILLEGAL_TARGET_FOR_EFFECT',
    );
  });

  it('spell with no effects', () => {
    expectViolation(legalInstant({ effects: [] }), 'SPELL_WITHOUT_EFFECT');
  });

  it('distinct on the first effect, which has nothing to differ from', () => {
    const v = expectViolation(
      legalInstant({
        effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature', distinct: true } }],
      }),
      'ILLEGAL_DISTINCT_TARGET',
    );
    expect(v.path).toBe('effects[0].target.distinct');
  });

  it('distinct on a spec that chooses no target', () => {
    const v = expectViolation(
      legalInstant({
        effects: [
          { kind: 'drawCards', count: 1, target: { kind: 'targetPlayer' } },
          { kind: 'gainLife', amount: 2, target: { kind: 'noTarget', distinct: true } },
        ],
      }),
      'ILLEGAL_DISTINCT_TARGET',
    );
    expect(v.path).toBe('effects[1].target.distinct');
  });

  it('distinct where no earlier slot could have taken the same target', () => {
    // "Target player draws a card. Destroy another target creature." — a player
    // and a creature are never the same object, so "another" prints a
    // constraint that can never bite, which is text disagreeing with behavior.
    expectViolation(
      legalInstant({
        effects: [
          { kind: 'drawCards', count: 1, target: { kind: 'targetPlayer' } },
          { kind: 'destroyPermanent', target: { kind: 'targetCreature', distinct: true } },
        ],
      }),
      'ILLEGAL_DISTINCT_TARGET',
    );
  });

  it('accepts distinct where an earlier slot draws from an overlapping space', () => {
    expect(
      validateCard(
        legalInstant({
          effects: [
            { kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } },
            { kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature', distinct: true } },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('effect on a creature card', () => {
    expectViolation(
      legalCreature({ effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }] }),
      'EFFECT_ILLEGAL_ON_CARD_TYPE',
    );
  });

  it('token stats out of range', () => {
    expectViolation(
      legalInstant({
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: { name: 'Bear', power: 2, toughness: 0, colors: ['R'], subtypes: ['Bear'] },
          },
        ],
      }),
      'EFFECT_PARAM_OUT_OF_RANGE',
    );
  });

  it('lowercase token subtype', () => {
    expectViolation(
      legalInstant({
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: { name: 'Bear', power: 2, toughness: 2, colors: ['R'], subtypes: ['bear'] },
          },
        ],
      }),
      'INVALID_TOKEN_SUBTYPE',
    );
  });
});

describe('TargetSpec.count (mtg-kg44)', () => {
  it('accepts count on a tapPermanent slot naming targetCreature', () => {
    expect(
      validateCard(
        legalInstant({
          effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature', count: 2 } }],
        }),
      ),
    ).toEqual([]);
  });

  it('rejects count on a target kind other than targetCreature', () => {
    // `targetOpponent` is legal on `tapPermanent` (it is the scoped sweep's
    // player handle), so this exercises `checkTargetCount`'s own kind check
    // rather than the earlier "is this kind legal on this effect at all" gate
    // a kind `tapPermanent` refuses outright, like `anyTarget`, never reaches.
    const v = expectViolation(
      legalInstant({
        effects: [
          {
            kind: 'tapPermanent',
            scope: 'creaturesThatPlayerControls',
            target: { kind: 'targetOpponent', count: 2 },
          },
        ],
      }),
      'ILLEGAL_TARGET_COUNT',
    );
    expect(v.path).toBe('effects[0].target.count');
  });

  it('rejects count on an effect kind other than tapPermanent', () => {
    const v = expectViolation(
      legalInstant({
        effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature', count: 2 } }],
      }),
      'ILLEGAL_TARGET_COUNT',
    );
    expect(v.path).toBe('effects[0].target.count');
  });

  it('rejects count and distinct together on the same slot', () => {
    // The two fields both answer "how many objects does this slot pick", and a
    // slot cannot answer that twice — `checkTargetCount`'s docblock in
    // `@mtg/dsl` argues the same point `targets.ts`'s own docblock does.
    const v = expectViolation(
      legalInstant({
        effects: [
          { kind: 'tapPermanent', target: { kind: 'targetCreature' } },
          { kind: 'tapPermanent', target: { kind: 'targetCreature', count: 2, distinct: true } },
        ],
      }),
      'ILLEGAL_TARGET_COUNT',
    );
    expect(v.path).toBe('effects[1].target.count');
  });

  it('accepts three, the count M13 prints on Downpour (mtg-hgmz)', () => {
    expect(
      validateCard(
        legalInstant({
          effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature', count: 3 } }],
        }),
      ),
    ).toEqual([]);
  });

  it('rejects a count below two: a counted slot is the plural template', () => {
    expect(() =>
      parseCard(
        legalInstant({
          effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature', count: 1 } }],
        }),
      ),
    ).toThrow(CardValidationError);
  });

  it('rejects a count above the largest N printed Magic prints on this template', () => {
    expect(MAX_TARGET_COUNT).toBe(5);
    expect(() =>
      parseCard(
        legalInstant({
          effects: [
            { kind: 'tapPermanent', target: { kind: 'targetCreature', count: MAX_TARGET_COUNT + 1 } },
          ],
        }),
      ),
    ).toThrow(CardValidationError);
  });

  it('rejects a fractional count', () => {
    expect(() =>
      parseCard(
        legalInstant({
          effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature', count: 2.5 } }],
        }),
      ),
    ).toThrow(CardValidationError);
  });
});

describe('duplicate effects', () => {
  const bolt = { kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } };

  it('the same effect printed twice', () => {
    const v = expectViolation(legalInstant({ effects: [bolt, bolt] }), 'DUPLICATE_EFFECT');
    expect(v.path).toBe('effects[1]');
    expect(v.message).toContain('effects[0]');
  });

  it('reports the later copy, so the path names the entry to delete', () => {
    const destroy = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };
    const violations = validateCard(legalInstant({ effects: [bolt, destroy, bolt] }));
    const duplicates = violations.filter((v) => v.code === 'DUPLICATE_EFFECT');
    expect(duplicates.map((v) => v.path)).toEqual(['effects[2]']);
  });

  it('compares by value, so key order cannot hide a duplicate', () => {
    expectViolation(
      legalInstant({
        effects: [
          { kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } },
          { target: { kind: 'anyTarget' }, amount: 3, kind: 'dealDamage' },
        ],
      }),
      'DUPLICATE_EFFECT',
    );
  });

  it('catches parameterless effects, which are the ones the generator repeats', () => {
    const tap = { kind: 'tapPermanent', target: { kind: 'targetCreature' } };
    expectViolation(legalInstant({ effects: [tap, tap] }), 'DUPLICATE_EFFECT');
    expectViolation(
      legalInstant({ effects: [{ kind: 'counterSpell' }, { kind: 'counterSpell' }] }),
      'DUPLICATE_EFFECT',
    );
  });

  it('leaves a repeat that a distinct second target makes into two effects alone', () => {
    // The point of `distinct`: the two entries stop being byte-identical, and
    // the kernel stops resolving them against one creature. This is the shape
    // the five Tideglass Reach designs were reaching for.
    const destroy = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };
    const another = { kind: 'destroyPermanent', target: { kind: 'targetCreature', distinct: true } };
    expect(validateCard(legalInstant({ effects: [destroy, another] }))).toEqual([]);
  });

  it('rejects distinct: false, the second spelling of an absent flag', () => {
    // `distinct: false` is the same card as no `distinct` at all, and two
    // encodings of one card is a way around this very check: the repeat below
    // is not byte-identical, so `canonicalJson` would call the entries two
    // effects while the renderer prints "Destroy target creature." twice and
    // the kernel aims both at one body. The flag accepts only `true`.
    const destroy = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };
    const notDistinct = {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', distinct: false },
    };
    const v = expectViolation(legalInstant({ effects: [destroy, notDistinct] }), 'ILLEGAL_DISTINCT_TARGET');
    expect(v.path).toBe('effects[1].target.distinct');
    expect(() => parseCard(legalInstant({ effects: [destroy, notDistinct] }))).toThrow(CardValidationError);
  });

  it('rejects distinct: false even where the card is otherwise fine', () => {
    // Not only on a repeat: the encoding never reaches a parsed card, so
    // nothing downstream of `parseCard` has to know the spelling exists.
    expectViolation(
      legalInstant({
        effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature', distinct: false } }],
      }),
      'ILLEGAL_DISTINCT_TARGET',
    );
  });

  it('leaves effects that differ in any parameter alone', () => {
    expect(
      validateCard(
        legalInstant({
          effects: [bolt, { kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
        }),
      ),
    ).toEqual([]);
    expect(
      validateCard(
        legalInstant({
          effects: [bolt, { kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }],
        }),
      ),
    ).toEqual([]);
  });
});

describe('ability legality', () => {
  const lord = {
    kind: 'static',
    scope: 'otherCreaturesYouControl',
    subtype: 'Bear',
    modification: { kind: 'statBonus', power: 1, toughness: 1 },
  };
  const anthem = {
    kind: 'static',
    scope: 'creaturesYouControl',
    subtype: null,
    modification: { kind: 'grantKeyword', keyword: 'vigilance' },
  };

  it('accepts a lord on a creature and an anthem on an artifact', () => {
    expect(validateCard(legalCreature({ abilities: [lord] }))).toEqual([]);
    expect(
      validateCard({
        kind: 'artifact',
        id: 'slc-test-banner',
        name: 'Test Banner',
        rarity: 'common',
        set: SET,
        manaCost: { generic: 3 },
        abilities: [anthem],
      }),
    ).toEqual([]);
  });

  it('rejects an ability on a card type that does not stay on the battlefield', () => {
    const v = expectViolation(legalInstant({ abilities: [anthem] }), 'ABILITY_ILLEGAL_ON_CARD_TYPE');
    expect(v.path).toBe('abilities');
    expect(v.message).toContain('instant');
  });

  it('accepts a group static ability on a land permanent', () => {
    expect(
      validateCard({
        kind: 'land',
        id: 'slc-test-forest',
        name: 'Forest',
        rarity: 'common',
        set: SET,
        supertypes: ['basic'],
        basicLandType: 'Forest',
        producesMana: ['G'],
        abilities: [anthem],
      }),
    ).toEqual([]);
  });

  it('rejects a self-scoped static on a noncreature, the way keywords are rejected', () => {
    const v = expectViolation(
      {
        kind: 'artifact',
        id: 'slc-test-idol',
        name: 'Test Idol',
        rarity: 'common',
        set: SET,
        manaCost: { generic: 3 },
        abilities: [
          {
            kind: 'static',
            scope: 'self',
            subtype: null,
            modification: { kind: 'statBonus', power: 1, toughness: 1 },
          },
        ],
      },
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
    );
    expect(v.path).toBe('abilities[0].scope');
  });

  it('rejects a subtype on a scope that is one permanent', () => {
    const v = expectViolation(
      legalCreature({
        abilities: [
          {
            kind: 'static',
            scope: 'self',
            subtype: 'Bear',
            modification: { kind: 'statBonus', power: 1, toughness: 1 },
          },
        ],
      }),
      'STATIC_SUBTYPE_ILLEGAL_ON_SCOPE',
    );
    expect(v.path).toBe('abilities[0].subtype');
  });

  it('rejects a malformed subtype the way the type line does', () => {
    const v = expectViolation(
      legalCreature({ abilities: [{ ...lord, subtype: 'bear' }] }),
      'INVALID_SUBTYPE',
    );
    expect(v.path).toBe('abilities[0].subtype');
  });

  /**
   * A printed modification and a pump spell no longer share a ceiling: One-Hit
   * Obliterator prints +99/-3, so `statBonusDelta` moved and `pumpDelta` did
   * not (`validate/effects.ts`). What is checked here is that the wider bound
   * is still a bound, and that a lord and a weapon are held to the same one.
   */
  it('rejects a stat bonus outside the range a printed modification may name', () => {
    const v = expectViolation(
      legalCreature({
        abilities: [{ ...lord, modification: { kind: 'statBonus', power: 100, toughness: 1 } }],
      }),
      'STATIC_MODIFICATION_OUT_OF_RANGE',
    );
    expect(v.path).toBe('abilities[0].modification.power');
    expect(v.message).toContain('between -99 and 99');
  });

  it('still holds a pump spell to the narrower range the split left it', () => {
    const v = expectViolation(
      legalInstant({
        effects: [{ kind: 'pumpUntilEndOfTurn', power: 9, toughness: 0, target: { kind: 'targetCreature' } }],
      }),
      'EFFECT_PARAM_OUT_OF_RANGE',
    );
    expect(v.path).toBe('effects[0].power');
    expect(v.message).toContain('between -8 and 8');
  });

  it('rejects a +0/+0 static, which is a no-op the way a +0/+0 pump is', () => {
    const v = expectViolation(
      legalCreature({
        abilities: [{ ...lord, modification: { kind: 'statBonus', power: 0, toughness: 0 } }],
      }),
      'STATIC_MODIFICATION_OUT_OF_RANGE',
    );
    expect(v.path).toBe('abilities[0].modification');
  });

  describe('CR 613.4a: a characteristic-defining P/T', () => {
    it("accepts a definePt on a self-scoped static, Tarmogoyf's own shape", () => {
      expect(
        validateCard(
          legalCreature({
            power: 0,
            toughness: 1,
            abilities: [
              {
                kind: 'static',
                scope: 'self',
                subtype: null,
                modification: {
                  kind: 'definePt',
                  countOf: 'graveyardCardTypesEach',
                  powerOffset: 0,
                  toughnessOffset: 1,
                },
              },
            ],
          }),
        ),
      ).toEqual([]);
    });

    it('rejects a definePt on any scope wider than self, which modifies other permanents', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [
            {
              kind: 'static',
              scope: 'otherCreaturesYouControl',
              subtype: null,
              modification: {
                kind: 'definePt',
                countOf: 'graveyardCardTypesEach',
                powerOffset: 0,
                toughnessOffset: 1,
              },
            },
          ],
        }),
        'DEFINE_PT_ILLEGAL_ON_SCOPE',
      );
      expect(v.path).toBe('abilities[0].scope');
    });
  });

  describe('CR 611.2c: a static conditional on `enabledWhile`', () => {
    const threshold = { kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 3 };

    it('accepts a lord whose bonus applies only as long as the condition holds', () => {
      expect(validateCard(legalCreature({ abilities: [{ ...lord, enabledWhile: threshold }] }))).toEqual([]);
    });

    it('parses an ability with no `enabledWhile` exactly as before the field existed', () => {
      const card = parseCard(legalCreature({ abilities: [lord] }));
      const [ability] = card.abilities;
      expect(ability?.kind).toBe('static');
      // Optional rather than defaulted (`abilities.ts` explains why), so a card
      // printed before this field existed carries no key at all, not an
      // explicit `null` — and every consumer treats the two the same.
      expect(ability !== undefined && 'enabledWhile' in ability).toBe(false);
    });

    it('rejects a malformed subtype inside the condition, the same way the type line is checked', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [{ ...lord, enabledWhile: { ...threshold, subtype: 'merfolk' } }],
        }),
        'INVALID_SUBTYPE',
      );
      expect(v.path).toBe('abilities[0].enabledWhile.subtype');
    });

    it('rejects a threshold outside the range a printed condition may name', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [{ ...lord, enabledWhile: { ...threshold, atLeast: 21 } }],
        }),
        'CONDITION_THRESHOLD_OUT_OF_RANGE',
      );
      expect(v.path).toBe('abilities[0].enabledWhile.atLeast');
      expect(v.message).toContain('between 1 and 20');
    });

    it('accepts a lord conditioned on a board-wide counter, with nothing further to range-check', () => {
      expect(
        validateCard(
          legalCreature({
            abilities: [{ ...lord, enabledWhile: { kind: 'anyCreatureHasCounter', counter: 'gloom' } }],
          }),
        ),
      ).toEqual([]);
    });
  });

  it('rejects the same ability printed twice', () => {
    const v = expectViolation(legalCreature({ abilities: [lord, { ...lord }] }), 'DUPLICATE_ABILITY');
    expect(v.path).toBe('abilities[1]');
    expect(v.message).toContain('abilities[0]');
  });

  it('accepts two abilities that differ, up to the New World Order budget of two', () => {
    expect(validateCard(legalCreature({ abilities: [lord, anthem] }))).toEqual([]);
    expect(codes(validateCard(legalCreature({ abilities: [lord, anthem, anthem] }))).length).toBeGreaterThan(
      0,
    );
  });

  describe('triggered abilities', () => {
    const gainTwo = { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } };
    const trigger = { kind: 'triggered', condition: 'selfEnters', effects: [gainTwo] };

    it('accepts an untargeted trigger on a creature, and a static beside it', () => {
      expect(validateCard(legalCreature({ abilities: [trigger] }))).toEqual([]);
      expect(validateCard(legalCreature({ abilities: [lord, trigger] }))).toEqual([]);
    });

    it('accepts only the canonical exalted trigger envelope', () => {
      expect(validateCard(legalCreature({ abilities: [exaltedAbility()] }))).toEqual([]);

      const altered = exaltedAbility();
      const violation = expectViolation(
        legalCreature({
          abilities: [
            {
              ...altered,
              effects: [{ ...altered.effects[0], power: 2 }],
            },
          ],
        }),
        'ILLEGAL_TARGET_IN_ABILITY',
      );
      expect(violation.path).toBe('abilities[0].effects[0].target.kind');
      expect(violation.message).toContain('exact exalted');
    });

    it('accepts an effect that chooses a target when the ability goes on the stack', () => {
      // CR 603.3d. The kernel stops for the choice
      // (`packages/kernel/src/trigger-choice.ts`), so the card is legal and the
      // rule that is left is the per-effect table below.
      expect(
        validateCard(
          legalCreature({
            abilities: [
              {
                kind: 'triggered',
                condition: 'selfAttacks',
                effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
              },
            ],
          }),
        ),
      ).toEqual([]);
    });

    it('holds a trigger to the same per-effect targeting table a spell obeys', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [
            {
              kind: 'triggered',
              condition: 'selfEnters',
              effects: [{ kind: 'destroyPermanent', target: { kind: 'anyTarget' } }],
            },
          ],
        }),
        'ILLEGAL_TARGET_IN_ABILITY',
      );
      expect(v.path).toBe('abilities[0].effects[0].target.kind');
      expect(v.message).toContain('targetCreature');
    });

    /**
     * The scope rule reaches inside an ability too, and it has to be checked
     * separately: `checkAbilityEffectTarget` reads `legalTargetsFor`, which says
     * only that a player slot is legal on the `destroyPermanent` row. What makes
     * the player slot a sentence is the `scope` beside it, and a trigger with no
     * scope resolves into no game action exactly as a sorcery with none does.
     */
    it('holds a trigger to the scope rule a spell obeys', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [
            {
              kind: 'triggered',
              condition: 'selfEnters',
              effects: [{ kind: 'destroyPermanent', target: { kind: 'targetPlayer' } }],
            },
          ],
        }),
        'ILLEGAL_EFFECT_SCOPE',
      );
      expect(v.path).toBe('abilities[0].effects[0].target.kind');
      expect(v.message).toContain('reaches the permanent it targets');
    });

    it('accepts the scoped sweeper the same trigger can print', () => {
      expect(
        validateCard(
          legalCreature({
            abilities: [
              {
                kind: 'triggered',
                condition: 'selfEnters',
                effects: [
                  {
                    kind: 'tapPermanent',
                    scope: 'creaturesThatPlayerControls',
                    target: { kind: 'targetOpponent' },
                  },
                ],
              },
            ],
          }),
        ),
      ).toEqual([]);
    });

    it('accepts counterSpell, which names a spell on the stack rather than a target spec', () => {
      expect(
        validateCard(
          legalCreature({
            abilities: [{ kind: 'triggered', condition: 'selfDies', effects: [{ kind: 'counterSpell' }] }],
          }),
        ),
      ).toEqual([]);
    });

    it('accepts an optional trigger with one effect', () => {
      expect(
        validateCard(
          legalCreature({
            abilities: [
              {
                kind: 'triggered',
                condition: 'selfDies',
                optional: true,
                effects: [
                  {
                    kind: 'putCounters',
                    counter: 'plusOnePlusOne',
                    count: 1,
                    target: { kind: 'targetCreature' },
                  },
                ],
              },
            ],
          }),
        ),
      ).toEqual([]);
    });

    it('rejects an optional trigger that prints two effects', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [
            {
              kind: 'triggered',
              condition: 'selfDies',
              optional: true,
              effects: [gainTwo, { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
            },
          ],
        }),
        'OPTIONAL_TRIGGER_INVALID',
      );
      expect(v.path).toBe('abilities[0].effects');
      expect(v.message).toContain('answered once');
    });

    it('refuses "optional: false", which is a second spelling of leaving it out', () => {
      const codesFound = codes(
        validateCard(
          legalCreature({
            abilities: [{ kind: 'triggered', condition: 'selfDies', optional: false, effects: [gainTwo] }],
          }),
        ),
      );
      expect(codesFound.length).toBeGreaterThan(0);
    });

    it('checks an ability effect against the same ranges a spell effect gets', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [
            {
              kind: 'triggered',
              condition: 'selfEnters',
              effects: [{ kind: 'gainLife', amount: 99, target: { kind: 'noTarget' } }],
            },
          ],
        }),
        'EFFECT_PARAM_OUT_OF_RANGE',
      );
      expect(v.path).toBe('abilities[0].effects[0].amount');
    });

    it('rejects the same effect twice inside one trigger', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [{ kind: 'triggered', condition: 'selfEnters', effects: [gainTwo, { ...gainTwo }] }],
        }),
        'DUPLICATE_EFFECT',
      );
      expect(v.path).toBe('abilities[0].effects[1]');
    });

    it('rejects a trigger on a card type that does not stay on the battlefield', () => {
      expectViolation(legalInstant({ abilities: [trigger] }), 'ABILITY_ILLEGAL_ON_CARD_TYPE');
    });
  });

  describe('activated abilities', () => {
    const ping = { kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } };
    const cost = { mana: { generic: 1, R: 1 }, tapSelf: true };
    const activated = { kind: 'activated', cost, effects: [ping] };

    it('accepts a targeted activated ability, which a trigger may not carry', () => {
      expect(validateCard(legalCreature({ abilities: [activated] }))).toEqual([]);
      expect(validateCard(legalCreature({ abilities: [lord, activated] }))).toEqual([]);
    });

    it('rejects an ability that costs nothing and does not tap', () => {
      const v = expectViolation(
        legalCreature({ abilities: [{ kind: 'activated', cost: { mana: {} }, effects: [ping] }] }),
        'ABILITY_COST_INVALID',
      );
      expect(v.path).toBe('abilities[0].cost');
      expect(v.message).toContain('again the moment it resolves');
    });

    it('accepts a free ability whose cost is the tap symbol', () => {
      expect(
        validateCard(
          legalCreature({
            abilities: [
              {
                kind: 'activated',
                cost: { mana: {}, tapSelf: true },
                effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
              },
            ],
          }),
        ),
      ).toEqual([]);
    });

    it('rejects a negative pip in the cost, naming the color', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [{ kind: 'activated', cost: { mana: { G: -1 }, tapSelf: true }, effects: [ping] }],
        }),
        'ABILITY_COST_INVALID',
      );
      expect(v.path).toBe('abilities[0].cost.mana.G');
    });

    it('rejects a negative generic in the cost, the way it rejects a negative pip', () => {
      // The sibling arm above was red under this treatment and this one was
      // not: `ManaCostSchema` is six integers and integers go negative, so both
      // halves of that sentence need a fixture.
      const v = expectViolation(
        legalCreature({
          abilities: [{ kind: 'activated', cost: { mana: { generic: -2 }, tapSelf: true }, effects: [ping] }],
        }),
        'ABILITY_COST_INVALID',
      );
      expect(v.path).toBe('abilities[0].cost.mana.generic');
      expect(v.message).toContain('-2');
    });

    it('rejects a cost above the ceiling a printed card cost obeys', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [{ kind: 'activated', cost: { mana: { generic: 17 } }, effects: [ping] }],
        }),
        'ABILITY_COST_INVALID',
      );
      expect(v.path).toBe('abilities[0].cost.mana');
      expect(v.message).toContain('17');
    });

    it('holds an ability effect to the same targeting table a spell effect obeys', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [
            {
              kind: 'activated',
              cost,
              effects: [{ kind: 'destroyPermanent', target: { kind: 'anyTarget' } }],
            },
          ],
        }),
        'ILLEGAL_TARGET_IN_ABILITY',
      );
      expect(v.path).toBe('abilities[0].effects[0].target.kind');
      expect(v.message).toContain('targetCreature');
    });

    it('holds an ability effect to the scope rule a spell effect obeys', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [
            {
              kind: 'activated',
              cost,
              effects: [{ kind: 'destroyPermanent', target: { kind: 'targetPlayer' } }],
            },
          ],
        }),
        'ILLEGAL_EFFECT_SCOPE',
      );
      expect(v.path).toBe('abilities[0].effects[0].target.kind');
      expect(v.message).toContain('reaches the permanent it targets');
    });

    it('rejects the exalted event referent outside its exact trigger', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [
            {
              kind: 'activated',
              cost,
              effects: [
                {
                  kind: 'pumpUntilEndOfTurn',
                  power: 1,
                  toughness: 1,
                  target: { kind: 'triggeringCreature' },
                },
              ],
            },
          ],
        }),
        'ILLEGAL_TARGET_IN_ABILITY',
      );
      expect(v.path).toBe('abilities[0].effects[0].target.kind');
      expect(v.message).toContain('exact exalted');
    });

    it('accepts counterSpell, which an activated ability can aim and a trigger cannot', () => {
      expect(
        validateCard(
          legalCreature({
            abilities: [{ kind: 'activated', cost, effects: [{ kind: 'counterSpell' }] }],
          }),
        ),
      ).toEqual([]);
    });

    it('checks an ability effect against the same ranges a spell effect gets', () => {
      const v = expectViolation(
        legalCreature({
          abilities: [
            { kind: 'activated', cost, effects: [{ kind: 'dealDamage', amount: 99, target: ping.target }] },
          ],
        }),
        'EFFECT_PARAM_OUT_OF_RANGE',
      );
      expect(v.path).toBe('abilities[0].effects[0].amount');
    });

    it('rejects the same effect twice inside one activation', () => {
      const v = expectViolation(
        legalCreature({ abilities: [{ kind: 'activated', cost, effects: [ping, { ...ping }] }] }),
        'DUPLICATE_EFFECT',
      );
      expect(v.path).toBe('abilities[0].effects[1]');
    });

    it('rejects an activated ability on a card type that does not stay on the battlefield', () => {
      expectViolation(legalInstant({ abilities: [activated] }), 'ABILITY_ILLEGAL_ON_CARD_TYPE');
    });
  });
});

/**
 * A violation message is read by a person and by a repair loop, and both of
 * them read "a artifact cannot carry a spell's effect list". Two of the five
 * card kinds open with a vowel, so every message that interpolates `card.kind`
 * behind a bare "a" prints ungrammatical English for two fifths of its inputs.
 *
 * All five sites are asserted rather than one, because the article is written
 * at the call site and the next message to quote a card kind gets written the
 * same way unless the whole family is pinned.
 */
describe('the article in front of a card kind', () => {
  const anthem = {
    kind: 'static',
    scope: 'creaturesYouControl',
    subtype: null,
    modification: { kind: 'grantKeyword', keyword: 'vigilance' },
  };

  function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      kind: 'artifact',
      id: 'slc-test-banner',
      name: 'Test Banner',
      rarity: 'common',
      set: SET,
      manaCost: { generic: 3 },
      ...overrides,
    };
  }

  it('takes "an" where an ability sits on an instant', () => {
    const v = expectViolation(legalInstant({ abilities: [anthem] }), 'ABILITY_ILLEGAL_ON_CARD_TYPE');
    expect(v.message).toContain('an instant cannot carry one');
  });

  it('takes "an" where a self static sits on an artifact', () => {
    const selfStatic = {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    };
    const v = expectViolation(artifact({ abilities: [selfStatic] }), 'ABILITY_ILLEGAL_ON_CARD_TYPE');
    expect(v.message).toContain('an artifact cannot carry one');
  });

  it('takes "an" where a spell effect list sits on an artifact', () => {
    const v = expectViolation(
      artifact({ effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] }),
      'EFFECT_ILLEGAL_ON_CARD_TYPE',
    );
    expect(v.message).toContain("an artifact cannot carry a spell's effect list");
  });

  it('takes "an" where an instant has no effect', () => {
    const v = expectViolation(legalInstant({ effects: [] }), 'SPELL_WITHOUT_EFFECT');
    expect(v.message).toContain('an instant must have');
  });

  it('takes "an" where a keyword sits on an artifact', () => {
    const v = expectViolation(artifact({ keywords: ['flying'] }), 'KEYWORD_ILLEGAL_ON_CARD_TYPE');
    expect(v.message).toContain('an artifact cannot carry flying');
  });

  it('keeps "a" in front of the three consonant kinds', () => {
    const onCreature = expectViolation(
      legalCreature({ effects: [{ kind: 'counterSpell' }] }),
      'EFFECT_ILLEGAL_ON_CARD_TYPE',
    );
    expect(onCreature.message).toContain('a creature cannot carry');
    const emptySorcery = expectViolation(
      legalInstant({ kind: 'sorcery', effects: [] }),
      'SPELL_WITHOUT_EFFECT',
    );
    expect(emptySorcery.message).toContain('a sorcery must have');
  });
});

describe('derived text', () => {
  it('authored oracle text that disagrees with the renderer', () => {
    const v = expectViolation(
      legalInstant({ oracleText: 'Test Bolt deals 4 damage to any target.' }),
      'ORACLE_TEXT_MISMATCH',
    );
    expect(v.message).toContain('deals 3 damage to any target.');
  });
});

describe('set-level checks', () => {
  it('prefixes per-card paths with the card index', () => {
    const violations = validateCards([legalInstant(), legalInstant({ colors: ['U'] })]);
    expect(codes(violations)).toEqual(['COLOR_IDENTITY_MISMATCH']);
    expect(violations[0]?.path).toBe('cards[1].colors');
  });
});

describe('error surface', () => {
  it('validators return violations instead of throwing', () => {
    expect(() => validateCard(null)).not.toThrow();
    expect(() => validateCard({ kind: 'creature' })).not.toThrow();
    expect(codes(validateCard(null)).length).toBeGreaterThan(0);
  });

  it('safeParseCard reports failure without throwing', () => {
    const result = safeParseCard(legalInstant({ colors: ['U'] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.violations)).toEqual(['COLOR_IDENTITY_MISMATCH']);
  });

  it('parseCard throws CardValidationError carrying the violations', () => {
    try {
      parseCard(legalInstant({ colors: ['U'] }));
      expect.unreachable('parseCard should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CardValidationError);
      if (!(error instanceof CardValidationError)) return;
      expect(codes(error.violations)).toEqual(['COLOR_IDENTITY_MISMATCH']);
      expect(error.message).toContain('COLOR_IDENTITY_MISMATCH at colors');
    }
  });
});
