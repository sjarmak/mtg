/**
 * The filter on the one primitive whose target is not a permanent.
 *
 * `counterSpell` carries no `TargetSpec` at all — a spell on the stack is
 * outside the pinned targeting vocabulary, and that is deliberate — so the
 * narrowing M11/M13's counterspells need cannot be a `TargetSpec.filter`. It is
 * `spellFilter`, the same `TargetFilterSchema` read against the stack instead
 * of the battlefield, which is what makes Essence Scatter, Negate and
 * Flashfreeze one field rather than three primitives (`mtg-6y4g`).
 *
 * Engine-only, threaded exactly the way `scope` and `doesNotUntap` are: the
 * field is spread into the union from a bundle the engine's three call sites
 * pass and the model's does not, so the JSON Schema `@mtg/setgen` shows the
 * generator is byte-identical to the one it was shown before this field
 * existed and every recorded fixture still replays. A fixture key hashes that
 * schema (`packages/llm/src/schema.ts`), so this is not a style choice.
 *
 * The stack half of the card-type rule is the mirror of the battlefield half: a
 * land is never a spell (CR 305.9), and a combat role is a property of a
 * permanent in a combat, so both are refused here and the corresponding
 * refusals for the battlefield live in `filtered-object-target.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect } from '../src/index';
import { ModelEffectSchema, renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

function instantInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'xmp-counter-probe',
    name: 'Tideglass Denial',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 2 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

function card(effects: readonly Effect[]): Card {
  return parseCard(instantInput(effects) as CardInput);
}

function codes(effects: readonly Effect[]): readonly string[] {
  return validateCard(instantInput(effects) as unknown as Card).map((found) => found.code);
}

describe('the filter on a counterspell', () => {
  it('prints Cancel unchanged when nothing narrows it', () => {
    const cancel = card([{ kind: 'counterSpell' }]);
    expect(validateCard(cancel)).toEqual([]);
    expect(renderOracleText(cancel)).toBe('Counter target spell.');
  });

  it('prints the three M11/M13 counterspells in their current Oracle wording', () => {
    const essenceScatter = card([{ kind: 'counterSpell', spellFilter: { cardTypes: ['creature'] } }]);
    expect(validateCard(essenceScatter)).toEqual([]);
    expect(renderOracleText(essenceScatter)).toBe('Counter target creature spell.');

    const negate = card([{ kind: 'counterSpell', spellFilter: { excludeCardTypes: ['creature'] } }]);
    expect(renderOracleText(negate)).toBe('Counter target noncreature spell.');

    const flashfreeze = card([{ kind: 'counterSpell', spellFilter: { colors: ['R', 'G'] } }]);
    expect(renderOracleText(flashfreeze)).toBe('Counter target red or green spell.');
  });

  /**
   * The containment invariant, asserted on the schema rather than on a comment:
   * the model's union declares no such key, so an answer carrying it is refused
   * by name and sent back (`mtg-nhyv.69`) rather than honored, and a generated
   * card cannot print a narrowed counterspell by accident.
   */
  it('is absent from the schema the generator answers', () => {
    const parsed = ModelEffectSchema.safeParse({ kind: 'counterSpell', spellFilter: { colors: ['R'] } });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('spellFilter'),
    );
    // The bare effect is reachable, so the refusal is about this field and not
    // about a primitive the generator never had.
    expect(ModelEffectSchema.safeParse({ kind: 'counterSpell' }).success).toBe(true);
  });

  it('refuses a combat role, which no spell on the stack has', () => {
    expect(codes([{ kind: 'counterSpell', spellFilter: { combat: 'attacking' } }])).toContain(
      'ILLEGAL_TARGET_FILTER',
    );
  });

  it('refuses a card type that never uses the stack as a spell', () => {
    expect(codes([{ kind: 'counterSpell', spellFilter: { cardTypes: ['land'] } }])).toContain(
      'ILLEGAL_TARGET_FILTER',
    );
  });

  it('refuses a filter that states nothing and one that states a thing twice', () => {
    expect(codes([{ kind: 'counterSpell', spellFilter: {} }])).toContain('ILLEGAL_TARGET_FILTER');
    expect(codes([{ kind: 'counterSpell', spellFilter: { colors: ['R', 'R'] } }])).toContain(
      'ILLEGAL_TARGET_FILTER',
    );
    expect(codes([{ kind: 'counterSpell', spellFilter: { colors: ['R'], excludeColors: ['R'] } }])).toContain(
      'ILLEGAL_TARGET_FILTER',
    );
  });
});
