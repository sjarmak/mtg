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

  /**
   * The regression: `Enchant creature` prints first, so the keyword row is
   * `blocks[1]` in the source rows, but every reminder block it expands into
   * still has to land after the Aura's own row and before the trailing
   * `KeywordAbility` line — none of them silently dropped, none of them
   * reordered ahead of `Enchant creature`.
   */
  it('keeps the Enchant creature row ahead of the keyword reminders on an Aura', () => {
    const blocks = remindedBlocks(auraWithKeywords());
    expect(blocks[0]).toEqual({ kind: 'rules', text: 'Enchant creature' });
    expect(blocks[1]).toEqual({ kind: 'rules', text: 'Flying' });
    expect(blocks[2]?.kind).toBe('reminder');
    expect(blocks[2]?.text).toBe("Vigilance (Attacking doesn't cause this creature to tap.)");
    // The trailing `KeywordAbility` line (Defender) and the Aura's own
    // modification clause still print, through the same `abilityLineBlock`
    // path every row after the keyword row already used.
    const texts = blocks.map((block) => block.text);
    expect(texts).toContain("Defender (This creature can't attack.)");
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
