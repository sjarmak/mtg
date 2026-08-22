/**
 * The target slot's characteristic filter, and the two target kinds that
 * arrived with it.
 *
 * `mtg-6y4g`. Thirty-seven M11/M13 identities are blocked on one thing: the
 * slot can say *which space* a target is drawn from and cannot say which object
 * in it. "Destroy target artifact", "destroy target nonblack creature", "exile
 * target black or red permanent" and "destroy target attacking or blocking
 * creature" are four cards this vocabulary could not print, and none of them
 * needs a new primitive — they need the filter the kernel has always written
 * this question with (`ObjectFilter`, `@mtg/kernel`'s `continuous.ts`).
 *
 * So `TargetFilterSchema` is a *subset* of that kernel type rather than a
 * second filter, field for field, and `@mtg/kernel`'s `target-filter.ts` is the
 * one place the translation happens. A second evaluator would be a second
 * chance to disagree about what "black creature" means, and the anthem in layer
 * 4 and the removal spell in the same game have to agree.
 *
 * `targetPermanent` and `targetPlayerOrPlaneswalker` are the two new kinds, and
 * they are new kinds rather than filters for opposite reasons. The first widens
 * a space nothing else names, so the filter has something to narrow. The second
 * *unions two spaces*, which a filter cannot do: a filter says which object in
 * one space, and a planeswalker is not a player.
 *
 * The freeze is the one every kind since the fifth has stated:
 * `MODEL_TARGET_KINDS` is still the first four, so the JSON Schema every fill
 * batch is shown is byte-identical and every recorded fixture still replays.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect, TargetKind } from '../src/index';
import {
  HAND_AUTHORED_TARGETS,
  MODEL_TARGET_KINDS,
  renderOracleText,
  TARGET_COMBAT_ROLES,
  TARGET_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';
import {
  cardTypeFilterFitsTargetKind,
  filterFitsTargetKind,
  targetFilterIsEmpty,
  targetFilterOf,
} from '../src/targets';

const PERMANENT: TargetKind = 'targetPermanent';
const PLAYER_OR_WALKER: TargetKind = 'targetPlayerOrPlaneswalker';

function instantInput(effects: readonly Effect[], name = 'Sundering Light'): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'xmp-filter-probe',
    name,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 1 },
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

function card(effects: readonly Effect[], name?: string): Card {
  return parseCard(instantInput(effects, name) as CardInput);
}

/** `parseCard` throws on a violation, so a refusal is asserted off the record. */
function unparsed(effects: readonly Effect[]): Card {
  return instantInput(effects) as unknown as Card;
}

function codes(effects: readonly Effect[]): readonly string[] {
  return validateCard(unparsed(effects)).map((found) => found.code);
}

describe('the characteristic filter on a target slot', () => {
  it('adds two kinds the engine knows and the generator may not choose', () => {
    expect(TARGET_KINDS).toContain(PERMANENT);
    expect(TARGET_KINDS).toContain(PLAYER_OR_WALKER);
    const chooseable: readonly TargetKind[] = MODEL_TARGET_KINDS;
    expect(chooseable).not.toContain(PERMANENT);
    expect(chooseable).not.toContain(PLAYER_OR_WALKER);
    expect([...MODEL_TARGET_KINDS]).toEqual(['anyTarget', 'targetCreature', 'targetPlayer', 'noTarget']);
  });

  it('states the combat roles a printed card names, and no list of them', () => {
    expect([...TARGET_COMBAT_ROLES]).toEqual(['attacking', 'blocking', 'attackingOrBlocking']);
  });

  /**
   * A filter narrows *within* one space, so a slot that draws from two of them
   * refuses one: `anyTarget` and `targetPlayerOrPlaneswalker` would enforce the
   * printed condition against half their own legal targets and say nothing
   * about the rest. A card type is narrower still — every object kind but
   * `targetPermanent` has already fixed its card types by being the kind it is.
   */
  it('fits the object-only kinds, and a card type only the widest of them', () => {
    expect(filterFitsTargetKind(PERMANENT)).toBe(true);
    expect(filterFitsTargetKind('targetCreature')).toBe(true);
    expect(filterFitsTargetKind('targetArtifactOrEnchantment')).toBe(true);
    expect(filterFitsTargetKind('anyTarget')).toBe(false);
    expect(filterFitsTargetKind(PLAYER_OR_WALKER)).toBe(false);
    expect(filterFitsTargetKind('targetPlayer')).toBe(false);
    expect(filterFitsTargetKind('noTarget')).toBe(false);
    expect(filterFitsTargetKind('triggeringCreature')).toBe(false);

    expect(cardTypeFilterFitsTargetKind(PERMANENT)).toBe(true);
    expect(cardTypeFilterFitsTargetKind('targetCreature')).toBe(false);
    expect(cardTypeFilterFitsTargetKind('targetArtifactOrEnchantment')).toBe(false);
  });

  it('reads back off a spec, and knows the spelling that states nothing', () => {
    expect(targetFilterOf({ kind: 'targetCreature' })).toBeNull();
    expect(targetFilterOf({ kind: 'targetCreature', filter: { colors: ['B'] } })).toEqual({ colors: ['B'] });
    expect(targetFilterIsEmpty({})).toBe(true);
    expect(targetFilterIsEmpty({ combat: 'attacking' })).toBe(false);
  });

  it('is hand-authored on every row that answers a permanent', () => {
    expect(HAND_AUTHORED_TARGETS['destroyPermanent']).toContain(PERMANENT);
    expect(HAND_AUTHORED_TARGETS['exileTarget']).toContain(PERMANENT);
    expect(HAND_AUTHORED_TARGETS['dealDamage']).toContain(PLAYER_OR_WALKER);
  });

  /** The printed cohort, in the current Oracle wording of each card. */
  it('prints the M11/M13 cards that asked for it', () => {
    const smelt = card([
      { kind: 'destroyPermanent', target: { kind: PERMANENT, filter: { cardTypes: ['artifact'] } } },
    ]);
    expect(validateCard(smelt)).toEqual([]);
    expect(renderOracleText(smelt)).toBe('Destroy target artifact.');

    const craterize = card([
      { kind: 'destroyPermanent', target: { kind: PERMANENT, filter: { cardTypes: ['land'] } } },
    ]);
    expect(renderOracleText(craterize)).toBe('Destroy target land.');

    const demolish = card([
      {
        kind: 'destroyPermanent',
        target: { kind: PERMANENT, filter: { cardTypes: ['artifact', 'land'] } },
      },
    ]);
    expect(renderOracleText(demolish)).toBe('Destroy target artifact or land.');

    const acidicSlime = card([
      {
        kind: 'destroyPermanent',
        target: { kind: PERMANENT, filter: { cardTypes: ['artifact', 'enchantment', 'land'] } },
      },
    ]);
    expect(renderOracleText(acidicSlime)).toBe('Destroy target artifact, enchantment, or land.');

    const bramblecrush = card([
      {
        kind: 'destroyPermanent',
        target: { kind: PERMANENT, filter: { excludeCardTypes: ['creature'] } },
      },
    ]);
    expect(renderOracleText(bramblecrush)).toBe('Destroy target noncreature permanent.');

    const celestialPurge = card([
      { kind: 'exileTarget', target: { kind: PERMANENT, filter: { colors: ['B', 'R'] } } },
    ]);
    expect(validateCard(celestialPurge)).toEqual([]);
    expect(renderOracleText(celestialPurge)).toBe('Exile target black or red permanent.');

    const doomBlade = card([
      { kind: 'destroyPermanent', target: { kind: 'targetCreature', filter: { excludeColors: ['B'] } } },
    ]);
    expect(renderOracleText(doomBlade)).toBe('Destroy target nonblack creature.');

    const deathmark = card([
      { kind: 'destroyPermanent', target: { kind: 'targetCreature', filter: { colors: ['G', 'W'] } } },
    ]);
    expect(renderOracleText(deathmark)).toBe('Destroy target green or white creature.');

    const divineVerdict = card([
      {
        kind: 'destroyPermanent',
        target: { kind: 'targetCreature', filter: { combat: 'attackingOrBlocking' } },
      },
    ]);
    expect(renderOracleText(divineVerdict)).toBe('Destroy target attacking or blocking creature.');

    const infantryVeteran = card([
      {
        kind: 'pumpUntilEndOfTurn',
        power: 1,
        toughness: 1,
        target: { kind: 'targetCreature', filter: { combat: 'attacking' } },
      },
    ]);
    expect(renderOracleText(infantryVeteran)).toBe('Target attacking creature gets +1/+1 until end of turn.');

    const smite = card([
      { kind: 'destroyPermanent', target: { kind: 'targetCreature', filter: { combat: 'blocking' } } },
    ]);
    expect(renderOracleText(smite)).toBe('Destroy target blocking creature.');

    const lavaAxe = card([{ kind: 'dealDamage', amount: 5, target: { kind: PLAYER_OR_WALKER } }], 'Lava Axe');
    expect(validateCard(lavaAxe)).toEqual([]);
    expect(renderOracleText(lavaAxe)).toBe('Lava Axe deals 5 damage to target player or planeswalker.');
  });

  /**
   * A filter and a restriction compose, and English puts them on either side of
   * the noun: the restriction's state adjective and the filter's adjectives sit
   * in front, its clause sits behind the whole phrase.
   */
  it('composes with a restriction on one slot', () => {
    const both = card([
      {
        kind: 'destroyPermanent',
        target: {
          kind: 'targetCreature',
          restriction: { kind: 'maxPower', power: 3 },
          filter: { combat: 'attacking' },
        },
      },
    ]);
    expect(validateCard(both)).toEqual([]);
    expect(renderOracleText(both)).toBe('Destroy target attacking creature with power 3 or less.');
  });

  it('refuses a filter on a slot that draws from a player as well', () => {
    expect(
      codes([{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget', filter: { colors: ['B'] } } }]),
    ).toContain('ILLEGAL_TARGET_FILTER');
    expect(
      codes([
        { kind: 'dealDamage', amount: 2, target: { kind: PLAYER_OR_WALKER, filter: { colors: ['B'] } } },
      ]),
    ).toContain('ILLEGAL_TARGET_FILTER');
  });

  it('refuses a card type on a slot whose kind already fixed it', () => {
    expect(
      codes([
        { kind: 'destroyPermanent', target: { kind: 'targetCreature', filter: { cardTypes: ['artifact'] } } },
      ]),
    ).toContain('ILLEGAL_TARGET_FILTER');
    expect(
      codes([
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetCreature', filter: { excludeCardTypes: ['artifact'] } },
        },
      ]),
    ).toContain('ILLEGAL_TARGET_FILTER');
  });

  /**
   * `targetArtifactOrEnchantment` predates the filter and 177 cards in Forge's
   * `res/cardsfolder` write its selector as one string, so it stays. What must
   * not stay is two encodings of one card: this is the filter spelling of
   * exactly that kind, and it is refused by name.
   */
  it('refuses the filter spelling of the kind that already prints it', () => {
    const found = validateCard(
      unparsed([
        {
          kind: 'destroyPermanent',
          target: { kind: PERMANENT, filter: { cardTypes: ['artifact', 'enchantment'] } },
        },
      ]),
    );
    expect(found.map((v) => v.code)).toContain('ILLEGAL_TARGET_FILTER');
    expect(found.map((v) => v.message).join(' ')).toContain('targetArtifactOrEnchantment');
  });

  it('refuses a filter that states nothing, and one that states a thing twice', () => {
    expect(codes([{ kind: 'destroyPermanent', target: { kind: PERMANENT, filter: {} } }])).toContain(
      'ILLEGAL_TARGET_FILTER',
    );
    expect(
      codes([
        {
          kind: 'destroyPermanent',
          target: { kind: PERMANENT, filter: { cardTypes: ['land', 'land'] } },
        },
      ]),
    ).toContain('ILLEGAL_TARGET_FILTER');
  });

  it('refuses a value listed as both wanted and excluded', () => {
    expect(
      codes([
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetCreature', filter: { colors: ['B'], excludeColors: ['B'] } },
        },
      ]),
    ).toContain('ILLEGAL_TARGET_FILTER');
    expect(
      codes([
        {
          kind: 'destroyPermanent',
          target: { kind: PERMANENT, filter: { cardTypes: ['land'], excludeCardTypes: ['land'] } },
        },
      ]),
    ).toContain('ILLEGAL_TARGET_FILTER');
  });

  /**
   * A battlefield slot names a permanent, so an instant or a sorcery in the
   * list is a card that can never be cast rather than a narrower one. The stack
   * side of the same rule lives in `counter-spell-filter.test.ts`.
   */
  it('refuses a card type that never reaches the battlefield', () => {
    expect(
      codes([{ kind: 'destroyPermanent', target: { kind: PERMANENT, filter: { cardTypes: ['instant'] } } }]),
    ).toContain('ILLEGAL_TARGET_FILTER');
  });
});
