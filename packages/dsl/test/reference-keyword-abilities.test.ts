import { abilityLineReminder, ModelAbilitySchema, parseCard, renderOracleText, validateCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const baseCreature = {
  kind: 'creature',
  id: 'reference-keyword-creature',
  name: 'Reference Keyword Creature',
  rarity: 'common',
  set: { code: 'REF', collectorNumber: 1 },
  manaCost: { generic: 2 },
  colors: [],
  subtypes: ['Wall'],
  power: 2,
  toughness: 3,
} as const;

describe('reference keyword abilities', () => {
  it('parses and renders the bounded intrinsic creature vocabulary', () => {
    const card = parseCard({
      ...baseCreature,
      keywordAbilities: [
        { kind: 'defender' },
        { kind: 'landwalk', landType: 'Swamp' },
        { kind: 'hexproof' },
        { kind: 'indestructible' },
        { kind: 'protection', quality: { kind: 'color', color: 'W' } },
        { kind: 'protection', quality: { kind: 'subtype', subtype: 'Dragon' } },
      ],
    } as unknown);

    expect(card).toEqual(
      expect.objectContaining({
        keywordAbilities: [
          { kind: 'defender' },
          { kind: 'landwalk', landType: 'Swamp' },
          { kind: 'hexproof' },
          { kind: 'indestructible' },
          { kind: 'protection', quality: { kind: 'color', color: 'W' } },
          { kind: 'protection', quality: { kind: 'subtype', subtype: 'Dragon' } },
        ],
      }),
    );
    expect(renderOracleText(card)).toContain('Defender');
    expect(renderOracleText(card)).toContain('Swampwalk');
    expect(renderOracleText(card)).toContain('Hexproof');
    expect(renderOracleText(card)).toContain('Indestructible');
    expect(renderOracleText(card)).toContain('Protection from white and from Dragons');
  });

  /**
   * Defender specifically, and not "a keyword ability" generally: `mtg-rji`
   * split the placement rule by ability rather than by card type, so hexproof
   * and indestructible are legal on this same artifact and only the
   * combat-shaped kinds are not. `keyword-abilities-on-permanents.test.ts` is
   * the whole of that split; this stays as the case it always covered.
   */
  it('refuses a combat-shaped keyword ability on a noncreature', () => {
    expect(
      validateCard({
        kind: 'artifact',
        id: 'illegal-defender-rock',
        name: 'Illegal Defender Rock',
        rarity: 'common',
        set: { code: 'REF', collectorNumber: 2 },
        manaCost: { generic: 2 },
        keywordAbilities: [{ kind: 'defender' }],
      }),
    ).toContainEqual(
      expect.objectContaining({ code: 'KEYWORD_ILLEGAL_ON_CARD_TYPE', path: 'keywordAbilities[0]' }),
    );
  });

  /**
   * `mtg-zd0y`. Double strike is the sixth `KeywordAbility` kind and the only
   * one whose rules consequence is a combat *damage* step rather than a
   * declaration restriction, so the DSL side pins the three things a printed
   * line owes: it parses, it prints on its own line, and the reminder is the
   * store's sentence rather than an invented one. The kernel half — that the
   * damage actually lands twice — is `describe('double strike')` in
   * `packages/kernel/test/combat-keywords.test.ts`, beside first strike.
   *
   * It is not folded into the six-ability card above because
   * `keywordAbilities` is capped at six and that card is already full.
   */
  it('prints double strike on its own line with the measured reminder', () => {
    const card = parseCard({
      ...baseCreature,
      id: 'reference-double-striker',
      name: 'Reference Double Striker',
      subtypes: ['Knight'],
      keywordAbilities: [{ kind: 'doubleStrike' }],
    } as unknown);

    expect(validateCard(card)).toEqual([]);
    expect(card.keywordAbilities).toEqual([{ kind: 'doubleStrike' }]);
    expect(renderOracleText(card)).toBe('Double strike');
    expect(abilityLineReminder('Double strike')).toEqual({
      keyword: 'Double strike',
      gloss: '(This creature deals both first-strike and regular combat damage.)',
    });
  });

  /**
   * The same refusal Defender gets above, for the reason
   * `CREATURE_ONLY_KEYWORD_ABILITY_KINDS` gives: an artifact that never
   * attacks or blocks deals combat damage in neither step, so both steps is
   * not a thing it can be told to do. Asked of both a noncreature permanent
   * and a spell, because those are two different rules in
   * `keywordAbilityPlacement` and only one of them is about combat.
   */
  it('refuses double strike anywhere but a creature', () => {
    for (const card of [
      {
        kind: 'artifact',
        id: 'illegal-double-strike-rock',
        name: 'Illegal Double Strike Rock',
        rarity: 'common',
        set: { code: 'REF', collectorNumber: 3 },
        manaCost: { generic: 2 },
        keywordAbilities: [{ kind: 'doubleStrike' }],
      },
      {
        kind: 'instant',
        id: 'illegal-double-strike-trick',
        name: 'Illegal Double Strike Trick',
        rarity: 'common',
        set: { code: 'REF', collectorNumber: 4 },
        manaCost: { R: 1 },
        keywordAbilities: [{ kind: 'doubleStrike' }],
      },
    ]) {
      expect(validateCard(card), card.id).toContainEqual(
        expect.objectContaining({ code: 'KEYWORD_ILLEGAL_ON_CARD_TYPE', path: 'keywordAbilities[0]' }),
      );
    }
  });

  it('refuses duplicate intrinsic abilities without collapsing protection qualities', () => {
    expect(
      validateCard({
        ...baseCreature,
        keywordAbilities: [{ kind: 'hexproof' }, { kind: 'hexproof' }],
      }),
    ).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_KEYWORD' }));

    expect(
      validateCard({
        ...baseCreature,
        keywordAbilities: [
          { kind: 'protection', quality: { kind: 'color', color: 'W' } },
          { kind: 'protection', quality: { kind: 'color', color: 'B' } },
        ],
      }),
    ).toEqual([]);
  });

  it('models self-regeneration as an engine-only activated ability with no fake target', () => {
    const card = parseCard({
      ...baseCreature,
      id: 'reference-regenerator',
      name: 'Reference Regenerator',
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { G: 1 } },
          regenerateSelf: true,
          effects: [],
        },
      ],
    } as unknown);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('{G}: Regenerate this creature.');
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
  });

  it('refuses every mutually exclusive payload on a regeneration ability', () => {
    const conflicts = [
      {
        attach: { modifications: [{ kind: 'statBonus', power: 1, toughness: 0 }] },
      },
      { cost: { mana: { G: 1 }, sacrificeSelf: true } },
      { effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }] },
      { loyaltyCost: 1 },
    ];
    for (const [index, conflict] of conflicts.entries()) {
      const violations = validateCard({
        ...baseCreature,
        id: `illegal-regenerator-${String(index)}`,
        abilities: [
          {
            kind: 'activated',
            cost: { mana: { G: 1 } },
            regenerateSelf: true,
            effects: [],
            ...conflict,
          },
        ],
      });
      expect(violations, JSON.stringify(conflict)).toContainEqual(
        expect.objectContaining({ code: 'REGENERATION_ABILITY_INVALID' }),
      );
    }
  });
});
