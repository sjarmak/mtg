/** Exact M13 authoring for live and declaration-level combat restrictions. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, validateCard } from '@mtg/dsl';

const WAR_FALCON_ABILITY = {
  kind: 'static' as const,
  scope: 'self' as const,
  subtype: null,
  enabledWhile: {
    kind: 'controlsNoneOfSubtypes' as const,
    subtypes: ['Knight', 'Soldier'],
  },
  modification: { kind: 'cantAttack' as const },
};

const SLUMBERING_RESTRICTION = {
  kind: 'static' as const,
  scope: 'self' as const,
  subtype: null,
  enabledWhile: {
    kind: 'selfCounterCountBelow' as const,
    counter: 'plusOnePlusOne' as const,
    fewerThan: 5,
  },
  modification: { kind: 'cantAttackOrBlock' as const },
};

const SLUMBERING_TRIGGER = {
  kind: 'triggered' as const,
  condition: 'creatureAttacksYouOrPlaneswalkerYouControl' as const,
  effects: [
    {
      kind: 'putCounters' as const,
      counter: 'plusOnePlusOne' as const,
      count: 1,
      target: { kind: 'selfCreature' as const },
    },
  ],
};

const MOGG_RESTRICTION = {
  kind: 'static' as const,
  scope: 'self' as const,
  subtype: null,
  modification: { kind: 'cantAttackOrBlockAlone' as const },
};

function restrictionCard(enabledWhile: unknown): unknown {
  return {
    kind: 'creature',
    id: 'tst-hostile-restriction',
    name: 'Hostile Restriction',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['W'],
    manaCost: { W: 1 },
    power: 1,
    toughness: 1,
    subtypes: ['Bird'],
    keywords: [],
    abilities: [
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        enabledWhile,
        modification: { kind: 'cantAttack' },
      },
    ],
  };
}

describe('M13 conditional combat authoring', () => {
  it('renders War Falcon from a controller-scoped any-subtype count', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'tst-war-falcon',
      name: 'War Falcon',
      rarity: 'common',
      set: { code: 'M13', collectorNumber: 38 },
      colors: ['W'],
      manaCost: { W: 1 },
      power: 2,
      toughness: 1,
      subtypes: ['Bird'],
      keywords: ['flying'],
      abilities: [WAR_FALCON_ABILITY],
    });

    expect(renderOracleText(card)).toBe(
      "Flying\nWar Falcon can't attack unless you control a Knight or a Soldier.",
    );
  });

  it('renders Slumbering Dragon as one combined restriction and one attack trigger', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'tst-slumbering-dragon',
      name: 'Slumbering Dragon',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 148 },
      colors: ['R'],
      manaCost: { R: 1 },
      power: 3,
      toughness: 3,
      subtypes: ['Dragon'],
      keywords: ['flying'],
      abilities: [SLUMBERING_RESTRICTION, SLUMBERING_TRIGGER],
    });

    expect(renderOracleText(card)).toBe(
      "Flying\nSlumbering Dragon can't attack or block unless it has five or more +1/+1 counters on it.\nWhenever a creature attacks you or a planeswalker you control, put a +1/+1 counter on Slumbering Dragon.",
    );
  });

  it('renders Mogg Flunkies as one declaration-level restriction', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'tst-mogg-flunkies',
      name: 'Mogg Flunkies',
      rarity: 'common',
      set: { code: 'M13', collectorNumber: 143 },
      colors: ['R'],
      manaCost: { generic: 1, R: 1 },
      power: 3,
      toughness: 3,
      subtypes: ['Goblin'],
      abilities: [MOGG_RESTRICTION],
    });

    expect(renderOracleText(card)).toBe("Mogg Flunkies can't attack or block alone.");
  });

  it('keeps every new restriction and trigger outside generator output', () => {
    for (const ability of [
      WAR_FALCON_ABILITY,
      SLUMBERING_RESTRICTION,
      SLUMBERING_TRIGGER,
      MOGG_RESTRICTION,
    ]) {
      expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
    }
  });

  it('rejects empty, duplicate, malformed, and oversized condition inputs', () => {
    expect(
      validateCard(restrictionCard({ kind: 'controlsNoneOfSubtypes', subtypes: [] })).map(
        (violation) => violation.code,
      ),
    ).toContain('SCHEMA_INVALID');
    expect(
      validateCard(restrictionCard({ kind: 'controlsNoneOfSubtypes', subtypes: ['Knight', 'Knight'] })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_SUBTYPE',
          path: 'abilities[0].enabledWhile.subtypes[1]',
        }),
      ]),
    );
    expect(validateCard(restrictionCard({ kind: 'controlsNoneOfSubtypes', subtypes: ['knight'] }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_SUBTYPE',
          path: 'abilities[0].enabledWhile.subtypes[0]',
        }),
      ]),
    );
    expect(
      validateCard(
        restrictionCard({
          kind: 'selfCounterCountBelow',
          counter: 'plusOnePlusOne',
          fewerThan: 21,
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CONDITION_THRESHOLD_OUT_OF_RANGE',
          path: 'abilities[0].enabledWhile.fewerThan',
        }),
      ]),
    );
  });
});
