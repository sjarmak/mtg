/** Strict, hand-authored Enchantment and Aura card shapes. */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText, renderTypeLine, safeParseCard, serializeCard } from '@mtg/dsl';

const HOLY_STRENGTH = {
  kind: 'enchantment',
  id: 'm11-holy-strength',
  name: 'Holy Strength',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 16 },
  manaCost: { W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [{ kind: 'statBonus', power: 1, toughness: 2 }],
  },
} as const;

describe('Enchantment cards', () => {
  it('keeps blanket Enchantments distinct from Auras', () => {
    const fervor = parseCard({
      kind: 'enchantment',
      id: 'm13-fervor',
      name: 'Fervor',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 129 },
      manaCost: { generic: 2, R: 1 },
      colors: ['R'],
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'grantKeyword', keyword: 'haste' },
        },
      ],
    });
    expect(renderTypeLine(fervor)).toBe('Enchantment');
    expect(renderOracleText(fervor)).toBe('Creatures you control have haste.');
    expect('aura' in fervor).toBe(false);
  });

  it('round-trips an Aura and renders its enchant restriction before its modification', () => {
    const aura = parseCard(HOLY_STRENGTH);
    expect(renderTypeLine(aura)).toBe('Enchantment — Aura');
    expect(renderOracleText(aura)).toBe('Enchant creature\nEnchanted creature gets +1/+2.');
    expect(serializeCard(parseCard(JSON.parse(serializeCard(aura)) as unknown))).toBe(serializeCard(aura));
  });

  it('renders compound Aura modifications without changing their semantics', () => {
    const mark = parseCard({
      ...HOLY_STRENGTH,
      id: 'm13-mark-of-the-vampire',
      name: 'Mark of the Vampire',
      set: { code: 'M13', collectorNumber: 99 },
      manaCost: { generic: 3, B: 1 },
      colors: ['B'],
      aura: {
        enchant: 'creature',
        modifications: [
          { kind: 'statBonus', power: 2, toughness: 2 },
          { kind: 'grantKeyword', keyword: 'lifelink' },
        ],
      },
    });
    expect(renderOracleText(mark)).toBe('Enchant creature\nEnchanted creature gets +2/+2 and has lifelink.');
  });

  it('renders only the bounded basic-landwalk grant as an attached ability', () => {
    const volcanic = parseCard({
      ...HOLY_STRENGTH,
      id: 'm11-volcanic-strength',
      name: 'Volcanic Strength',
      set: { code: 'M11', collectorNumber: 158 },
      manaCost: { generic: 1, R: 1 },
      colors: ['R'],
      aura: {
        enchant: 'creature',
        modifications: [
          { kind: 'statBonus', power: 2, toughness: 2 },
          { kind: 'grantLandwalk', landType: 'Mountain' },
        ],
      },
    });
    expect(volcanic.keywordAbilities).toBeUndefined();
    expect(renderOracleText(volcanic)).toBe(
      "Enchant creature\nEnchanted creature gets +2/+2 and has mountainwalk. (It can't be blocked as long as defending player controls a Mountain.)",
    );

    const dryad = parseCard({
      ...HOLY_STRENGTH,
      id: 'm11-dryads-favor',
      name: "Dryad's Favor",
      set: { code: 'M11', collectorNumber: 169 },
      manaCost: { G: 1 },
      colors: ['G'],
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'grantLandwalk', landType: 'Forest' }],
      },
    });
    expect(renderOracleText(dryad)).toBe(
      "Enchant creature\nEnchanted creature has forestwalk. (It can't be blocked as long as defending player controls a Forest.)",
    );
  });

  it('renders combat restrictions in the same paragraph as the attached stat change', () => {
    const blight = parseCard({
      ...HOLY_STRENGTH,
      id: 'm13-crippling-blight',
      name: 'Crippling Blight',
      set: { code: 'M13', collectorNumber: 85 },
      manaCost: { B: 1 },
      colors: ['B'],
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'statBonus', power: -1, toughness: -1 }, { kind: 'cantBlock' }],
      },
    });
    expect(renderOracleText(blight)).toBe("Enchant creature\nEnchanted creature gets -1/-1 and can't block.");
  });

  /**
   * `doesNotUntap` is the second clause that refuses to be folded into the
   * shared-subject sentence, and for the opposite reason to the control clause:
   * its subject *is* "enchanted creature", but its verb is not one Magic ever
   * conjoins. Folding it in would print "Enchanted creature can't block or
   * doesn't untap during its controller's untap step.", and no printed card
   * reads that way — Bitter Chill, Claustrophobia and Tractor Beam all give the
   * sentence a line of its own, after whatever else the Aura says.
   *
   * The tap that usually opens the printed card is an enters trigger and not a
   * clause, so it is absent here for the same reason it is absent from the
   * kernel: there is no target kind meaning "the creature this Aura is attached
   * to" yet.
   */
  it('gives the untap hold its own sentence, after the shared-subject one', () => {
    const chill = parseCard({
      ...HOLY_STRENGTH,
      id: 'khm-bitter-chill',
      name: 'Bitter Chill',
      set: { code: 'KHM', collectorNumber: 51 },
      manaCost: { generic: 1, U: 1 },
      colors: ['U'],
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'doesNotUntap' }],
      },
    });
    expect(renderTypeLine(chill)).toBe('Enchantment — Aura');
    expect(renderOracleText(chill)).toBe(
      "Enchant creature\nEnchanted creature doesn't untap during its controller's untap step.",
    );
    expect(serializeCard(parseCard(JSON.parse(serializeCard(chill)) as unknown))).toBe(serializeCard(chill));

    const feeling = parseCard({
      ...HOLY_STRENGTH,
      id: 'mid-sinking-feeling',
      name: 'Sinking Feeling',
      set: { code: 'MID', collectorNumber: 66 },
      manaCost: { U: 1 },
      colors: ['U'],
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'statBonus', power: -1, toughness: -1 }, { kind: 'doesNotUntap' }],
      },
    });
    expect(renderOracleText(feeling)).toBe(
      "Enchant creature\nEnchanted creature gets -1/-1. Enchanted creature doesn't untap during its controller's untap step.",
    );
  });

  it('refuses a second untap hold on one Aura, the way it refuses any repeat', () => {
    const twice = safeParseCard({
      ...HOLY_STRENGTH,
      id: 'tst-twice-frozen',
      name: 'Twice Frozen',
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'doesNotUntap' }, { kind: 'doesNotUntap' }],
      },
    });
    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.violations.map(({ code, path }) => [code, path])).toEqual([
      ['DUPLICATE_MODIFICATION', 'aura.modifications[1]'],
    ]);
  });

  /**
   * The control clause is the one modification with a subject of its own, and
   * both halves of that are asserted here: alone it is the whole paragraph, and
   * beside another clause it is the sentence in front rather than a phrase
   * hoisted under "Enchanted creature".
   *
   * `Corrupted Conscience` is the printed card the second case is read off -
   * "You control enchanted creature. Enchanted creature has infect." - so the
   * order is Magic's rather than the modification array's, which is the one
   * place `renderAuraModificationClause` does not simply follow printed
   * modification order.
   */
  it('gives the control clause its own sentence, in front of the shared-subject one', () => {
    const mind = parseCard({
      ...HOLY_STRENGTH,
      id: 'm11-mind-control',
      name: 'Mind Control',
      rarity: 'uncommon',
      set: { code: 'M11', collectorNumber: 58 },
      manaCost: { generic: 3, U: 2 },
      colors: ['U'],
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'gainControl' }],
      },
    });
    expect(renderOracleText(mind)).toBe('Enchant creature\nYou control enchanted creature.');

    const conscience = parseCard({
      ...HOLY_STRENGTH,
      id: 'nph-corrupted-conscience',
      name: 'Corrupted Conscience',
      rarity: 'uncommon',
      set: { code: 'NPH', collectorNumber: 28 },
      manaCost: { generic: 3, U: 2 },
      colors: ['U'],
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'gainControl' }, { kind: 'grantKeyword', keyword: 'flying' }],
      },
    });
    expect(renderOracleText(conscience)).toBe(
      'Enchant creature\nYou control enchanted creature. Enchanted creature has flying.',
    );
  });

  it('refuses a second control clause on one Aura, the way it refuses any repeat', () => {
    const twice = safeParseCard({
      ...HOLY_STRENGTH,
      id: 'tst-twice-controlled',
      name: 'Twice Controlled',
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'gainControl' }, { kind: 'gainControl' }],
      },
    });
    expect(twice.ok).toBe(false);
  });

  /**
   * `staticModificationIdentity`'s combat-class arms, exercised the same way
   * the control clause above exercises its own: `checkModifications` runs over
   * every Aura clause regardless of which class a modification belongs to, so
   * a repeated `cantAttack` is refused for identical reasons to a repeated
   * `gainControl` — the kernel would apply the restriction twice, which is one
   * restriction, while the printed clause would say it twice.
   */
  it('refuses a second cantAttack clause on one Aura, the way it refuses any repeat', () => {
    const twice = safeParseCard({
      ...HOLY_STRENGTH,
      id: 'tst-twice-grounded',
      name: 'Twice Grounded',
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'cantAttack' }, { kind: 'cantAttack' }],
      },
    });
    expect(twice.ok).toBe(false);
  });

  it('renders an enters trigger between the enchant line and attached modification', () => {
    const favor = parseCard({
      ...HOLY_STRENGTH,
      id: 'm13-divine-favor',
      name: 'Divine Favor',
      set: { code: 'M13', collectorNumber: 11 },
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'statBonus', power: 1, toughness: 3 }],
      },
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
        },
      ],
    });
    expect(renderOracleText(favor)).toBe(
      'Enchant creature\nWhen Divine Favor enters the battlefield, you gain 3 life.\nEnchanted creature gets +1/+3.',
    );
  });

  it('refuses hostile Aura shapes and subtype contradictions', () => {
    const cases = [
      { ...HOLY_STRENGTH, subtypes: [] },
      { ...HOLY_STRENGTH, aura: undefined },
      {
        ...HOLY_STRENGTH,
        aura: { enchant: 'player', modifications: HOLY_STRENGTH.aura.modifications },
      },
      {
        ...HOLY_STRENGTH,
        aura: { enchant: 'creature', modifications: [] },
      },
      {
        ...HOLY_STRENGTH,
        aura: {
          enchant: 'creature',
          modifications: [
            { kind: 'statBonus', power: 1, toughness: 0 },
            { kind: 'grantKeyword', keyword: 'flying' },
            { kind: 'cantAttack' },
          ],
        },
      },
    ];
    for (const input of cases) expect(safeParseCard(input).ok).toBe(false);
  });

  it('refuses unsafe, no-op, and duplicate Aura modifications', () => {
    const cases = [
      {
        modifications: [{ kind: 'statBonus', power: 999_999, toughness: -999_999 }],
        violations: [
          ['STATIC_MODIFICATION_OUT_OF_RANGE', 'aura.modifications[0].power'],
          ['STATIC_MODIFICATION_OUT_OF_RANGE', 'aura.modifications[0].toughness'],
        ],
      },
      {
        modifications: [{ kind: 'statBonus', power: 0, toughness: 0 }],
        violations: [['STATIC_MODIFICATION_OUT_OF_RANGE', 'aura.modifications[0]']],
      },
      {
        modifications: [
          { kind: 'statBonus', power: 1, toughness: 0 },
          { kind: 'statBonus', power: 0, toughness: 1 },
        ],
        violations: [['DUPLICATE_MODIFICATION', 'aura.modifications[1]']],
      },
      {
        modifications: [
          { kind: 'grantKeyword', keyword: 'flying' },
          { kind: 'grantKeyword', keyword: 'flying' },
        ],
        violations: [['DUPLICATE_MODIFICATION', 'aura.modifications[1]']],
      },
      {
        modifications: [{ kind: 'cantBlock' }, { kind: 'cantBlock' }],
        violations: [['DUPLICATE_MODIFICATION', 'aura.modifications[1]']],
      },
      {
        modifications: [
          { kind: 'grantLandwalk', landType: 'Forest' },
          { kind: 'grantLandwalk', landType: 'Mountain' },
        ],
        violations: [['DUPLICATE_MODIFICATION', 'aura.modifications[1]']],
      },
    ] as const;

    for (const testCase of cases) {
      const result = safeParseCard({
        ...HOLY_STRENGTH,
        aura: { enchant: 'creature', modifications: testCase.modifications },
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.violations.map(({ code, path }) => [code, path])).toEqual(testCase.violations);
    }
  });

  it('has no shape at all for a characteristic-defining P/T, which sets the source’s own stats', () => {
    const result = safeParseCard({
      ...HOLY_STRENGTH,
      aura: {
        enchant: 'creature',
        modifications: [
          { kind: 'definePt', countOf: 'graveyardCardTypesEach', powerOffset: 0, toughnessOffset: 1 },
        ],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Refused by the schema, not by a rule a reader has to know: the arm is off
    // `AuraModificationSchema`, so nothing downstream carries a branch for a
    // modification a valid Aura cannot hold (`mtg-vmrp`).
    expect(result.violations.map(({ code }) => code)).not.toContain('DEFINE_PT_ILLEGAL_ON_SCOPE');
    expect(result.violations.every(({ path }) => path.startsWith('aura.modifications'))).toBe(true);
  });

  /**
   * The rate clause is the second engine-only member of `AuraModification`,
   * beside the untap replacement: `ModelAuraModificationSchema` is built from
   * `AuraStaticModificationSchema`, so a member added there would re-address
   * every recorded generator fixture. Adding it to the engine union instead is
   * what keeps it hand-authorable and out of the model's reach.
   */
  it('lets a hand-authored Aura charge a rate over the board, in either sign', () => {
    const ascension = parseCard({
      ...HOLY_STRENGTH,
      id: 'm11-armored-ascension',
      name: 'Armored Ascension',
      set: { code: 'M11', collectorNumber: 5 },
      manaCost: { generic: 3, W: 1 },
      aura: {
        enchant: 'creature',
        modifications: [
          {
            kind: 'statBonusPer',
            power: 1,
            toughness: 1,
            each: { kind: 'landsWithSubtype', subtype: 'Plains', whose: 'you' },
          },
          { kind: 'grantKeyword', keyword: 'flying' },
        ],
      },
    });
    expect(renderOracleText(ascension)).toBe(
      'Enchant creature\nEnchanted creature gets +1/+1 for each Plains you control and has flying.',
    );

    const sickness = parseCard({
      ...HOLY_STRENGTH,
      id: 'm11-quag-sickness',
      name: 'Quag Sickness',
      set: { code: 'M11', collectorNumber: 111 },
      manaCost: { generic: 2, B: 1 },
      colors: ['B'],
      aura: {
        enchant: 'creature',
        modifications: [
          {
            kind: 'statBonusPer',
            power: -1,
            toughness: -1,
            each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
          },
        ],
      },
    });
    expect(renderOracleText(sickness)).toBe(
      'Enchant creature\nEnchanted creature gets -1/-1 for each Swamp you control.',
    );
  });

  it('range-checks the rate and reads two tallies as two clauses', () => {
    const overRange = safeParseCard({
      ...HOLY_STRENGTH,
      aura: {
        enchant: 'creature',
        modifications: [
          {
            kind: 'statBonusPer',
            power: 100,
            toughness: 0,
            each: { kind: 'landsWithSubtype', subtype: 'Plains', whose: 'you' },
          },
        ],
      },
    });
    expect(overRange.ok).toBe(false);
    if (overRange.ok) return;
    expect(overRange.violations.every(({ path }) => path.startsWith('aura.modifications'))).toBe(true);

    // Two rates over two different tallies stack and are not one clause said
    // twice; the identity is keyed by the tally, so only the repeat is refused.
    const perPlains = {
      kind: 'statBonusPer',
      power: 1,
      toughness: 1,
      each: { kind: 'landsWithSubtype', subtype: 'Plains', whose: 'you' },
    } as const;
    const perSwamp = {
      kind: 'statBonusPer',
      power: 1,
      toughness: 1,
      each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
    } as const;
    expect(
      safeParseCard({
        ...HOLY_STRENGTH,
        aura: { enchant: 'creature', modifications: [perPlains, perSwamp] },
      }).ok,
    ).toBe(true);
    const repeated = safeParseCard({
      ...HOLY_STRENGTH,
      aura: { enchant: 'creature', modifications: [perPlains, perPlains] },
    });
    expect(repeated.ok).toBe(false);
    if (repeated.ok) return;
    expect(repeated.violations.map(({ code }) => code)).toContain('DUPLICATE_MODIFICATION');
  });

  it('does not widen attached grants to arbitrary keyword abilities', () => {
    for (const modification of [
      { kind: 'grantLandwalk', landType: 'Desert' },
      { kind: 'grantKeywordAbility', ability: { kind: 'hexproof' } },
      { kind: 'grantKeywordAbility', ability: { kind: 'defender' } },
    ]) {
      expect(
        safeParseCard({
          ...HOLY_STRENGTH,
          aura: { enchant: 'creature', modifications: [modification] },
        }).ok,
      ).toBe(false);
    }
  });
});
