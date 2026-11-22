/** M13 Flash authoring stays engine-only and prints the two cards exactly. */
import {
  AbilitySchema,
  abilityLineReminder,
  KeywordAbilitySchema,
  KeywordSchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
} from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const FLASH = { kind: 'flash' as const };
const GREEN_CREATURE_FLASH = {
  kind: 'staticPlayerRule' as const,
  players: 'controller' as const,
  rule: 'castSpellsAsThoughFlash' as const,
  spellFilter: { cardTypes: ['creature' as const], colors: ['G' as const] },
};
const SORCERY_FLASH_WITH_REMINDER = {
  kind: 'staticPlayerRule' as const,
  players: 'controller' as const,
  rule: 'castSpellsAsThoughFlash' as const,
  spellFilter: { cardTypes: ['sorcery' as const] },
  flashTimingReminder: true as const,
};

const FAERIE_INVADERS = {
  kind: 'creature' as const,
  id: 'm13-faerie-invaders',
  name: 'Faerie Invaders',
  rarity: 'common' as const,
  set: { code: 'M13', collectorNumber: 51 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'] as const,
  subtypes: ['Faerie', 'Rogue'],
  power: 3,
  toughness: 3,
  keywords: ['flying' as const],
  keywordAbilities: [FLASH],
};

const YEVA = {
  kind: 'creature' as const,
  id: 'm13-yeva-natures-herald',
  name: "Yeva, Nature's Herald",
  rarity: 'rare' as const,
  set: { code: 'M13', collectorNumber: 197 },
  manaCost: { generic: 2, G: 2 },
  colors: ['G'] as const,
  supertypes: ['legendary' as const],
  subtypes: ['Elf', 'Shaman'],
  power: 4,
  toughness: 4,
  keywordAbilities: [FLASH],
  abilities: [GREEN_CREATURE_FLASH],
};

describe('M13 Flash authoring', () => {
  it('parses and renders Faerie Invaders and Yeva exactly', () => {
    expect(renderOracleText(parseCard(FAERIE_INVADERS))).toBe('Flash\nFlying');
    expect(abilityLineReminder('Flash')).toEqual({
      keyword: 'Flash',
      gloss: '(You may cast this spell any time you could cast an instant.)',
    });
    expect(renderOracleText(parseCard(YEVA))).toBe(
      'Flash\nYou may cast green creature spells as though they had flash.',
    );
  });

  it('keeps intrinsic Flash and filtered timing permission outside model output', () => {
    expect(KeywordAbilitySchema.safeParse(FLASH).success).toBe(true);
    expect(KeywordSchema.safeParse('flash').success).toBe(false);
    expect(AbilitySchema.safeParse(GREEN_CREATURE_FLASH).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(GREEN_CREATURE_FLASH).success).toBe(false);
    expect(() => parseCard({ ...FAERIE_INVADERS, keywordAbilities: [FLASH, FLASH] })).toThrow(
      /repeats keywordAbilities/iu,
    );
  });

  it('derives an optional printed timing reminder without exposing authored prose', () => {
    const dragon = parseCard({
      kind: 'creature',
      id: 'rtr-hypersonic-dragon-dsl',
      name: 'Hypersonic Dragon',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 170 },
      manaCost: { generic: 3, U: 1, R: 1 },
      colors: ['U', 'R'],
      subtypes: ['Dragon'],
      power: 4,
      toughness: 4,
      keywords: ['flying', 'haste'],
      abilities: [SORCERY_FLASH_WITH_REMINDER],
    });
    expect(renderOracleText(dragon)).toBe(
      'Flying, haste\nYou may cast sorcery spells as though they had flash. (You may cast them any time you could cast an instant.)',
    );
    expect(AbilitySchema.safeParse(SORCERY_FLASH_WITH_REMINDER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(SORCERY_FLASH_WITH_REMINDER).success).toBe(false);
  });

  it('rejects the flash timing reminder on unrelated player rules', () => {
    expect(
      AbilitySchema.safeParse({
        kind: 'staticPlayerRule',
        players: 'controller',
        rule: 'noMaximumHandSize',
        flashTimingReminder: true,
      }).success,
    ).toBe(false);
  });

  it('allows intrinsic Flash on every nonland spell type and rejects land or invented fields', () => {
    const bases = [
      { kind: 'artifact', manaCost: { generic: 1 } },
      { kind: 'enchantment', manaCost: { W: 1 }, colors: ['W'] },
      {
        kind: 'planeswalker',
        manaCost: { U: 1 },
        colors: ['U'],
        startingLoyalty: 1,
        abilities: [
          {
            kind: 'activated',
            loyaltyCost: 1,
            cost: { mana: {} },
            effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
          },
        ],
      },
      {
        kind: 'instant',
        manaCost: { R: 1 },
        colors: ['R'],
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'sorcery',
        manaCost: { B: 1 },
        colors: ['B'],
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'battle',
        manaCost: { generic: 2, R: 1 },
        colors: ['R'],
        defense: 4,
      },
    ] as const;
    for (const [index, base] of bases.entries()) {
      expect(() =>
        parseCard({
          ...base,
          id: `flash-type-${String(index)}`,
          name: `Flash Type ${String(index)}`,
          rarity: 'common',
          set: { code: 'TST', collectorNumber: index + 10 },
          keywordAbilities: [FLASH],
        }),
      ).not.toThrow();
    }
    expect(() =>
      parseCard({
        kind: 'land',
        id: 'flash-land',
        name: 'Flash Land',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 20 },
        producesMana: ['G'],
        keywordAbilities: [FLASH],
      }),
    ).toThrow(/flash.*land|land.*flash/iu);
    expect(KeywordAbilitySchema.safeParse({ kind: 'flash', spellFilter: { colors: ['G'] } }).success).toBe(
      false,
    );
  });

  it('rejects filters on unrelated rules, empty filters, and opponent-scoped permission', () => {
    expect(
      AbilitySchema.safeParse({
        kind: 'staticPlayerRule',
        players: 'controller',
        rule: 'hasHexproof',
        spellFilter: { colors: ['G'] },
      }).success,
    ).toBe(false);
    expect(AbilitySchema.safeParse({ ...GREEN_CREATURE_FLASH, spellFilter: {} }).success).toBe(false);
    for (const spellFilter of [
      { combat: 'attacking' },
      { controller: 'you' },
      { allCardTypes: ['creature'] },
    ]) {
      expect(AbilitySchema.safeParse({ ...GREEN_CREATURE_FLASH, spellFilter }).success).toBe(false);
    }
    expect(
      AbilitySchema.safeParse({ ...GREEN_CREATURE_FLASH, spellFilter: { keywords: ['flying'] } }).success,
    ).toBe(true);
    expect(() =>
      parseCard({
        ...YEVA,
        abilities: [{ ...GREEN_CREATURE_FLASH, players: 'eachOpponent' }],
      }),
    ).toThrow(/castSpellsAsThoughFlash.*controller|controller.*castSpellsAsThoughFlash/iu);
  });

  it.each([{ colors: undefined }, { cardTypes: undefined }])(
    'rejects a spell filter whose only semantic value is undefined: %j',
    (spellFilter) => {
      const ability = { ...GREEN_CREATURE_FLASH, spellFilter };
      expect(AbilitySchema.safeParse(ability).success).toBe(false);
      expect(() => parseCard({ ...YEVA, abilities: [ability] })).toThrow(
        /spellFilter must name at least one printed characteristic/iu,
      );
    },
  );
});
