/**
 * `remindedBlocks` finds a card's keyword row by content, not by position.
 *
 * mtg-67vm: the function used to slice `oracleRows(card)` at a fixed index —
 * `rows[0]` is the keyword row on every card `oracleRows` had ever been asked
 * to render, because nothing else in the DSL prints a row ahead of it. An
 * Aura breaks that: `isAuraCard` (`@mtg/dsl`'s `oracle.ts`) pushes an `Enchant
 * creature` row first, so a keyworded Aura's keyword row sits at `rows[1]`
 * and the fixed slice cut the `Enchant creature` line off along with it. The
 * card built below is schema-shaped and semantically illegal — real Auras
 * cannot carry `keywords` (`validate/typeline.ts` restricts both `keywords`
 * and `keywordAbilities` to creatures) — parsed with `CardSchema.parse`
 * rather than `parseCard` for exactly that reason, the same escape hatch
 * `packages/card-render/test/fixtures/cards.ts`'s `oversizedCard` uses. The
 * renderer's job is to draw whatever schema-shaped record it is handed, so
 * this is fair input for it even though a set generator could never emit it.
 */
import { describe, expect, it } from 'vitest';
import { CardSchema, parseCard } from '@mtg/dsl';
import type { Card, CardInput } from '@mtg/dsl';
import { remindedBlocks } from '../src/index';

function auraWithKeywords(): Card {
  return CardSchema.parse({
    id: 'test-aura-with-keywords',
    name: 'Test Aura With Keywords',
    kind: 'enchantment',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['W'],
    manaCost: { generic: 1, W: 1 },
    aura: {
      enchant: 'creature',
      modifications: [{ kind: 'statBonus', power: 1, toughness: 1 }],
    },
    keywords: ['flying', 'vigilance'],
    keywordAbilities: [{ kind: 'defender' }],
  } satisfies CardInput);
}

function keywordedCreature(): Card {
  return CardSchema.parse({
    id: 'test-keyworded-creature',
    name: 'Test Keyworded Creature',
    kind: 'creature',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 2 },
    colors: ['W'],
    manaCost: { generic: 1, W: 1 },
    power: 1,
    toughness: 1,
    keywords: ['flying', 'vigilance'],
  } satisfies CardInput);
}

describe('remindedBlocks finds the keyword row by matching, not position', () => {
  it('derives the Overload reminder from the structured alternate casting profile', () => {
    const card = parseCard({
      id: 'rtr-downsize-overload-reminder',
      name: 'Downsize',
      kind: 'instant',
      rarity: 'common',
      set: { code: 'RTR', collectorNumber: 38 },
      colors: ['U'],
      manaCost: { U: 1 },
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: -4,
          toughness: 0,
          target: { kind: 'targetCreatureYouDontControl' },
        },
      ],
      overload: {
        cost: { generic: 2, U: 1 },
        effects: [
          {
            kind: 'pumpUntilEndOfTurn',
            power: -4,
            toughness: 0,
            scope: 'permanentsYouDontControl',
            scopeFilter: { cardTypes: ['creature'] },
            target: { kind: 'noTarget' },
          },
        ],
      },
    } satisfies CardInput);

    expect(remindedBlocks(card).at(-1)).toEqual({
      kind: 'reminder',
      roman: 'Overload {2}{U}',
      text: 'Overload {2}{U} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
    });
  });

  it('marks a dual-typed land mana row as the source reminder paragraph', () => {
    const card = parseCard({
      id: 'rtr-blood-crypt-text-box',
      name: 'Blood Crypt',
      kind: 'land',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 238 },
      subtypes: ['Swamp', 'Mountain'],
      producesMana: ['B', 'R'],
      entryReplacement: { kind: 'payLifeOrEntersTapped', life: 2 },
      printedEntryReference: 'thisLand',
      printedManaAbilityFirst: true,
    });

    expect(remindedBlocks(card)).toEqual([
      {
        kind: 'reminder',
        text: '({T}: Add {B} or {R}.)',
        roman: '{T}: Add {B} or {R}.',
      },
      {
        kind: 'rules',
        text: "As this land enters, you may pay 2 life. If you don't, it enters tapped.",
      },
    ]);
  });

  it('keeps Populate rules roman and its derived reminder italic on the same row', () => {
    const card = parseCard({
      id: 'rtr-rootborn-defenses-reminder',
      name: 'Rootborn Defenses',
      kind: 'instant',
      rarity: 'common',
      set: { code: 'RTR', collectorNumber: 19 },
      colors: ['W'],
      manaCost: { generic: 2, W: 1 },
      effects: [
        { kind: 'populate' },
        {
          kind: 'grantKeywordUntilEndOfTurn',
          keyword: 'indestructible',
          target: { kind: 'noTarget' },
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    } satisfies CardInput);

    expect(remindedBlocks(card)).toEqual([
      {
        kind: 'reminder',
        roman: 'Populate. Creatures you control gain indestructible until end of turn.',
        text: "Populate. Creatures you control gain indestructible until end of turn. (To populate, create a token that's a copy of a creature token you control.)",
      },
    ]);
  });

  /**
   * The baseline: a creature has nothing printed ahead of its keywords, so
   * the keyword row is still `blocks[0]` — this is the shape every fixture
   * exercised before mtg-67vm, kept here so a regression that reintroduces a
   * fixed-index slice fails on the simple case too, not only the Aura one.
   */
  it('still finds the keyword row at index 0 when nothing precedes it', () => {
    const blocks = remindedBlocks(keywordedCreature());
    expect(blocks[0]).toEqual({ kind: 'rules', text: 'Flying' });
    expect(blocks[1]?.kind).toBe('reminder');
    expect(blocks[1]?.text).toBe("Vigilance (Attacking doesn't cause this creature to tap.)");
  });

  it('keeps a mixed intrinsic and flat source group in source order', () => {
    const blocks = remindedBlocks(
      parseCard({
        id: 'rtr-hover-barrier',
        name: 'Fog Bank',
        kind: 'creature',
        rarity: 'uncommon',
        set: { code: 'RTR', collectorNumber: 40 },
        colors: ['U'],
        manaCost: { generic: 2, U: 1 },
        power: 0,
        toughness: 6,
        subtypes: ['Illusion', 'Wall'],
        keywords: ['flying'],
        keywordAbilities: [{ kind: 'defender' }],
        keywordLineGroups: [[{ kind: 'defender' }, 'flying']],
      } satisfies CardInput),
    );
    expect(blocks).toEqual([
      {
        kind: 'reminder',
        roman: 'Defender',
        text: "Defender (This creature can't attack.)",
      },
      { kind: 'rules', text: 'Flying' },
    ]);
  });

  it('keeps two reminded entries from one source group in source order', () => {
    const blocks = remindedBlocks(
      parseCard({
        id: 'test-reminded-source-group',
        name: 'Fog Bank',
        kind: 'creature',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 4 },
        colors: ['W'],
        manaCost: { generic: 2, W: 1 },
        power: 2,
        toughness: 2,
        subtypes: ['Cat'],
        keywords: ['lifelink', 'vigilance'],
        keywordLineGroups: [['lifelink', 'vigilance']],
      } satisfies CardInput),
    );
    expect(blocks.map((block) => block.roman)).toEqual(['Lifelink', 'Vigilance']);
  });

  /**
   * The regression: `Enchant creature` prints first, so the keyword row is
   * `blocks[2]` in the source rows because Defender uses its source-faithful
   * leading position. Every reminder block still has to remain after the
   * Aura's own row — none silently dropped or reordered ahead of `Enchant
   * creature`.
   */
  it('keeps the Enchant creature row ahead of the keyword reminders on an Aura', () => {
    const blocks = remindedBlocks(auraWithKeywords());
    expect(blocks[0]).toEqual({ kind: 'rules', text: 'Enchant creature' });
    expect(blocks[1]?.text).toBe("Defender (This creature can't attack.)");
    expect(blocks[2]).toEqual({ kind: 'rules', text: 'Flying' });
    expect(blocks[3]?.kind).toBe('reminder');
    expect(blocks[3]?.text).toBe("Vigilance (Attacking doesn't cause this creature to tap.)");
    // The leading `KeywordAbility` line and the Aura's own modification clause
    // still print through the same `abilityLineBlock` path around the matched
    // keyword row.
    const texts = blocks.map((block) => block.text);
    expect(texts.some((text) => text.includes('gets +1/+1'))).toBe(true);
  });

  /**
   * `mtg-rji`: an indestructible artifact is a legal card now, and its
   * reminder has to name what it is. The block used to be built from the row's
   * text alone, so The Trisigil would have drawn "don't destroy this creature"
   * on a card with no creature type on it. Parsed with `parseCard`, not
   * `CardSchema.parse` — unlike the Aura above this one is a card the
   * validator accepts, and pinning it through the validator is half the point.
   */
  it("names the card's own type in an artifact's indestructible reminder", () => {
    const blocks = remindedBlocks(
      parseCard({
        id: 'test-trisigil',
        name: 'The Trisigil',
        kind: 'artifact',
        rarity: 'mythic',
        set: { code: 'TST', collectorNumber: 3 },
        manaCost: { generic: 3 },
        supertypes: ['legendary'],
        keywordAbilities: [{ kind: 'indestructible' }],
      } satisfies CardInput),
    );
    expect(blocks).toEqual([
      {
        kind: 'reminder',
        roman: 'Indestructible',
        text: 'Indestructible (Damage and effects that say "destroy" don\'t destroy this artifact.)',
      },
    ]);
  });
});
