/** Captivating Vampire as one reusable cohort-tap cost and two layered effects. */
import { describe, expect, it } from 'vitest';
import {
  MechanicModelAbilitySchema,
  ModelAbilitySchema,
  ModelEffectSchema,
  cardFingerprint,
  parseCard,
  renderOracleText,
  safeParseCard,
} from '@mtg/dsl';

const CONTROL = { kind: 'gainControl', target: { kind: 'targetCreature' } } as const;
const VAMPIRE = {
  kind: 'addSubtype',
  subtype: 'Vampire',
  target: { kind: 'thatCreature' },
} as const;
const ACTIVATED = {
  kind: 'activated',
  cost: { mana: {}, tapMatching: { count: 5, filter: { subtypes: ['Vampire'] } } },
  effects: [CONTROL, VAMPIRE],
} as const;

const CAPTIVATING_VAMPIRE_INPUT = {
  kind: 'creature',
  id: 'm11-87',
  name: 'Captivating Vampire',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 87 },
  colors: ['B'],
  manaCost: { generic: 1, B: 2 },
  subtypes: ['Vampire'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: 'Vampire',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
    ACTIVATED,
  ],
} as const;

function violations(cost: unknown): readonly (readonly [string, string])[] {
  const result = safeParseCard({
    ...CAPTIVATING_VAMPIRE_INPUT,
    abilities: [{ ...ACTIVATED, cost }],
  });
  return result.ok ? [] : result.violations.map((found) => [found.code, found.path]);
}

describe('Captivating Vampire authoring', () => {
  it('strictly parses and renders the current Oracle text', () => {
    const card = parseCard(CAPTIVATING_VAMPIRE_INPUT);

    expect(renderOracleText(card)).toBe(
      'Other Vampire creatures you control get +1/+1.\n' +
        'Tap five untapped Vampires you control: Gain control of target creature. It becomes a Vampire in addition to its other types.',
    );
  });

  it('uses the correct article for a vowel-initial added subtype', () => {
    const card = parseCard({
      ...CAPTIVATING_VAMPIRE_INPUT,
      abilities: [
        CAPTIVATING_VAMPIRE_INPUT.abilities[0],
        { ...ACTIVATED, effects: [CONTROL, { ...VAMPIRE, subtype: 'Elf' }] },
      ],
    });

    expect(renderOracleText(card)).toContain('It becomes an Elf in addition to its other types.');
  });

  it('requires a bounded, nonempty current-characteristic filter', () => {
    expect(
      violations({ mana: {}, tapMatching: { count: 0, filter: { subtypes: ['Vampire'] } } }),
    ).toContainEqual(['ABILITY_COST_INVALID', 'abilities[0].cost.tapMatching.count']);
    expect(
      violations({ mana: {}, tapMatching: { count: 21, filter: { subtypes: ['Vampire'] } } }),
    ).toContainEqual(['ABILITY_COST_INVALID', 'abilities[0].cost.tapMatching.count']);
    expect(violations({ mana: {}, tapMatching: { count: 5, filter: {} } })).toContainEqual([
      'ILLEGAL_TARGET_FILTER',
      'abilities[0].cost.tapMatching.filter',
    ]);
  });

  it('keeps the cost and both one-shot layers outside every generator-facing ability schema', () => {
    expect(ModelAbilitySchema.safeParse(ACTIVATED).success).toBe(false);
    expect(MechanicModelAbilitySchema.safeParse(ACTIVATED).success).toBe(false);
    expect(ModelEffectSchema.safeParse(CONTROL).success).toBe(false);
    expect(ModelEffectSchema.safeParse(VAMPIRE).success).toBe(false);
  });

  it('fingerprints every rules-bearing choice', () => {
    const card = parseCard(CAPTIVATING_VAMPIRE_INPUT);
    const smallerCohort = parseCard({
      ...CAPTIVATING_VAMPIRE_INPUT,
      abilities: [
        CAPTIVATING_VAMPIRE_INPUT.abilities[0],
        {
          ...ACTIVATED,
          cost: { mana: {}, tapMatching: { count: 4, filter: { subtypes: ['Vampire'] } } },
        },
      ],
    });
    const differentGrant = parseCard({
      ...CAPTIVATING_VAMPIRE_INPUT,
      abilities: [
        CAPTIVATING_VAMPIRE_INPUT.abilities[0],
        { ...ACTIVATED, effects: [CONTROL, { ...VAMPIRE, subtype: 'Zombie' }] },
      ],
    });

    expect(cardFingerprint(card)).not.toBe(cardFingerprint(smallerCohort));
    expect(cardFingerprint(card)).not.toBe(cardFingerprint(differentGrant));
  });
});
